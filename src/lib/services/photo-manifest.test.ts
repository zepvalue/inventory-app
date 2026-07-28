import { describe, it, expect } from 'vitest';
import { buildPhotoManifest, buildPhotoUrlIndex, serialisePhotoManifest } from './photo-manifest';
import type { ServerItem } from './sync-logic';

const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z

function server(partial: Partial<ServerItem>): ServerItem {
	return {
		id: 'k1',
		sku: 'KIT10000001',
		name: 'Widget',
		photos: [],
		photoUrls: [],
		...partial
	};
}

describe('buildPhotoManifest', () => {
	it('lists resolvable photo URLs per sku', () => {
		const manifest = buildPhotoManifest(
			[
				server({
					sku: 'KIT1',
					name: 'Knife',
					photos: ['sid1', 'sid2'],
					photoUrls: ['https://cx/a', 'https://cx/b']
				})
			],
			NOW
		);
		expect(manifest.items).toEqual([
			{ sku: 'KIT1', name: 'Knife', photos: ['https://cx/a', 'https://cx/b'] }
		]);
		expect(manifest.item_count).toBe(1);
		expect(manifest.photo_count).toBe(2);
		expect(manifest.warnings).toEqual([]);
		expect(manifest.generated_at).toBe('2023-11-14T22:13:20.000Z');
	});

	it('omits items that have no photos at all', () => {
		const manifest = buildPhotoManifest([server({ photos: [], photoUrls: [] })], NOW);
		expect(manifest.items).toEqual([]);
		expect(manifest.photo_count).toBe(0);
		expect(manifest.warnings).toEqual([]);
	});

	it('warns when Convex could not resolve every stored photo', () => {
		// convex/items.ts compacts the list, so a shorter photoUrls means loss.
		const manifest = buildPhotoManifest(
			[server({ sku: 'OLD1', photos: ['legacyBase64', 'sid2'], photoUrls: ['https://cx/b'] })],
			NOW
		);
		expect(manifest.items).toEqual([{ sku: 'OLD1', name: 'Widget', photos: ['https://cx/b'] }]);
		expect(manifest.warnings).toEqual([
			{
				sku: 'OLD1',
				reason:
					'1 of 2 photo(s) could not be resolved by Convex (legacy base64 or missing storage file)'
			}
		]);
	});

	it('warns and emits no item when every photo is unresolvable', () => {
		const manifest = buildPhotoManifest(
			[server({ sku: 'OLD2', photos: ['legacy1', 'legacy2'], photoUrls: [] })],
			NOW
		);
		expect(manifest.items).toEqual([]);
		expect(manifest.warnings).toHaveLength(1);
		expect(manifest.warnings[0].reason).toContain('2 of 2');
	});

	it('warns when photos exist but there is no sku to match on', () => {
		const manifest = buildPhotoManifest(
			[server({ sku: '  ', name: 'Nameless', photos: ['sid1'], photoUrls: ['https://cx/a'] })],
			NOW
		);
		expect(manifest.items).toEqual([]);
		expect(manifest.warnings[0].sku).toBe('(none)');
		expect(manifest.warnings[0].reason).toContain('cannot be matched');
	});

	it('tolerates items missing the photo fields entirely', () => {
		const manifest = buildPhotoManifest([server({ photos: undefined, photoUrls: undefined })], NOW);
		expect(manifest.items).toEqual([]);
		expect(manifest.warnings).toEqual([]);
	});

	it('totals photos across items', () => {
		const manifest = buildPhotoManifest(
			[
				server({ sku: 'A', photos: ['1'], photoUrls: ['https://cx/1'] }),
				server({ sku: 'B', photos: ['2', '3'], photoUrls: ['https://cx/2', 'https://cx/3'] })
			],
			NOW
		);
		expect(manifest.item_count).toBe(2);
		expect(manifest.photo_count).toBe(3);
	});
});

describe('serialisePhotoManifest', () => {
	it('produces indented JSON ending in a newline', () => {
		const json = serialisePhotoManifest(buildPhotoManifest([], NOW));
		expect(json.endsWith('\n')).toBe(true);
		expect(JSON.parse(json)).toMatchObject({ item_count: 0, photo_count: 0 });
		expect(json).toContain('\n  "items"');
	});
});

describe('buildPhotoUrlIndex', () => {
	it('maps sku to its resolved photo URLs', () => {
		const index = buildPhotoUrlIndex([
			server({ sku: 'A1', photos: ['s1'], photoUrls: ['https://cx/a'] }),
			server({ sku: 'B1', photos: ['s2', 's3'], photoUrls: ['https://cx/b', 'https://cx/c'] })
		]);
		expect(index.get('A1')).toEqual(['https://cx/a']);
		expect(index.get('B1')).toEqual(['https://cx/b', 'https://cx/c']);
	});

	it('omits items with no resolvable photos or no sku', () => {
		const index = buildPhotoUrlIndex([
			server({ sku: 'A1', photos: ['legacy'], photoUrls: [] }),
			server({ sku: '  ', photos: ['s1'], photoUrls: ['https://cx/a'] }),
			server({ sku: 'C1', photos: [], photoUrls: [] })
		]);
		expect(index.size).toBe(0);
	});

	it('trims the sku so it matches the SQL export key', () => {
		const index = buildPhotoUrlIndex([
			server({ sku: ' A1 ', photos: ['s1'], photoUrls: ['https://cx/a'] })
		]);
		expect(index.get('A1')).toEqual(['https://cx/a']);
	});
});
