// src/lib/services/photo-manifest.ts
//
// Companion to sql-export.ts. The SQL script carries the item rows; it cannot
// carry image bytes, because the target schema stores images through Spatie
// MediaLibrary (files on a storage disk, indexed by the `media` table).
//
// This builds the bridge: a JSON manifest of `sku -> [photo URL]` that a one-off
// Artisan command on the droplet consumes via `addMediaFromUrl()`. See
// docs/photo-migration.md.
//
// Pure — the caller supplies items already fetched from Convex (listItems()),
// which is what makes the URLs fresh rather than the local display cache.
//
// Caveat baked into the shape: Convex's `items.list` *filters out* photo ids it
// can't resolve (convex/items.ts), so `photoUrls` is compacted, not aligned with
// `photos`. A shorter `photoUrls` therefore means "n photos were lost", but
// which ones is not recoverable here — hence a count-based warning rather than a
// per-photo status.

import type { ServerItem } from './sync-logic';

export interface PhotoManifestItem {
	sku: string;
	name: string;
	/** Servable Convex File Storage URLs, in the order Convex returned them. */
	photos: string[];
}

export interface PhotoManifestWarning {
	sku: string;
	reason: string;
}

export interface PhotoManifest {
	generated_at: string;
	item_count: number;
	photo_count: number;
	items: PhotoManifestItem[];
	warnings: PhotoManifestWarning[];
}

/**
 * @param serverItems Items straight from `listItems()` — the Convex pull, whose
 *                    `photoUrls` are freshly resolved.
 * @param now         Injected so output is deterministic in tests.
 */
export function buildPhotoManifest(
	serverItems: ServerItem[],
	now: number = Date.now()
): PhotoManifest {
	const items: PhotoManifestItem[] = [];
	const warnings: PhotoManifestWarning[] = [];

	for (const item of serverItems) {
		const storedCount = item.photos?.length ?? 0;
		const urls = item.photoUrls ?? [];
		if (storedCount === 0 && urls.length === 0) continue;

		const sku = item.sku?.trim() ?? '';
		if (sku === '') {
			// The Artisan command matches on sku; without one the photos can't be
			// attached to anything downstream.
			warnings.push({
				sku: '(none)',
				reason: `item "${item.name}" has ${storedCount} photo(s) but no sku — cannot be matched`
			});
			continue;
		}

		// Convex dropped ids it couldn't resolve: legacy base64 entries stored
		// before File Storage landed, or ids whose file is gone.
		const lost = storedCount - urls.length;
		if (lost > 0) {
			warnings.push({
				sku,
				reason: `${lost} of ${storedCount} photo(s) could not be resolved by Convex (legacy base64 or missing storage file)`
			});
		}

		if (urls.length > 0) {
			items.push({ sku, name: item.name, photos: [...urls] });
		}
	}

	return {
		generated_at: new Date(now).toISOString(),
		item_count: items.length,
		photo_count: items.reduce((sum, i) => sum + i.photos.length, 0),
		items,
		warnings
	};
}

/**
 * Photo links keyed by sku, for the SQL export's `photo_urls` column.
 *
 * Built from the same live Convex pull as the manifest, so the URLs are freshly
 * resolved. Items without resolvable photos are absent from the map, which the
 * export writes as NULL.
 */
export function buildPhotoUrlIndex(serverItems: ServerItem[]): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const item of serverItems) {
		const sku = item.sku?.trim() ?? '';
		const urls = item.photoUrls ?? [];
		if (sku === '' || urls.length === 0) continue;
		// Later duplicates win, matching dedupeBySku's "most recent" intent closely
		// enough — Convex returns one doc per item, so collisions are rare.
		index.set(sku, [...urls]);
	}
	return index;
}

/** Serialise for download — indented so the file stays diffable/inspectable. */
export function serialisePhotoManifest(manifest: PhotoManifest): string {
	return JSON.stringify(manifest, null, 2) + '\n';
}
