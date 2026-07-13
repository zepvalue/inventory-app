// The single seam between the offline-first sync engine and Convex (the online
// store). Everything Convex-specific lives here; sync.ts just calls these four
// functions, so swapping transports again later means touching only this file.

import { ConvexClient } from 'convex/browser';
import { makeFunctionReference } from 'convex/server';
import { browser } from '$app/environment';
import type { ServerItem } from './services/sync-logic';

const CONVEX_URL = import.meta.env.PUBLIC_CONVEX_URL as string | undefined;

/** A raw Convex document: our fields plus Convex's system columns. */
interface ConvexItem {
	_id: string;
	_creationTime: number;
	sku: string;
	name: string;
	barcode: string;
	description: string;
	category?: string;
	photos: string[];
	is_active: boolean;
}

/** The editable fields sent to create/update (see toPayload in sync-logic). */
export interface ItemPayload {
	sku: string;
	name: string;
	barcode: string;
	description: string;
	category?: string;
	photos: string[];
	is_active: boolean;
}

// String-based references so this module compiles before `npx convex dev` has
// generated convex/_generated/api. They're intentionally loosely typed (Convex's
// FunctionReference wants an index-signature arg type); the exported wrapper
// functions below carry the real types. Once provisioned, swap these for the
// typed `api.items.*` references (import { api } from '../../convex/_generated/api')
// to get end-to-end checking and drop the casts.
const listRef = makeFunctionReference<'query'>('items:list');
const createRef = makeFunctionReference<'mutation'>('items:create');
const updateRef = makeFunctionReference<'mutation'>('items:update');
const removeRef = makeFunctionReference<'mutation'>('items:remove');

let client: ConvexClient | null = null;

function getClient(): ConvexClient {
	if (!browser) throw new Error('Convex client is only available in the browser');
	if (!CONVEX_URL) {
		throw new Error('PUBLIC_CONVEX_URL is not set — run `npx convex dev` and set it in .env');
	}
	if (!client) client = new ConvexClient(CONVEX_URL);
	return client;
}

/** Map a raw Convex document onto the frontend's ServerItem (id = _id). */
function toServerItem(doc: ConvexItem): ServerItem {
	return {
		id: doc._id,
		sku: doc.sku,
		name: doc.name,
		barcode: doc.barcode,
		description: doc.description,
		category: doc.category,
		photos: doc.photos,
		is_active: doc.is_active
	};
}

export async function listItems(): Promise<ServerItem[]> {
	const docs = (await getClient().query(listRef, {})) as ConvexItem[];
	return docs.map(toServerItem);
}

export async function createItem(payload: ItemPayload): Promise<ServerItem> {
	const doc = (await getClient().mutation(createRef, payload)) as ConvexItem;
	return toServerItem(doc);
}

export async function updateItem(id: string, payload: ItemPayload): Promise<ServerItem> {
	const doc = (await getClient().mutation(updateRef, { id, ...payload })) as ConvexItem;
	return toServerItem(doc);
}

export async function removeItem(id: string): Promise<void> {
	await getClient().mutation(removeRef, { id });
}
