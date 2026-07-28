import { describe, it, expect } from 'vitest';
import { buildSqlExport, quote, toMysqlDateTime } from './sql-export';
import type { Item } from './db';

const NOW = 1_700_000_000_000; // 2023-11-14 22:13:20 UTC

function item(partial: Partial<Item>): Item {
	return {
		id: 1,
		serverId: null,
		sku: 'KIT12345678',
		name: 'Widget',
		barcode: '',
		description: '',
		photos: [],
		is_active: true,
		syncStatus: 'synced',
		lastModified: NOW,
		...partial
	};
}

describe('quote', () => {
	it('wraps in single quotes and escapes quotes and backslashes', () => {
		expect(quote("O'Brien")).toBe("'O\\'Brien'");
		expect(quote('back\\slash')).toBe("'back\\\\slash'");
		expect(quote('say "hi"')).toBe('\'say \\"hi\\"\'');
	});

	it('escapes control characters so the statement stays on valid lines', () => {
		expect(quote('a\nb')).toBe("'a\\nb'");
		expect(quote('a\rb')).toBe("'a\\rb'");
		expect(quote('a\0b')).toBe("'a\\0b'");
	});
});

describe('toMysqlDateTime', () => {
	it('formats ms epoch as a UTC datetime', () => {
		expect(toMysqlDateTime(NOW)).toBe('2023-11-14 22:13:20');
	});

	it('falls back for values outside the TIMESTAMP range', () => {
		expect(toMysqlDateTime(0)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
	});
});

describe('buildSqlExport', () => {
	it('wraps the import in a transaction with UTC pinned', () => {
		const { sql } = buildSqlExport([item({})], NOW);
		expect(sql).toContain("SET time_zone = '+00:00';");
		expect(sql).toContain('START TRANSACTION;');
		expect(sql).toContain('COMMIT;');
		expect(sql.indexOf('START TRANSACTION;')).toBeLessThan(sql.indexOf('INSERT INTO `items`'));
		expect(sql.indexOf('INSERT INTO `items`')).toBeLessThan(sql.indexOf('COMMIT;'));
	});

	it('upserts on the unique sku rather than plain-inserting', () => {
		const { sql } = buildSqlExport([item({})], NOW);
		expect(sql).toContain('ON DUPLICATE KEY UPDATE');
		expect(sql).toContain('`name` = VALUES(`name`)');
		// sku is the match key and created_at must survive a re-import.
		expect(sql).not.toContain('`sku` = VALUES(`sku`)');
		expect(sql).not.toContain('`created_at` = VALUES(`created_at`)');
		// A row soft-deleted server-side comes back on re-import.
		expect(sql).toContain('`deleted_at` = NULL');
	});

	it('creates each referenced category once, guarded by NOT EXISTS', () => {
		const { sql } = buildSqlExport(
			[
				item({ sku: 'A1', category: 'Kitchen' }),
				item({ sku: 'A2', category: 'Kitchen' }),
				item({ sku: 'A3', category: 'Rig' })
			],
			NOW
		);
		const inserts = sql.match(/INSERT INTO `categories`/g) ?? [];
		expect(inserts).toHaveLength(2);
		expect(sql).toContain(
			"WHERE NOT EXISTS (SELECT 1 FROM `categories` WHERE `name` = 'Kitchen' AND `deleted_at` IS NULL)"
		);
		// Categories must exist before the items that point at them.
		expect(sql.indexOf('INSERT INTO `categories`')).toBeLessThan(
			sql.indexOf('INSERT INTO `items`')
		);
	});

	it('resolves category_id by name and uses NULL when there is no category', () => {
		const withCategory = buildSqlExport([item({ category: 'Toys' })], NOW).sql;
		expect(withCategory).toContain(
			"(SELECT `id` FROM `categories` WHERE `name` = 'Toys' AND `deleted_at` IS NULL ORDER BY `id` LIMIT 1)"
		);

		const withoutCategory = buildSqlExport([item({ category: undefined })], NOW).sql;
		expect(withoutCategory).not.toContain('INSERT INTO `categories`');
		expect(withoutCategory).toContain("'Widget', NULL, NULL");
	});

	it('maps empty optional text to NULL and booleans to 1/0', () => {
		const { sql } = buildSqlExport(
			[item({ description: '', barcode: '  ', is_active: false })],
			NOW
		);
		expect(sql).toContain("'Widget', NULL, NULL, NULL, 0,");
	});

	it('collapses non-synced statuses onto the target enum', () => {
		for (const status of ['pending', 'error', 'deleted'] as const) {
			expect(buildSqlExport([item({ syncStatus: status })], NOW).sql).toContain("'pending'");
		}
		expect(buildSqlExport([item({ syncStatus: 'synced' })], NOW).sql).toContain("'synced'");
	});

	it('writes lastModified as the UTC last_modified/created_at value', () => {
		const { sql } = buildSqlExport([item({ lastModified: NOW })], NOW);
		expect(sql).toContain("'2023-11-14 22:13:20', '2023-11-14 22:13:20'");
	});

	it('skips items the target schema would reject as NOT NULL', () => {
		const result = buildSqlExport(
			[item({ sku: '', name: 'No SKU' }), item({ sku: 'A1', name: '  ' }), item({ sku: 'A2' })],
			NOW
		);
		expect(result.exported).toBe(1);
		expect(result.skipped.map((s) => s.reason)).toEqual(['missing sku', 'missing name']);
		expect(result.sql).toContain('-- NOTES');
		expect(result.sql).toContain('skipped (missing sku)');
	});

	it('keeps only the newest item per sku, since sku is UNIQUE downstream', () => {
		const result = buildSqlExport(
			[
				item({ id: 1, sku: 'DUP', name: 'Older', lastModified: NOW - 1000 }),
				item({ id: 2, sku: 'DUP', name: 'Newer', lastModified: NOW })
			],
			NOW
		);
		expect(result.exported).toBe(1);
		expect(result.duplicateSkus).toEqual(['DUP']);
		expect(result.sql).toContain("'Newer'");
		expect(result.sql).not.toContain("'Older'");
	});

	it('lists photo references as comments instead of dropping them silently', () => {
		const { sql } = buildSqlExport(
			[item({ sku: 'A1', photos: ['data:image/jpeg;base64,x'] })],
			NOW
		);
		expect(sql).toContain('PHOTOS (not imported)');
		expect(sql).toContain('--   A1: 1 photo(s)');
	});

	it('batches large exports into multiple statements', () => {
		const many = Array.from({ length: 250 }, (_, i) => item({ id: i, sku: `SKU${i}` }));
		const result = buildSqlExport(many, NOW);
		expect(result.exported).toBe(250);
		expect(result.sql.match(/INSERT INTO `items`/g)).toHaveLength(3);
	});

	it('produces a valid script for an empty inventory', () => {
		const result = buildSqlExport([], NOW);
		expect(result.exported).toBe(0);
		expect(result.sql).toContain('START TRANSACTION;');
		expect(result.sql).toContain('COMMIT;');
		expect(result.sql).not.toContain('INSERT INTO');
	});
});
