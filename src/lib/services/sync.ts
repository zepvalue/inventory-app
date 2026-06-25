// The sync engine. Pushes pending local changes to the backend and pulls server
// changes back, automatically, whenever a connection is available — on app load,
// on the browser `online` event, and (debounced) after local edits.

import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { dbService } from './db';
import { toPayload, type ServerItem } from './sync-logic';
import { apiFetch } from '$lib/api/http';

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
				if (item.serverId != null) {
					const res = await apiFetch(`/api/v1/items/${item.serverId}`, { method: 'DELETE' });
					if (!res.ok && res.status !== 404) throw new Error(`delete failed (${res.status})`);
				}
				await dbService.hardDelete(item.id);
			} else if (item.serverId == null) {
				const res = await apiFetch('/api/v1/items', {
					method: 'POST',
					body: JSON.stringify(toPayload(item))
				});
				if (!res.ok) throw new Error(`create failed (${res.status})`);
				const saved = await res.json();
				await dbService.markSynced(item.id, saved.id);
			} else {
				const res = await apiFetch(`/api/v1/items/${item.serverId}`, {
					method: 'PUT',
					body: JSON.stringify(toPayload(item))
				});
				if (!res.ok) throw new Error(`update failed (${res.status})`);
				await dbService.markSynced(item.id, item.serverId);
			}
		} catch (e) {
			hadError = true;
			await dbService.markError(item.id);
			lastSyncError.set(e instanceof Error ? e.message : 'Push failed');
		}
	}

	return hadError;
}

/** Pull the server's items and merge them into the local store. */
async function pullFromServer(): Promise<void> {
	const res = await apiFetch('/api/v1/items', { method: 'GET' });
	if (!res.ok) throw new Error(`fetch failed (${res.status})`);
	const body = await res.json();
	const serverItems: ServerItem[] = Array.isArray(body)
		? body
		: Array.isArray(body?.data)
			? body.data
			: [];
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
