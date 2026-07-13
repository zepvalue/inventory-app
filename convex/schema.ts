import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

// The online item store. Convex supplies `_id` (a string document id) and
// `_creationTime` automatically, so we don't model an `id` column here — the
// frontend maps `_id` onto its local `serverId`.
export const itemFields = {
	sku: v.string(),
	name: v.string(),
	barcode: v.string(),
	description: v.string(),
	category: v.optional(v.string()),
	photos: v.array(v.string()),
	is_active: v.boolean()
};

export default defineSchema({
	items: defineTable(itemFields)
});
