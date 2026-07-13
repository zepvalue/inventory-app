import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { itemFields } from './schema';

// Item CRUD. These mirror the old Express contract the sync engine expects:
//   list   -> all items (the pull)
//   create -> insert, returns the new doc (frontend reads _id -> serverId)
//   update -> full replace of the editable fields
//   remove -> hard delete by id
//
// NOTE (Phase 1): these functions are intentionally unauthenticated — the login
// gate was deferred. Anyone with the deployment URL can call them. Gating on a
// Convex session is the follow-up auth pass.

export const list = query({
	args: {},
	handler: async (ctx) => {
		return await ctx.db.query('items').collect();
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
		await ctx.db.replace(id, fields);
		return await ctx.db.get(id);
	}
});

export const remove = mutation({
	args: { id: v.id('items') },
	handler: async (ctx, { id }) => {
		await ctx.db.delete(id);
	}
});
