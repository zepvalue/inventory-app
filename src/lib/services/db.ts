// src/lib/services/db.ts
//
// The local source of truth. This is a pure local store — IndexedDB via Dexie —
// with NO network code. All reads/writes in the app go through `dbService`, which
// makes the app genuinely offline-first: data survives reloads and works with no
// connection. The sync engine (sync.ts) reconciles this store with the backend.

import Dexie, { type Table } from 'dexie';
import { browser } from '$app/environment';
import { planReconcile, type ServerItem } from './sync-logic';

export type SyncStatus =
	| 'pending' // local change waiting to be pushed
	| 'synced' // matches the server
	| 'error' // last push attempt failed; will retry
	| 'deleted'; // soft-deleted locally, waiting to be deleted server-side

export interface Item {
	/** Local primary key (Dexie auto-increment). Stable across syncs. */
	id?: number;
	/** Convex's document id once created remotely; null until the first create syncs. */
	serverId: string | null;
	sku: string;
	name: string;
	barcode: string;
	description: string;
	category?: string;
	photos: string[];
	is_active: boolean;
	syncStatus: SyncStatus;
	lastModified: number;
}

class InventoryDB extends Dexie {
	items!: Table<Item, number>;

	constructor() {
		super('inventory_db');
		// v2 keeps the v1 `++id` primary key and adds the serverId index used by sync.
		this.version(2).stores({
			items: '++id, serverId, syncStatus, lastModified'
		});
	}
}

/**
 * Normalise arbitrary input down to the editable item fields.
 *
 * `data` often comes straight from a Svelte 5 `$state` form object, whose arrays
 * are reactive Proxies. IndexedDB's structured-clone can't clone a Proxy (throws
 * DataCloneError), so `photos` is spread into a fresh plain array before it's
 * handed to Dexie. The other fields are primitives and clone fine.
 */
export function fields(data: Partial<Item>) {
	return {
		sku: data.sku ?? '',
		name: data.name ?? '',
		barcode: data.barcode ?? '',
		description: data.description ?? '',
		category: data.category,
		photos: data.photos ? [...data.photos] : [],
		is_active: data.is_active ?? true
	};
}

class DatabaseService {
	private db!: InventoryDB;

	constructor() {
		if (browser) this.db = new InventoryDB();
	}

	/** Everything not soft-deleted, sorted by name for stable display. */
	async getAllItems(): Promise<Item[]> {
		if (!browser) return [];
		const all = await this.db.items.where('syncStatus').notEqual('deleted').toArray();
		return all.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
	}

	/** Items with unsynced work (to push), in creation order. */
	async pending(): Promise<Item[]> {
		if (!browser) return [];
		return this.db.items.where('syncStatus').anyOf('pending', 'error', 'deleted').toArray();
	}

	async create(data: Partial<Item>): Promise<number> {
		if (!browser) throw new Error('Database is only available in the browser');
		return this.db.items.add({
			...fields(data),
			serverId: null,
			syncStatus: 'pending',
			lastModified: Date.now()
		});
	}

	async bulkCreate(list: Partial<Item>[]): Promise<void> {
		if (!browser || list.length === 0) return;
		const now = Date.now();
		await this.db.items.bulkAdd(
			list.map((d) => ({
				...fields(d),
				serverId: null,
				syncStatus: 'pending' as const,
				lastModified: now
			}))
		);
	}

	async update(id: number, data: Partial<Item>): Promise<void> {
		if (!browser) return;
		const existing = await this.db.items.get(id);
		if (!existing) return;
		// serverId is preserved (not in `fields`); editing a synced item re-queues it.
		await this.db.items.update(id, {
			...fields(data),
			syncStatus: 'pending',
			lastModified: Date.now()
		});
	}

	async remove(id: number): Promise<void> {
		if (!browser) return;
		const existing = await this.db.items.get(id);
		if (!existing) return;
		if (existing.serverId == null) {
			// Never reached the server — just drop it locally.
			await this.db.items.delete(id);
		} else {
			// Soft-delete so the next sync can tell the server to remove it.
			await this.db.items.update(id, { syncStatus: 'deleted', lastModified: Date.now() });
		}
	}

	// --- Used by the sync engine ----------------------------------------

	async markSynced(id: number, serverId: string): Promise<void> {
		if (!browser) return;
		await this.db.items.update(id, { serverId, syncStatus: 'synced' });
	}

	async markError(id: number): Promise<void> {
		if (!browser) return;
		await this.db.items.update(id, { syncStatus: 'error' });
	}

	async hardDelete(id: number): Promise<void> {
		if (!browser) return;
		await this.db.items.delete(id);
	}

	/** Merge the server's items into the local store (see planReconcile). */
	async applyReconcile(serverItems: ServerItem[]): Promise<void> {
		if (!browser) return;
		const local = await this.db.items.toArray();
		const plan = planReconcile(local, serverItems, Date.now());
		if (!plan.toInsert.length && !plan.toUpdate.length && !plan.toDelete.length) return;
		await this.db.transaction('rw', this.db.items, async () => {
			if (plan.toInsert.length) await this.db.items.bulkAdd(plan.toInsert as Item[]);
			for (const u of plan.toUpdate) await this.db.items.update(u.id, u.changes);
			if (plan.toDelete.length) await this.db.items.bulkDelete(plan.toDelete);
		});
	}

	async clearAll(): Promise<void> {
		if (!browser) return;
		await this.db.items.clear();
	}
}

export const dbService = new DatabaseService();
