import { describe, it, expect, vi } from 'vitest';

// browser:false so the dbService singleton doesn't construct Dexie on import —
// we only exercise the pure `fields` normaliser here.
vi.mock('$app/environment', () => ({ browser: false }));

import { fields } from './db';

describe('fields', () => {
	it('clones photos into a fresh plain array (no proxy leaks to IndexedDB)', () => {
		// Simulates a Svelte 5 $state reactive array (a Proxy), which structured-clone
		// can't handle — Dexie.add() would throw DataCloneError if we passed it through.
		const reactive = new Proxy(['a.jpg', 'b.jpg'], {});
		const out = fields({ name: 'Widget', photos: reactive });

		expect(out.photos).not.toBe(reactive); // a new array, not the caller's proxy
		expect(out.photos).toEqual(['a.jpg', 'b.jpg']);
		expect(() => structuredClone(out)).not.toThrow();
	});

	it('defaults photos to a plain array when absent', () => {
		const out = fields({ name: 'Widget' });
		expect(out.photos).toEqual([]);
		expect(() => structuredClone(out)).not.toThrow();
	});

	it('clones photoUrls into a fresh plain array and defaults to empty when absent', () => {
		const reactive = new Proxy(['https://x/a.jpg'], {});
		const out = fields({ name: 'Widget', photoUrls: reactive });
		expect(out.photoUrls).not.toBe(reactive);
		expect(out.photoUrls).toEqual(['https://x/a.jpg']);

		expect(fields({ name: 'Widget' }).photoUrls).toEqual([]);
	});
});
