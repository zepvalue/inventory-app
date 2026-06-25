import { describe, it, expect } from 'vitest';
import { planReconcile, toPayload, fromServer, type ServerItem } from './sync-logic';
import type { Item } from './db';

const NOW = 1_700_000_000_000;

function local(partial: Partial<Item>): Item {
	return {
		id: 1,
		serverId: null,
		sku: 'SKU',
		name: 'Name',
		barcode: '',
		description: '',
		photos: [],
		is_active: true,
		syncStatus: 'synced',
		lastModified: 0,
		...partial
	};
}

function server(partial: Partial<ServerItem>): ServerItem {
	return { id: 100, sku: 'SKU', name: 'Name', ...partial };
}

describe('toPayload', () => {
	it('drops local-only bookkeeping fields', () => {
		const payload = toPayload(local({ id: 5, serverId: 9, syncStatus: 'pending', lastModified: 42 }));
		expect(payload).not.toHaveProperty('id');
		expect(payload).not.toHaveProperty('serverId');
		expect(payload).not.toHaveProperty('syncStatus');
		expect(payload).not.toHaveProperty('lastModified');
		expect(payload).toMatchObject({ sku: 'SKU', name: 'Name', is_active: true });
	});
});

describe('fromServer', () => {
	it('produces a synced local record with no local id', () => {
		const rec = fromServer(server({ id: 7, name: 'Drill' }), NOW);
		expect(rec).not.toHaveProperty('id');
		expect(rec.serverId).toBe(7);
		expect(rec.name).toBe('Drill');
		expect(rec.syncStatus).toBe('synced');
		expect(rec.lastModified).toBe(NOW);
	});
});

describe('planReconcile', () => {
	it('inserts server items with no local match', () => {
		const plan = planReconcile([], [server({ id: 100 })], NOW);
		expect(plan.toInsert).toHaveLength(1);
		expect(plan.toInsert[0].serverId).toBe(100);
		expect(plan.toUpdate).toHaveLength(0);
		expect(plan.toDelete).toHaveLength(0);
	});

	it('refreshes a synced local item from its server match', () => {
		const items = [local({ id: 1, serverId: 100, name: 'old', syncStatus: 'synced' })];
		const plan = planReconcile(items, [server({ id: 100, name: 'new' })], NOW);
		expect(plan.toUpdate).toHaveLength(1);
		expect(plan.toUpdate[0].id).toBe(1);
		expect(plan.toUpdate[0].changes.name).toBe('new');
		expect(plan.toInsert).toHaveLength(0);
	});

	it('never overwrites a local item with unsynced changes', () => {
		const items = [local({ id: 1, serverId: 100, name: 'mine', syncStatus: 'pending' })];
		const plan = planReconcile(items, [server({ id: 100, name: 'theirs' })], NOW);
		expect(plan.toUpdate).toHaveLength(0);
		expect(plan.toInsert).toHaveLength(0);
		expect(plan.toDelete).toHaveLength(0);
	});

	it('deletes a synced local item the server no longer has', () => {
		const items = [local({ id: 1, serverId: 100, syncStatus: 'synced' })];
		const plan = planReconcile(items, [], NOW);
		expect(plan.toDelete).toEqual([1]);
	});

	it('never prunes an outgoing local create (serverId null)', () => {
		const items = [local({ id: 1, serverId: null, syncStatus: 'pending' })];
		const plan = planReconcile(items, [], NOW);
		expect(plan.toDelete).toHaveLength(0);
		expect(plan.toUpdate).toHaveLength(0);
	});
});
