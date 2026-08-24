// End-to-end offline-first tests.
//
// Unlike db.test.ts (which only covers the pure `fields` normaliser) and
// sync.test.ts (which mocks dbService away entirely), this file exercises the
// REAL Dexie/IndexedDB layer via fake-indexeddb, with only the network seam
// ($lib/convex) mocked. That's the combination that actually proves the
// offline-first promise: writes land in real local storage with no connection,
// survive, and then reconcile correctly once a connection returns.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import type { ServerItem } from './sync-logic';

const { convex } = vi.hoisted(() => ({
	convex: {
		listItems: vi.fn(),
		createItem: vi.fn(),
		updateItem: vi.fn(),
		removeItem: vi.fn(),
		resetClient: vi.fn()
	}
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/convex', () => convex);

import { dbService } from './db';
import { sync, pendingCount, online } from './sync';
import { get } from 'svelte/store';

/** Simulate the device being offline/online at the navigator level. */
function setNavigatorOnline(value: boolean) {
	Object.defineProperty(navigator, 'onLine', {
		configurable: true,
		get: () => value
	});
}

/** A server payload shaped like what Convex's list() returns. */
function serverItem(partial: Partial<ServerItem> & { id: string }): ServerItem {
	return {
		sku: 'SKU',
		name: 'Name',
		barcode: '',
		description: '',
		photos: [],
		is_active: true,
		lastModified: 0,
		...partial
	} as ServerItem;
}

// A stateful fake backend. Writes actually mutate it and listItems reflects
// them, so a create followed by a pull behaves like the real thing. This
// matters: planReconcile deliberately deletes a *synced* local item whose
// serverId is absent from the server's list, so a fake where createItem
// succeeded but listItems stayed empty would (correctly!) delete the item
// right back out and make these tests lie.
let fakeServer: Map<string, ServerItem>;
let nextServerId = 0;

function seedServer(items: ServerItem[]) {
	for (const i of items) fakeServer.set(i.id, i);
}

beforeEach(async () => {
	vi.clearAllMocks();
	await dbService.clearAll();
	setNavigatorOnline(true);

	fakeServer = new Map();
	nextServerId = 0;

	convex.listItems.mockImplementation(async () => [...fakeServer.values()]);
	convex.createItem.mockImplementation(async (payload: Partial<ServerItem>) => {
		const id = `srv_${++nextServerId}`;
		fakeServer.set(id, serverItem({ ...payload, id }));
		return { id };
	});
	convex.updateItem.mockImplementation(async (id: string, payload: Partial<ServerItem>) => {
		const existing = fakeServer.get(id);
		if (existing) fakeServer.set(id, { ...existing, ...payload, id });
	});
	convex.removeItem.mockImplementation(async (id: string) => {
		fakeServer.delete(id);
	});
});

afterEach(async () => {
	await dbService.clearAll();
});

describe('saving while offline', () => {
	it('persists a new item to local storage with no network call at all', async () => {
		setNavigatorOnline(false);

		await dbService.create({ sku: 'OFF1', name: 'Offline Widget' });

		const items = await dbService.getAllItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe('Offline Widget');
		// The whole point: creating never reaches for the network.
		expect(convex.createItem).not.toHaveBeenCalled();
		expect(convex.listItems).not.toHaveBeenCalled();
	});

	it('marks offline-created items pending, with no serverId yet', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'OFF2', name: 'Pending Widget' });

		const [item] = await dbService.getAllItems();
		expect(item.syncStatus).toBe('pending');
		expect(item.serverId).toBeNull();
	});

	it('supports full offline CRUD — create, edit, and delete all work unsynced', async () => {
		setNavigatorOnline(false);

		const id = await dbService.create({ sku: 'OFF3', name: 'Original' });
		await dbService.update(id, { sku: 'OFF3', name: 'Renamed' });

		let items = await dbService.getAllItems();
		expect(items[0].name).toBe('Renamed');

		// Never-synced items are hard-deleted (nothing on the server to remove).
		await dbService.remove(id);
		items = await dbService.getAllItems();
		expect(items).toHaveLength(0);

		expect(convex.createItem).not.toHaveBeenCalled();
		expect(convex.updateItem).not.toHaveBeenCalled();
		expect(convex.removeItem).not.toHaveBeenCalled();
	});

	it('queues many offline items and reports them all as pending', async () => {
		setNavigatorOnline(false);
		for (let i = 0; i < 5; i++) {
			await dbService.create({ sku: `BULK${i}`, name: `Item ${i}` });
		}
		expect(await dbService.pending()).toHaveLength(5);
	});

	it('sync() is a no-op while offline — nothing is pushed or lost', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'OFF4', name: 'Still Here' });

		await sync();

		expect(convex.createItem).not.toHaveBeenCalled();
		expect(convex.listItems).not.toHaveBeenCalled();
		expect(get(online)).toBe(false);
		// The item is untouched and still queued for later.
		const [item] = await dbService.getAllItems();
		expect(item.syncStatus).toBe('pending');
	});
});

describe('data survives across sessions', () => {
	it('offline-created items are still there after the app restarts', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'PERSIST', name: 'Survivor' });

		// Re-import the module fresh, simulating a page reload against the same
		// underlying IndexedDB — the real test of durable local storage.
		vi.resetModules();
		const { dbService: reopened } = await import('./db');

		const items = await reopened.getAllItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe('Survivor');
		expect(items[0].syncStatus).toBe('pending');
	});
});

describe('syncing once the connection returns', () => {
	it('pushes everything queued while offline, then marks it synced', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'Q1', name: 'First' });
		await dbService.create({ sku: 'Q2', name: 'Second' });
		expect(convex.createItem).not.toHaveBeenCalled();

		setNavigatorOnline(true);
		await sync();

		expect(convex.createItem).toHaveBeenCalledTimes(2);
		const items = await dbService.getAllItems();
		expect(items.every((i) => i.syncStatus === 'synced')).toBe(true);
		expect(items.every((i) => i.serverId != null)).toBe(true);
		expect(await dbService.pending()).toHaveLength(0);
	});

	it('sends the fields the person actually entered offline', async () => {
		setNavigatorOnline(false);
		await dbService.create({
			sku: 'FIELDS',
			name: 'Detailed Item',
			description: 'Written with no signal',
			barcode: '12345',
			category: 'Power'
		});

		setNavigatorOnline(true);
		await sync();

		expect(convex.createItem).toHaveBeenCalledTimes(1);
		const payload = convex.createItem.mock.calls[0][0];
		expect(payload).toMatchObject({
			sku: 'FIELDS',
			name: 'Detailed Item',
			description: 'Written with no signal',
			barcode: '12345',
			category: 'Power'
		});
	});

	it('pushes an offline edit to an already-synced item as an update, not a duplicate create', async () => {
		// Get one item synced first.
		const id = await dbService.create({ sku: 'EDIT', name: 'Before' });
		await sync();
		expect((await dbService.getAllItems())[0].syncStatus).toBe('synced');
		const serverId = (await dbService.getAllItems())[0].serverId;

		// Go offline and edit it.
		setNavigatorOnline(false);
		await dbService.update(id, { sku: 'EDIT', name: 'After' });
		expect((await dbService.getAllItems())[0].syncStatus).toBe('pending');

		// Reconnect: it should UPDATE the existing server row, not create a second one.
		setNavigatorOnline(true);
		await sync();

		expect(convex.updateItem).toHaveBeenCalledTimes(1);
		expect(convex.updateItem.mock.calls[0][0]).toBe(serverId);
		expect(convex.createItem).toHaveBeenCalledTimes(1); // still just the original
		expect(fakeServer.size).toBe(1); // no duplicate row server-side
		expect([...fakeServer.values()][0].name).toBe('After');
	});

	it('pushes an offline delete of a synced item as a server-side remove', async () => {
		const id = await dbService.create({ sku: 'DEL', name: 'Doomed' });
		await sync();
		const serverId = (await dbService.getAllItems())[0].serverId!;
		expect(fakeServer.has(serverId)).toBe(true);

		setNavigatorOnline(false);
		await dbService.remove(id);
		// Soft-deleted: hidden from the list, but still queued so the server hears about it.
		expect(await dbService.getAllItems()).toHaveLength(0);
		expect(await dbService.pending()).toHaveLength(1);

		setNavigatorOnline(true);
		await sync();

		expect(convex.removeItem).toHaveBeenCalledWith(serverId);
		expect(fakeServer.has(serverId)).toBe(false); // actually gone server-side
		expect(await dbService.pending()).toHaveLength(0);
	});

	it('pulls server items the person has never seen locally', async () => {
		seedServer([serverItem({ id: 'srv_remote', sku: 'REMOTE', name: 'From Another Device' })]);

		await sync();

		const items = await dbService.getAllItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe('From Another Device');
		expect(items[0].syncStatus).toBe('synced');
	});
});

describe('surviving a failed sync', () => {
	it('keeps local data intact when the server is unreachable', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'SAFE', name: 'Do Not Lose Me' });

		// "Online" per the device, but the backend refuses every call.
		setNavigatorOnline(true);
		convex.createItem.mockRejectedValue(new Error('Server unreachable'));
		convex.listItems.mockRejectedValue(new Error('Server unreachable'));

		await sync();

		// The data is still here, and still queued for a later retry.
		const items = await dbService.getAllItems();
		expect(items).toHaveLength(1);
		expect(items[0].name).toBe('Do Not Lose Me');
		expect(await dbService.pending()).toHaveLength(1);
	});

	it('retries successfully on a later sync once the server comes back', async () => {
		setNavigatorOnline(true);
		await dbService.create({ sku: 'RETRY', name: 'Eventually' });

		// Server is down for this attempt only.
		const workingCreate = convex.createItem.getMockImplementation()!;
		const workingList = convex.listItems.getMockImplementation()!;
		convex.createItem.mockRejectedValueOnce(new Error('Server unreachable'));
		convex.listItems.mockRejectedValueOnce(new Error('Server unreachable'));
		await sync();
		expect(await dbService.pending()).toHaveLength(1);

		// Server recovers — restore the stateful behaviour.
		convex.createItem.mockImplementation(workingCreate);
		convex.listItems.mockImplementation(workingList);
		await sync();

		expect(await dbService.pending()).toHaveLength(0);
		const items = await dbService.getAllItems();
		expect(items).toHaveLength(1);
		expect(items[0].syncStatus).toBe('synced');
		expect(fakeServer.size).toBe(1); // pushed exactly once, no duplicate
	});

	it('can still create new items locally after a failed sync', async () => {
		setNavigatorOnline(true);
		convex.createItem.mockRejectedValue(new Error('Server unreachable'));
		convex.listItems.mockRejectedValue(new Error('Server unreachable'));

		await dbService.create({ sku: 'A', name: 'First' });
		await sync();

		// A failed sync must not wedge local writes — this is the core promise.
		await dbService.create({ sku: 'B', name: 'Second' });
		const items = await dbService.getAllItems();
		expect(items).toHaveLength(2);
	});
});

describe('photos captured offline', () => {
	// Photos are the highest-risk offline payload: they're stored locally as
	// raw base64 `data:` URLs and only converted to Convex storage ids at the
	// network seam (see uploadPhotos in convex.ts), so they have to survive
	// IndexedDB's structured-clone intact and reach the push verbatim.
	const dataUrl =
		'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

	it('stores a photo taken offline as a data: URL in local storage', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'PHOTO', name: 'With Photo', photos: [dataUrl] });

		const [item] = await dbService.getAllItems();
		expect(item.photos).toHaveLength(1);
		expect(item.photos[0]).toBe(dataUrl);
		expect(convex.createItem).not.toHaveBeenCalled();
	});

	it('survives a reload with the photo data intact', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'PHOTO2', name: 'Durable Photo', photos: [dataUrl] });

		vi.resetModules();
		const { dbService: reopened } = await import('./db');
		const [item] = await reopened.getAllItems();

		expect(item.photos[0]).toBe(dataUrl);
	});

	it('hands the photo to the push once back online', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'PHOTO3', name: 'Uploads Later', photos: [dataUrl] });

		setNavigatorOnline(true);
		await sync();

		expect(convex.createItem).toHaveBeenCalledTimes(1);
		expect(convex.createItem.mock.calls[0][0].photos).toEqual([dataUrl]);
	});

	it('handles multiple photos added across separate offline edits', async () => {
		setNavigatorOnline(false);
		const id = await dbService.create({ sku: 'MULTI', name: 'Gallery', photos: [dataUrl] });
		await dbService.update(id, { sku: 'MULTI', name: 'Gallery', photos: [dataUrl, dataUrl] });

		const [item] = await dbService.getAllItems();
		expect(item.photos).toHaveLength(2);

		setNavigatorOnline(true);
		await sync();
		expect(convex.createItem.mock.calls[0][0].photos).toHaveLength(2);
	});
});

describe('repeated offline edits collapse into one push', () => {
	it('sends only the final state of an item edited several times offline', async () => {
		setNavigatorOnline(false);
		const id = await dbService.create({ sku: 'ITER', name: 'v1' });
		await dbService.update(id, { sku: 'ITER', name: 'v2' });
		await dbService.update(id, { sku: 'ITER', name: 'v3' });
		await dbService.update(id, { sku: 'ITER', name: 'final' });

		setNavigatorOnline(true);
		await sync();

		// One create carrying the last value — not four calls replaying history.
		expect(convex.createItem).toHaveBeenCalledTimes(1);
		expect(convex.createItem.mock.calls[0][0].name).toBe('final');
		expect(fakeServer.size).toBe(1);
	});
});

describe('offline edits are not clobbered by the pull', () => {
	it('keeps a locally-edited item when the server still has the older version', async () => {
		// Item exists on both sides, synced.
		const id = await dbService.create({ sku: 'CONFLICT', name: 'Server Version' });
		await sync();
		const serverId = (await dbService.getAllItems())[0].serverId!;

		// Edit locally while offline.
		setNavigatorOnline(false);
		await dbService.update(id, { sku: 'CONFLICT', name: 'My Offline Edit' });

		// Come back online. The pull happens after the push, but even if the
		// server still advertised the old name, planReconcile must not overwrite
		// an item that has unsynced local changes.
		setNavigatorOnline(true);
		await sync();

		const [item] = await dbService.getAllItems();
		expect(item.name).toBe('My Offline Edit');
		expect(fakeServer.get(serverId)!.name).toBe('My Offline Edit');
	});

	it('never prunes an unsynced local item just because the server has not seen it', async () => {
		// A server that knows about something else entirely.
		seedServer([serverItem({ id: 'srv_other', name: 'Someone Elses Item' })]);

		setNavigatorOnline(false);
		await dbService.create({ sku: 'MINE', name: 'My Unsynced Item' });

		setNavigatorOnline(true);
		await sync();

		const names = (await dbService.getAllItems()).map((i) => i.name);
		expect(names).toContain('My Unsynced Item');
		expect(names).toContain('Someone Elses Item');
	});
});

describe('partial failures do not lose data', () => {
	it('keeps the failed item queued when one item in a batch is rejected', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'OK1', name: 'Fine' });
		await dbService.create({ sku: 'BAD', name: 'Rejected' });
		await dbService.create({ sku: 'OK2', name: 'Also Fine' });

		setNavigatorOnline(true);
		// Reject only the item named 'Rejected'; a plain Error (not a timeout)
		// so the push continues through the rest of the batch.
		const working = convex.createItem.getMockImplementation()!;
		convex.createItem.mockImplementation(async (payload: { name: string }) => {
			if (payload.name === 'Rejected') throw new Error('Validation failed');
			return working(payload);
		});

		await sync();

		const items = await dbService.getAllItems();
		// Nothing was dropped locally.
		expect(items).toHaveLength(3);
		// The good ones made it; the bad one is still queued for a retry.
		const rejected = items.find((i) => i.name === 'Rejected')!;
		expect(rejected.syncStatus).toBe('error');
		expect(rejected.serverId).toBeNull();
		expect(items.filter((i) => i.syncStatus === 'synced')).toHaveLength(2);
	});
});

describe('pending count reflects real queued work', () => {
	it('rises as offline items are queued and clears after a successful sync', async () => {
		setNavigatorOnline(false);
		await dbService.create({ sku: 'C1', name: 'One' });
		await dbService.create({ sku: 'C2', name: 'Two' });

		// queueSync/initSync normally refresh this; sync() refreshes it in its finally.
		setNavigatorOnline(true);
		await sync();

		expect(get(pendingCount)).toBe(0);
		expect(await dbService.pending()).toHaveLength(0);
	});
});
