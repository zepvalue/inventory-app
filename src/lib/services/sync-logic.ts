// Pure, side-effect-free sync helpers. Kept separate from db.ts/sync.ts so the
// tricky reconciliation logic can be unit-tested without IndexedDB or the network.

import type { Item, SyncStatus } from './db';

/**
 * After a push to the server fails, decide whether to flip the item to 'error'.
 * A 'deleted' item must stay 'deleted' so the next sync retries the DELETE —
 * flipping it to 'error' would resurface it in the list and re-push it as an
 * update, silently resurrecting an item the user deleted.
 */
export function shouldMarkErrorOnFailedPush(status: SyncStatus): boolean {
	return status !== 'deleted';
}

/**
 * The item shape the online store returns. `id` is Convex's string document id
 * (`_id`), mapped in src/lib/convex.ts before it reaches this layer.
 */
export interface ServerItem {
	id: string;
	sku: string;
	name: string;
	barcode?: string;
	description?: string;
	is_active?: boolean;
	category?: string;
	photos?: string[];
}

/**
 * Strip local-only bookkeeping fields before sending an item to the server.
 * barcode/description/photos are always sent (Convex requires them); category
 * is optional.
 */
export function toPayload(item: Item) {
	return {
		sku: item.sku,
		name: item.name,
		barcode: item.barcode ?? '',
		description: item.description ?? '',
		is_active: item.is_active,
		photos: item.photos ?? [],
		...(item.category !== undefined ? { category: item.category } : {})
	};
}

/** Map a server item into a fresh local record (no local id; Dexie assigns it). */
export function fromServer(s: ServerItem, now: number): Omit<Item, 'id'> {
	return {
		serverId: s.id,
		sku: s.sku ?? '',
		name: s.name ?? '',
		barcode: s.barcode ?? '',
		description: s.description ?? '',
		category: s.category,
		photos: s.photos ?? [],
		is_active: s.is_active ?? true,
		syncStatus: 'synced',
		lastModified: now
	};
}

export interface ReconcilePlan {
	toInsert: Omit<Item, 'id'>[];
	toUpdate: { id: number; changes: Omit<Item, 'id'> }[];
	toDelete: number[];
}

/**
 * Compute how to merge the server's items into the local store, without ever
 * clobbering unsynced local work:
 *  - server item with no local match           -> insert (as synced)
 *  - server item matching a *synced* local item -> refresh local fields
 *  - server item matching a local item with pending/error/deleted changes -> leave it
 *  - synced local item whose serverId vanished server-side -> delete locally
 *  - local item with serverId === null (an outgoing create) -> never pruned
 */
export function planReconcile(local: Item[], server: ServerItem[], now: number): ReconcilePlan {
	const localByServerId = new Map<string, Item>();
	for (const l of local) {
		if (l.serverId != null) localByServerId.set(l.serverId, l);
	}

	const serverIds = new Set<string>();
	const toInsert: Omit<Item, 'id'>[] = [];
	const toUpdate: { id: number; changes: Omit<Item, 'id'> }[] = [];

	for (const s of server) {
		serverIds.add(s.id);
		const match = localByServerId.get(s.id);
		if (!match) {
			toInsert.push(fromServer(s, now));
		} else if (match.syncStatus === 'synced' && match.id != null) {
			toUpdate.push({ id: match.id, changes: fromServer(s, now) });
		}
		// else: local copy has unsynced changes — keep it for the next push.
	}

	const toDelete: number[] = [];
	for (const l of local) {
		if (
			l.syncStatus === 'synced' &&
			l.serverId != null &&
			l.id != null &&
			!serverIds.has(l.serverId)
		) {
			toDelete.push(l.id);
		}
	}

	return { toInsert, toUpdate, toDelete };
}
