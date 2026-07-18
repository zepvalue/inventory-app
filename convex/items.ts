import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { itemFields } from './schema';
import type { Id } from './_generated/dataModel';

// Item CRUD. These mirror the old Express contract the sync engine expects:
//   list   -> all items (the pull)
//   create -> insert, returns the new doc (frontend reads _id -> serverId)
//   update -> full replace of the editable fields
//   remove -> hard delete by id
//
// NOTE (Phase 1): these functions are intentionally unauthenticated — the login
// gate was deferred. Anyone with the deployment URL can call them. Gating on a
// Convex session is the follow-up auth pass.
//
// Photos: `photos` on the stored doc is an array of Convex File Storage ids —
// the frontend (src/lib/convex.ts) uploads image bytes separately and only
// ever sends ids here, keeping item docs well under Convex's 1MiB document
// limit. `list` additionally resolves those ids to servable `photoUrls` for
// display; `update`/`remove` delete storage files that fall out of the item
// so replacing/removing a photo doesn't leak storage.

async function resolvePhotoUrls(
	ctx: { storage: { getUrl: (id: Id<'_storage'>) => Promise<string | null> } },
	photos: string[]
) {
	const urls = await Promise.all(photos.map((id) => ctx.storage.getUrl(id as Id<'_storage'>)));
	return urls.filter((url): url is string => url !== null);
}

export const generateUploadUrl = mutation({
	args: {},
	handler: async (ctx) => {
		return await ctx.storage.generateUploadUrl();
	}
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		const items = await ctx.db.query('items').collect();
		return await Promise.all(
			items.map(async (item) => ({
				...item,
				photoUrls: await resolvePhotoUrls(ctx, item.photos)
			}))
		);
	}
});

export const create = mutation({
	args: itemFields,
	handler: async (ctx, args) => {
		const id = await ctx.db.insert('items', args);
		return await ctx.db.get(id);
	}
});

export const update = mutation({
	args: { id: v.id('items'), ...itemFields },
	handler: async (ctx, { id, ...fields }) => {
		const existing = await ctx.db.get(id);
		await ctx.db.replace(id, fields);
		if (existing) {
			const kept = new Set(fields.photos);
			const orphaned = existing.photos.filter((p) => !kept.has(p));
			await Promise.all(
				orphaned.map((storageId) => ctx.storage.delete(storageId as Id<'_storage'>))
			);
		}
		return await ctx.db.get(id);
	}
});

export const remove = mutation({
	args: { id: v.id('items') },
	handler: async (ctx, { id }) => {
		const existing = await ctx.db.get(id);
		if (existing) {
			await Promise.all(
				existing.photos.map((storageId) => ctx.storage.delete(storageId as Id<'_storage'>))
			);
		}
		await ctx.db.delete(id);
	}
});
