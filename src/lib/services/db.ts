// src/lib/services/db.ts

import Dexie, { type Table } from 'dexie';
import { browser } from '$app/environment';

export interface Item {
  id: string | number | undefined; // ✅ Allows string, number, or undefined
  name: string;
  sku: string;
  barcode: string;
  description: string;
  is_active: boolean;
  // You can remove syncStatus and serverId if you're not using them
  syncStatus?: 'pending' | 'synced' | 'deleted';
  serverId?: number;
  lastModified?: number;
}

// ✅ Dexie schema is defined by extending the Dexie class
export class MySubClassedDexie extends Dexie {
    items!: Table<Item>;

    constructor() {
        super('inventory_db');
        this.version(1).stores({
            // Schema definition: '++id' for auto-incrementing primary key
            // 'syncStatus,lastModified' are the indexes
            items: '++id, syncStatus, lastModified'
        });
    }
}

class DatabaseService {
    // ✅ The db instance is created once
    private db: MySubClassedDexie;
    private readonly API_URL = 'https://inventory.online/api/v1/items';

    constructor() {
        if (browser) {
            this.db = new MySubClassedDexie();
        }
    }

    // ✅ No initDB() method is needed. Dexie handles it.

    // Add an item to local DB
    // In your dbService.js
    async addItem(item: Omit<Item, 'id' | 'serverId' | 'syncStatus' | 'lastModified'>): Promise<Item> {
        const newItem: Item = {
            ...item,
            serverId: null, // <-- This is the key change
            syncStatus: 'pending',
            lastModified: Date.now()
        };
        // 'id' will be the local auto-incrementing ID
        const id = await this.db.items.add(newItem);
        return { ...newItem, id };
    }

    // Replace your existing updateItem function with this one.
    async updateItem(item: Item): Promise<Item> {
        // Only mark an item as pending for an update if it has successfully synced before.
        // If serverId is null or undefined, it means the item is still pending its FIRST creation sync.
        // In that case, its syncStatus should already be 'pending', and we don't need to change it.
        const newSyncStatus = item.serverId ? 'pending' : item.syncStatus;

        const updatedItem: Item = {
            ...item,
            syncStatus: newSyncStatus,
            lastModified: Date.now()
        };
        await this.db.items.put(updatedItem);
        return updatedItem;
    }

    // Get all items from local DB
    // In your dbService file
    async getAllItems(): Promise<Item[]> {
        // Return only items that are NOT marked for deletion.
        return await this.db.items.where('syncStatus').notEqual('deleted').toArray();
    }

    // Get a single item by ID
    async getItem(id: number): Promise<Item | undefined> {
        return this.db.items.get(id);
    }

    // In your dbService.js
    async syncWithServer() {
        // Get all items that are not in sync with the server (pending or deleted)
        const pendingItems = await this.db.items.where('syncStatus').notEqual('synced').toArray();

        for (const item of pendingItems) {
            // Remove local-only fields before sending to server
            const { id, syncStatus, lastModified, ...payload } = item;

            try {
                if (item.syncStatus === 'pending') {
                    // This handles CREATE and UPDATE logic as discussed before
                    if (item.serverId === null) {
                        // --- CREATE ---
                        const response = await fetch('https://inventory.online/api/v1/items', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', /* ...other headers */ },
                            body: JSON.stringify(payload)
                        });
                        const serverItem = await response.json();
                        // Update the local item with the real serverId and mark as synced
                        await this.db.items.update(item.id, {
                            serverId: serverItem.id,
                            syncStatus: 'synced'
                        });
                    } else {
                        // --- UPDATE ---
                        const response = await fetch(`https://inventory.online/api/v1/items/${item.serverId}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' /* ...other headers */ },
                            body: JSON.stringify(payload)
                        });

                        // ✅ THIS IS THE CRUCIAL CHECK
                        if (!response.ok) {
                            // The server responded with an error (e.g., 422 validation error)
                            const errorData = await response.json();
                            // Throw an error to stop the process for this item.
                            // It will remain 'pending' and try to sync again later.
                            throw new Error(`Update failed for item ${item.serverId}: ${JSON.stringify(errorData)}`);
                        }

                        // If the response was successful, THEN mark it as synced.
                        await this.db.items.update(item.id, { syncStatus: 'synced' });
                    }

                } else if (item.syncStatus === 'deleted') {
                    // --- THIS IS THE NEW DELETE LOGIC ---
                    // Only send a DELETE request if the item was ever synced with the server
                    if (item.serverId) {
                        await fetch(`https://inventory.online/api/v1/items/${item.serverId}`, {
                            method: 'DELETE',
                            headers: { /* ...your auth headers */ }
                        });
                    }

                    // After successfully telling the server (or if it never existed on the server),
                    // we can now permanently delete it from the local database.
                    await this.db.items.delete(item.id);
                }
            } catch (error) {
                console.error(`Failed to sync item ${item.id} with status ${item.syncStatus}:`, error);
            }
        }
    }

    // Clear all data (useful for testing)
    async clearAll(): Promise<void> {
        await this.db.items.clear();
    }

    // In your dbService file
    async deleteItem(id: number): Promise<void> {
        // "Soft delete" by marking the item for deletion.
        // This keeps the record locally so we can tell the server what to delete.
        await this.db.items.update(id, { syncStatus: 'deleted' });
    }
}

// Export a singleton instance
export const dbService = new DatabaseService();