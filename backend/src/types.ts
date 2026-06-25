export interface Item {
	id: number;
	sku: string;
	name: string;
	barcode: string;
	description: string;
	is_active: boolean;
	/** Optional fields used by the richer dashboard view; passed through as-is. */
	category?: string;
	photos?: string[];
}

/** Shape accepted when creating/updating an item (id is server-assigned). */
export type ItemInput = Partial<Omit<Item, 'id'>>;
