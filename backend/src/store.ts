import type { Item, ItemInput } from './types.js';

/**
 * In-memory item store. Data resets on restart — fine for development/testing.
 * Swap the internals for a real DB (Postgres/SQLite) without changing callers.
 */
class ItemStore {
	private items: Item[] = [];
	private nextId = 1;

	constructor(seed: Omit<Item, 'id'>[] = []) {
		for (const s of seed) this.create(s);
	}

	all(): Item[] {
		return this.items;
	}

	find(id: number): Item | undefined {
		return this.items.find((i) => i.id === id);
	}

	create(input: ItemInput): Item {
		const item: Item = {
			id: this.nextId++,
			sku: input.sku ?? '',
			name: input.name ?? '',
			barcode: input.barcode ?? '',
			description: input.description ?? '',
			is_active: input.is_active ?? true,
			...(input.category !== undefined ? { category: input.category } : {}),
			...(input.photos !== undefined ? { photos: input.photos } : {})
		};
		this.items.push(item);
		return item;
	}

	update(id: number, input: ItemInput): Item | undefined {
		const item = this.find(id);
		if (!item) return undefined;
		// Never let the client overwrite the server id.
		const { ...rest } = input as ItemInput & { id?: number };
		delete (rest as { id?: number }).id;
		Object.assign(item, rest);
		return item;
	}

	remove(id: number): boolean {
		const idx = this.items.findIndex((i) => i.id === id);
		if (idx === -1) return false;
		this.items.splice(idx, 1);
		return true;
	}
}

export const store = new ItemStore([
	{ sku: 'SKU-001', name: 'Cordless Drill', barcode: '0123456789012', description: '18V brushless', is_active: true },
	{ sku: 'SKU-002', name: 'Tarp 10x12', barcode: '0123456789029', description: 'Heavy-duty shade tarp', is_active: true },
	{ sku: 'SKU-003', name: 'LED Floodlight', barcode: '0123456789036', description: '100W work light', is_active: false }
]);
