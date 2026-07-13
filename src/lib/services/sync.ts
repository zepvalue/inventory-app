// The sync engine. Pushes pending local changes to Convex (the online store) and
// pulls server changes back, automatically, whenever a connection is available —
// on app load, on the browser `online` event, and (debounced) after local edits.

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { dbService } from './db';
import { toPayload, shouldMarkErrorOnFailedPush } from './sync-logic';
import { listItems, createItem, updateItem, removeItem } from '$lib/convex';

/** Reactive status for the UI. */
export const online = writable<boolean>(browser ? navigator.onLine : true);
export const syncing = writable<boolean>(false);
export const pendingCount = writable<number>(0);
export const lastSyncError = writable<string | null>(null);
export const lastSyncedAt = writable<number | null>(null);

async function refreshPendingCount(): Promise<void> {
	if (!browser) return;
	pendingCount.set((await dbService.pending()).length);
}

/** Push every unsynced local item. Returns true if any item failed. */
async function pushPending(): Promise<boolean> {
	const items = await dbService.pending();
	let hadError = false;

	for (const item of items) {
		if (item.id == null) continue;
		try {
			if (item.syncStatus === 'deleted') {
				// Convex remove is idempotent — deleting an already-gone id is a no-op.
				if (item.serverId != null) await removeItem(item.serverId);
				await dbService.hardDelete(item.id);
			} else if (item.serverId == null) {
				const saved = await createItem(toPayload(item));
				await dbService.markSynced(item.id, saved.id);
			} else {
				await updateItem(item.serverId, toPayload(item));
				await dbService.markSynced(item.id, item.serverId);
			}
		} catch (e) {
			hadError = true;
			// A failed delete must stay 'deleted' so the next sync retries the DELETE
			// (see shouldMarkErrorOnFailedPush) instead of resurrecting the item.
			if (shouldMarkErrorOnFailedPush(item.syncStatus)) await dbService.markError(item.id);
			lastSyncError.set(e instanceof Error ? e.message : 'Push failed');
		}
	}

	return hadError;
}

/** Pull Convex's items and merge them into the local store. */
async function pullFromServer(): Promise<void> {
	const serverItems = await listItems();
	await dbService.applyReconcile(serverItems);
}

/** Run a full sync (push then pull). Safe to call any time; no-ops when offline. */
export async function sync(): Promise<void> {
	if (!browser) return;
	if (!navigator.onLine) {
		online.set(false);
		return;
	}
	if (get(syncing)) return; // a sync is already in flight

	online.set(true);
	syncing.set(true);
	lastSyncError.set(null);
	try {
		const pushHadError = await pushPending();
		await pullFromServer();
		if (!pushHadError) lastSyncedAt.set(Date.now());
	} catch (e) {
		lastSyncError.set(e instanceof Error ? e.message : 'Sync failed');
	} finally {
		await refreshPendingCount();
		syncing.set(false);
	}
}

let debounce: ReturnType<typeof setTimeout> | undefined;

/** Call after a local edit: updates the pending badge and schedules a sync. */
export function queueSync(onChange?: () => void): void {
	if (!browser) return;
	refreshPendingCount();
	if (!navigator.onLine) return;
	clearTimeout(debounce);
	debounce = setTimeout(() => void sync().then(() => onChange?.()), 800);
}

/**
 * Start the engine. Runs an initial sync when online and reconnects on the
 * `online` event. `onChange` fires after each background sync so the UI can
 * refresh. Returns a cleanup function (wire it to onMount).
 */
export function initSync(onChange?: () => void): () => void {
	if (!browser) return () => {};

	const run = () => void sync().then(() => onChange?.());
	const handleOnline = () => {
		online.set(true);
		run();
	};
	const handleOffline = () => online.set(false);

	window.addEventListener('online', handleOnline);
	window.addEventListener('offline', handleOffline);

	online.set(navigator.onLine);
	void refreshPendingCount();
	if (navigator.onLine) run();

	return () => {
		window.removeEventListener('online', handleOnline);
		window.removeEventListener('offline', handleOffline);
	};
}
