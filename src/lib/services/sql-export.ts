// src/lib/services/sql-export.ts
//
// Generates a MySQL script that loads this app's items into the external
// Laravel inventory schema (see schema_from_dashboard.txt at the repo root).
//
// Pure — no DOM, no Dexie, no network — so it is unit-testable and the caller
// owns the download. The output is deliberately *idempotent*: `items.sku` is a
// UNIQUE key, so re-running the script updates the existing rows instead of
// erroring, and categories are only inserted when a row with that name is
// missing.
//
// Photos travel as *links*, not bytes: the caller passes photo URLs resolved
// from a live Convex pull and they're written into the `photo_urls` JSON column
// (added by the migration in docs/photo-migration.md). Copying the image files
// into Spatie MediaLibrary instead is documented there as the alternative.

import type { Item } from './db';

/** How many rows go into one multi-row INSERT statement. */
const ROWS_PER_STATEMENT = 100;

export interface SqlExportResult {
	sql: string;
	/** Items written to the script. */
	exported: number;
	/** Items dropped for a missing sku or name, with the reason. */
	skipped: { name: string; sku: string; reason: string }[];
	/** SKUs that appeared more than once locally; only the newest was kept. */
	duplicateSkus: string[];
	/**
	 * Whether the script touches `photo_urls` at all. False when no photo links
	 * were supplied — the column is then left out of the statement entirely, so
	 * an import preserves whatever links are already stored.
	 */
	photoUrlsIncluded: boolean;
}

/**
 * Escape a value for a MySQL single-quoted string literal.
 *
 * Covers the characters that are special under both the default mode and
 * NO_BACKSLASH_ESCAPES-adjacent setups, plus the control characters that would
 * otherwise break the script into invalid lines.
 */
export function quote(value: string): string {
	// Ctrl-Z (\x1a) must be escaped — MySQL on Windows reads a raw one as EOF.
	// eslint-disable-next-line no-control-regex
	const escaped = value.replace(/[\0\b\n\r\t\x1a\\'"]/g, (char) => {
		switch (char) {
			case '\0':
				return '\\0';
			case '\b':
				return '\\b';
			case '\n':
				return '\\n';
			case '\r':
				return '\\r';
			case '\t':
				return '\\t';
			case '\x1a':
				return '\\Z';
			default:
				return '\\' + char;
		}
	});
	return `'${escaped}'`;
}

/** `''` / undefined become SQL NULL; everything else is a quoted literal. */
function nullableText(value: string | undefined): string {
	const trimmed = (value ?? '').trim();
	return trimmed === '' ? 'NULL' : quote(trimmed);
}

/** ms epoch → `'YYYY-MM-DD HH:MM:SS'` in UTC (the script pins time_zone to +00:00). */
export function toMysqlDateTime(ms: number): string {
	// MySQL TIMESTAMP columns can't hold anything at or before the epoch.
	const safe = Number.isFinite(ms) && ms > 1000 ? ms : Date.now();
	return new Date(safe).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * The target enum is only ('pending','synced'). A local 'error' or 'deleted'
 * still has work outstanding, so it maps to 'pending'.
 */
function syncStatusFor(item: Item): 'pending' | 'synced' {
	return item.syncStatus === 'synced' ? 'synced' : 'pending';
}

/** Scalar subquery resolving a category name to its id, or NULL when unset. */
function categoryIdExpr(category: string | undefined): string {
	const name = (category ?? '').trim();
	if (name === '') return 'NULL';
	return `(SELECT \`id\` FROM \`categories\` WHERE \`name\` = ${quote(name)} AND \`deleted_at\` IS NULL ORDER BY \`id\` LIMIT 1)`;
}

/**
 * Keep one row per sku (the most recently modified). The local store doesn't
 * enforce sku uniqueness but `items.sku` in the target schema does, so the
 * collision has to be resolved here rather than by the database.
 */
function dedupeBySku(items: Item[]): { kept: Item[]; duplicateSkus: string[] } {
	const bySku = new Map<string, Item>();
	const duplicateSkus: string[] = [];
	for (const item of items) {
		const sku = item.sku.trim();
		const existing = bySku.get(sku);
		if (!existing) {
			bySku.set(sku, item);
			continue;
		}
		if (!duplicateSkus.includes(sku)) duplicateSkus.push(sku);
		if (item.lastModified >= existing.lastModified) bySku.set(sku, item);
	}
	return { kept: [...bySku.values()], duplicateSkus };
}

/** Item fields whose target column is varchar(255). `description` is TEXT, so it's exempt. */
const VARCHAR_255_FIELDS = ['sku', 'name', 'barcode'] as const;

/**
 * Name of the JSON column added to `items` to hold photo links (see
 * docs/photo-migration.md for the migration). Declared once so renaming it is a
 * one-word change here.
 */
export const PHOTO_URLS_COLUMN = 'photo_urls';

const ITEM_COLUMNS = [
	'sku',
	'name',
	'description',
	'category_id',
	'barcode',
	'is_active',
	'sync_status',
	'last_modified',
	'created_at',
	'updated_at',
	PHOTO_URLS_COLUMN
];

/**
 * A JSON array literal of photo links for the `photo_urls` column, or NULL.
 *
 * MySQL parses the quoted string into JSON on insert, so an invalid literal is
 * rejected outright rather than stored as garbage.
 */
function photoUrlsExpr(urls: string[] | undefined): string {
	if (!urls || urls.length === 0) return 'NULL';
	return quote(JSON.stringify(urls));
}

/**
 * Build the import script.
 *
 * @param items            Items to export (typically `dbService.getAllItems()`,
 *                         which already excludes soft-deleted rows).
 * @param now              Export timestamp in ms; injected so the output is
 *                         deterministic in tests.
 * @param photoUrlsBySku   Photo links keyed by sku, from a live Convex pull (see
 *                         buildPhotoUrlIndex).
 *
 *                         Omit it entirely (offline, or the pull failed) and
 *                         `photo_urls` is left out of the statement, so an
 *                         import preserves any links already stored. Supply it
 *                         and the column is authoritative: an item absent from
 *                         the map writes NULL, which is what correctly clears
 *                         the links for an item whose photos were removed.
 *                         So pass a map built from a *full* pull, never a
 *                         partial one.
 */
export function buildSqlExport(
	items: Item[],
	now: number = Date.now(),
	photoUrlsBySku?: Map<string, string[]>
): SqlExportResult {
	const generatedAt = toMysqlDateTime(now);

	const skipped: SqlExportResult['skipped'] = [];
	const valid: Item[] = [];
	for (const item of items) {
		// sku and name are NOT NULL in the target schema, and sku is the upsert key.
		if (item.sku.trim() === '') {
			skipped.push({ name: item.name, sku: item.sku, reason: 'missing sku' });
			continue;
		}
		if (item.name.trim() === '') {
			skipped.push({ name: item.name, sku: item.sku, reason: 'missing name' });
			continue;
		}
		// This app imposes no length limit, but the target columns are varchar(255)
		// and Laravel runs MySQL in strict mode — one over-long value would abort
		// the whole transaction, taking every other item with it. Skipping and
		// reporting is better than truncating data behind the user's back.
		const tooLong = VARCHAR_255_FIELDS.find((f) => item[f].trim().length > 255);
		if (tooLong) {
			skipped.push({
				name: item.name,
				sku: item.sku,
				reason: `${tooLong} exceeds 255 characters (${item[tooLong].trim().length})`
			});
			continue;
		}
		valid.push(item);
	}

	const { kept, duplicateSkus } = dedupeBySku(valid);

	const categoryNames = [
		...new Set(kept.map((i) => (i.category ?? '').trim()).filter((c) => c !== ''))
	].sort();

	const out: string[] = [];

	out.push('-- Inventory app export → external inventory schema (MySQL).');
	out.push(`-- Generated: ${generatedAt} UTC`);
	out.push(`-- Items: ${kept.length}`);
	out.push('--');
	out.push('-- Idempotent: `items`.`sku` is UNIQUE, so re-running updates existing rows.');
	out.push('-- Run with:  mysql -u <user> -p <database> < this-file.sql');
	if (skipped.length) out.push(`-- Skipped ${skipped.length} item(s) — see the notes at the end.`);
	out.push('');
	out.push('SET NAMES utf8mb4;');
	// last_modified/created_at/updated_at are TIMESTAMPs, interpreted in the
	// session time zone; the values below are UTC.
	out.push("SET time_zone = '+00:00';");
	out.push('');
	out.push('START TRANSACTION;');
	out.push('');

	if (categoryNames.length) {
		out.push('-- Categories referenced by the items below, created only when absent.');
		out.push('-- (`categories`.`name` has no unique index, hence the NOT EXISTS guard.)');
		for (const name of categoryNames) {
			out.push(
				`INSERT INTO \`categories\` (\`name\`, \`created_at\`, \`updated_at\`)\n` +
					`SELECT ${quote(name)}, ${quote(generatedAt)}, ${quote(generatedAt)} FROM DUAL\n` +
					`WHERE NOT EXISTS (SELECT 1 FROM \`categories\` WHERE \`name\` = ${quote(name)} AND \`deleted_at\` IS NULL);`
			);
		}
		out.push('');
	}

	// Without photo links, drop the column rather than writing NULL into it: an
	// upsert would otherwise erase the links already stored on every row.
	const columns = photoUrlsBySku
		? ITEM_COLUMNS
		: ITEM_COLUMNS.filter((c) => c !== PHOTO_URLS_COLUMN);

	if (kept.length) {
		const columnList = columns.map((c) => `\`${c}\``).join(', ');
		// `deleted_at` is reset so an item that was soft-deleted server-side but
		// still exists locally comes back rather than staying hidden.
		const updateClause = [
			...columns
				.filter((c) => c !== 'sku' && c !== 'created_at')
				.map((c) => `  \`${c}\` = VALUES(\`${c}\`)`),
			'  `deleted_at` = NULL'
		].join(',\n');

		out.push('-- Items. Matched on the unique `sku`; existing rows are updated in place.');
		for (let start = 0; start < kept.length; start += ROWS_PER_STATEMENT) {
			const chunk = kept.slice(start, start + ROWS_PER_STATEMENT);
			const rows = chunk.map((item) => {
				const modified = toMysqlDateTime(item.lastModified);
				const values = [
					quote(item.sku.trim()),
					quote(item.name.trim()),
					nullableText(item.description),
					categoryIdExpr(item.category),
					nullableText(item.barcode),
					item.is_active ? '1' : '0',
					quote(syncStatusFor(item)),
					quote(modified),
					quote(modified),
					quote(generatedAt)
				];
				if (photoUrlsBySku) values.push(photoUrlsExpr(photoUrlsBySku.get(item.sku.trim())));
				// The values are positional, so a column without a matching value (or
				// vice versa) would silently shift every field after it into the wrong
				// column. Fail loudly instead.
				if (values.length !== columns.length) {
					throw new Error(
						`sql-export: ${values.length} values for ${columns.length} columns — these must match`
					);
				}
				return '  (' + values.join(', ') + ')';
			});
			out.push(
				`INSERT INTO \`items\` (${columnList})\nVALUES\n${rows.join(',\n')}\n` +
					`ON DUPLICATE KEY UPDATE\n${updateClause};`
			);
		}
		out.push('');
	}

	out.push('COMMIT;');

	const withPhotos = kept.filter((i) => i.photos.length > 0);
	if (withPhotos.length) {
		out.push('');
		out.push('-- ---------------------------------------------------------------------');
		out.push('-- PHOTOS (not imported)');
		out.push('--');
		out.push('-- The target schema stores images via the `media` table (Spatie');
		out.push('-- MediaLibrary), which requires the actual files on a storage disk. A SQL');
		out.push('-- script cannot carry them, so the references are listed here only.');
		out.push(`-- ${withPhotos.length} item(s) have photos:`);
		for (const item of withPhotos) {
			out.push(`--   ${item.sku.trim()}: ${item.photos.length} photo(s)`);
		}
	}

	if (skipped.length || duplicateSkus.length) {
		out.push('');
		out.push('-- ---------------------------------------------------------------------');
		out.push('-- NOTES');
		for (const s of skipped) {
			out.push(
				`--   skipped (${s.reason}): name=${JSON.stringify(s.name)} sku=${JSON.stringify(s.sku)}`
			);
		}
		for (const sku of duplicateSkus) {
			out.push(`--   duplicate sku ${sku}: kept the most recently modified item only.`);
		}
	}

	return {
		sql: out.join('\n') + '\n',
		exported: kept.length,
		skipped,
		duplicateSkus,
		photoUrlsIncluded: photoUrlsBySku != null
	};
}
