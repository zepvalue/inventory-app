import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Item } from './db';
import type { ServerItem } from './sync-logic';

// vi.mock factories are hoisted above imports, so build the mocks in vi.hoisted()
// (which runs first) and reference them from both the factories and the tests.
const { convex, db } = vi.hoisted(() => ({
	convex: {
		listItems: vi.fn(),
		createItem: vi.fn(),
		updateItem: vi.fn(),
		removeItem: vi.fn(),
		resetClient: vi.fn()
	},
	db: {
		pending: vi.fn(),
		get: vi.fn(),
		markSynced: vi.fn(),
		markError: vi.fn(),
		hardDelete: vi.fn(),
		applyReconcile: vi.fn()
	}
}));

// Force the browser guard on so sync() actually runs under jsdom.
vi.mock('$app/environment', () => ({ browser: true }));
// Mock the Convex seam and the local store.
vi.mock('$lib/convex', () => convex);
vi.mock('./db', () => ({ dbService: db }));

import { sync } from './sync';

function item(partial: Partial<Item>): Item {
	return {
		id: 1,
		serverId: null,
		sku: 'SKU',
		name: 'Name',
		barcode: '',
		description: '',
		photos: [],
		is_active: true,
		syncStatus: 'pending',
		lastModified: 0,
		...partial
	};
}

/** Queue items for the next push; db.get serves their current state (the push
 *  re-reads each item to catch mid-flight edits/deletes). */
function queue(items: Item[]) {
	db.pending.mockResolvedValueOnce(items);
	db.get.mockImplementation(async (id: number) => items.find((i) => i.id === id));
}

function serverItem(id: string): ServerItem {
	return {
		id,
		sku: 'SKU',
		name: 'Name',
		barcode: '',
		description: '',
		photos: [],
		is_active: true
	};
}

describe('sync push (CRUD via Convex)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
		db.applyReconcile.mockResolvedValue(undefined);
		// pending() runs once at the start of the push and again via refreshPendingCount().
		db.pending.mockResolvedValue([]);
		convex.listItems.mockResolvedValue([]); // the pull
	});

	it('CREATE: creates a new item and marks it synced with the Convex id', async () => {
		queue([item({ id: 7, serverId: null, syncStatus: 'pending' })]);
		convex.createItem.mockResolvedValue(serverItem('k17abc'));

		await sync();

		expect(convex.createItem).toHaveBeenCalledTimes(1);
		expect(db.markSynced).toHaveBeenCalledWith(7, 'k17abc');
		expect(db.markError).not.toHaveBeenCalled();
	});

	it('UPDATE: updates by serverId and re-marks it synced', async () => {
		queue([item({ id: 7, serverId: 'k17abc', syncStatus: 'pending' })]);
		convex.updateItem.mockResolvedValue(serverItem('k17abc'));

		await sync();

		expect(convex.updateItem).toHaveBeenCalledWith('k17abc', expect.any(Object));
		expect(db.markSynced).toHaveBeenCalledWith(7, 'k17abc');
		expect(db.markError).not.toHaveBeenCalled();
	});

	it('DELETE: removes by serverId and hard-deletes locally', async () => {
		queue([item({ id: 7, serverId: 'k17abc', syncStatus: 'deleted' })]);
		convex.removeItem.mockResolvedValue(undefined);

		await sync();

		expect(convex.removeItem).toHaveBeenCalledWith('k17abc');
		expect(db.hardDelete).toHaveBeenCalledWith(7);
	});

	it('DELETE of a never-synced item skips Convex and drops it locally', async () => {
		queue([item({ id: 7, serverId: null, syncStatus: 'deleted' })]);

		await sync();

		expect(convex.removeItem).not.toHaveBeenCalled();
		expect(db.hardDelete).toHaveBeenCalledWith(7);
	});

	it('failed DELETE stays queued (no markError) so the next sync retries it', async () => {
		queue([item({ id: 7, serverId: 'k17abc', syncStatus: 'deleted' })]);
		convex.removeItem.mockRejectedValue(new Error('boom'));

		await sync();

		// The regression: markError would flip 'deleted' -> 'error' and resurrect it.
		expect(db.markError).not.toHaveBeenCalled();
		expect(db.hardDelete).not.toHaveBeenCalled();
	});

	it('failed CREATE/UPDATE is marked error for retry', async () => {
		queue([item({ id: 7, serverId: 'k17abc', syncStatus: 'pending' })]);
		convex.updateItem.mockRejectedValue(new Error('boom'));

		await sync();

		expect(db.markError).toHaveBeenCalledWith(7);
		expect(db.markSynced).not.toHaveBeenCalled();
	});

	// The wedge regression: the Convex client never rejects while the backend is
	// unreachable, so without a deadline sync() would never settle and its
	// `syncing` latch would silently block every future sync until page reload.
	it('a hung server call times out: sync settles, resets the client, and the next sync runs', async () => {
		vi.useFakeTimers();
		try {
			queue([item({ id: 7, serverId: null, syncStatus: 'pending' })]);
			convex.createItem.mockReturnValue(new Promise(() => {})); // never settles

			const first = sync();
			await vi.advanceTimersByTimeAsync(21_000);
			await first;

			expect(db.markError).toHaveBeenCalledWith(7); // stays queued for retry
			expect(convex.resetClient).toHaveBeenCalled(); // queued mutation dropped

			// The latch must be released: a later sync reaches the server again.
			convex.createItem.mockResolvedValue(serverItem('k17abc'));
			queue([item({ id: 7, serverId: null, syncStatus: 'error' })]);
			const second = sync();
			await vi.advanceTimersByTimeAsync(1);
			await second;
			expect(db.markSynced).toHaveBeenCalledWith(7, 'k17abc');
		} finally {
			vi.useRealTimers();
		}
	});

	it('a hung push aborts the batch (no per-item deadline pile-up) and skips the pull', async () => {
		vi.useFakeTimers();
		try {
			queue([
				item({ id: 1, serverId: null, syncStatus: 'pending' }),
				item({ id: 2, serverId: null, syncStatus: 'pending' })
			]);
			convex.createItem.mockReturnValue(new Promise(() => {})); // never settles

			const run = sync();
			await vi.advanceTimersByTimeAsync(21_000);
			await run;

			expect(convex.createItem).toHaveBeenCalledTimes(1); // item 2 not attempted
			expect(convex.listItems).not.toHaveBeenCalled(); // pull skipped
		} finally {
			vi.useRealTimers();
		}
	});
});

// Deleting an item while a sync is in flight must not resurrect it: the push
// works from a snapshot taken before the delete, so each item is re-read just
// before (and, for creates, just after) its server call.
describe('delete during an in-flight sync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
		db.applyReconcile.mockResolvedValue(undefined);
		db.pending.mockResolvedValue([]);
		convex.listItems.mockResolvedValue([]);
	});

	it('an item hard-deleted after the snapshot is not pushed', async () => {
		db.pending.mockResolvedValueOnce([item({ id: 7, serverId: null, syncStatus: 'pending' })]);
		db.get.mockResolvedValue(undefined); // gone by the time the push reaches it

		await sync();

		expect(convex.createItem).not.toHaveBeenCalled();
		expect(db.markSynced).not.toHaveBeenCalled();
	});

	it('an item deleted while its CREATE is in flight is removed server-side, not marked synced', async () => {
		const pending = item({ id: 7, serverId: null, syncStatus: 'pending' });
		db.pending.mockResolvedValueOnce([pending]);
		// Present at the pre-push re-read, gone at the post-create check.
		db.get.mockResolvedValueOnce(pending).mockResolvedValueOnce(undefined);
		convex.createItem.mockResolvedValue(serverItem('k17abc'));

		await sync();

		// The regression: without the undo, the pull would re-insert 'k17abc'.
		expect(convex.removeItem).toHaveBeenCalledWith('k17abc');
		expect(db.markSynced).not.toHaveBeenCalled();
	});

	it('a sync requested during an in-flight sync runs afterwards instead of being dropped', async () => {
		let releaseCreate!: (v: ServerItem) => void;
		queue([item({ id: 7, serverId: null, syncStatus: 'pending' })]);
		convex.createItem.mockReturnValue(new Promise((r) => (releaseCreate = r)));

		const first = sync();
		await Promise.resolve(); // let the first sync reach the hanging create
		const second = sync(); // e.g. the delete's queueSync firing mid-flight
		releaseCreate(serverItem('k17abc'));
		await Promise.all([first, second]);

		// Two full sync passes ran (one pull each), not one.
		expect(convex.listItems).toHaveBeenCalledTimes(2);
	});
});
