// Guards on the sync-engine markers, run against a real (fake-indexeddb) Dexie:
// once an item is locally 'deleted' — or gone entirely — a push completing in
// the background must not flip it back to 'synced'/'error' and resurrect it.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

// browser:true so dbService constructs Dexie (backed by fake-indexeddb).
vi.mock('$app/environment', () => ({ browser: true }));

import { dbService, type Item } from './db';

function seed(partial: Partial<Item>): Promise<number> {
	return dbService.create({ name: 'Widget', sku: 'SKU-1', ...partial });
}

describe('markSynced / markError vs a concurrent delete', () => {
	beforeEach(async () => {
		await dbService.clearAll();
	});

	it('markSynced marks a live item synced and stores the serverId', async () => {
		const id = await seed({});
		await dbService.markSynced(id, 'k17abc');
		const after = await dbService.get(id);
		expect(after?.syncStatus).toBe('synced');
		expect(after?.serverId).toBe('k17abc');
	});

	it("markSynced keeps a soft-deleted item 'deleted' but records the serverId", async () => {
		const id = await seed({});
		// Simulate: update push in flight, user deletes → soft delete (serverId set).
		await dbService.markSynced(id, 'k17abc');
		await dbService.remove(id); // serverId != null → syncStatus 'deleted'
		await dbService.markSynced(id, 'k17abc'); // the in-flight push completing

		const after = await dbService.get(id);
		expect(after?.syncStatus).toBe('deleted'); // next sync pushes the DELETE
		expect(after?.serverId).toBe('k17abc');
	});

	it('markSynced is a no-op for a hard-deleted item', async () => {
		const id = await seed({});
		await dbService.remove(id); // serverId null → hard delete
		await dbService.markSynced(id, 'k17abc');
		expect(await dbService.get(id)).toBeUndefined();
	});

	it("markError never flips a 'deleted' item to 'error'", async () => {
		const id = await seed({});
		await dbService.markSynced(id, 'k17abc');
		await dbService.remove(id);
		await dbService.markError(id); // the in-flight push failing

		const after = await dbService.get(id);
		expect(after?.syncStatus).toBe('deleted');
	});

	it('markError marks a live item for retry', async () => {
		const id = await seed({});
		await dbService.markError(id);
		expect((await dbService.get(id))?.syncStatus).toBe('error');
	});
});
