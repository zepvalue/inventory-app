<script lang="ts">
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import ItemForm from '$lib/components/ItemForm.svelte';

	// item.interface.ts
	interface Item {
		id: number;
		sku: string;
		name: string;
		description?: string;
		category_id?: number;
		barcode?: string;
		reorder_level: number;
		reorder_quantity: number;
		min_stock_level: number;
		max_stock_level?: number;
		supplier_id?: number;
		cost_price: string; // Initially as string based on your response
		selling_price: string; // Initially as string based on your response
		tax_rate: string; // Initially as string based on your response
		is_active: boolean;
		sync_status: string;
		last_modified?: string;
		created_at?: string | null; // Allow null
		updated_at?: string | null; // Allow null
	}

	// State management
	let showForm = false; // Flag to determine if the form should be shown
	let formMode: 'create' | 'edit' = 'create'; // Track whether the form is in create or edit mode
	let selectedItem: Item | null = null; // The currently selected item for editing

	// Store for managing items, loading state, and error messages
	const items = writable<Item[]>([]);
	const loading = writable<boolean>(true);
	const error = writable<string | null>(null);

	// Fetch items from the server when the component mounts
	onMount(async () => {
		await fetchItems();
	});

	// Function to fetch items from the backend API
	async function fetchItems() {
		loading.set(true); // Set loading state
		try {
			const res = await fetch('http://localhost:8000/api/v1/items', {
				credentials: 'include'
			});
			if (!res.ok) throw new Error('Failed to fetch items');
			const data = await res.json();
			items.set(data.data); // Update the items store with the fetched data
		} catch (err) {
			error.set(err.message || 'Error fetching items'); // Set error message if fetching fails
		} finally {
			loading.set(false); // Reset loading state
		}
	}

	// Function to handle creating a new item
	function handleNew() {
		formMode = 'create'; // Set form mode to create
		selectedItem = { id: undefined, name: '', sku: '', barcode: '', is_active: true }; // Initialize a new item
		showForm = true; // Show the form
	}

	// Function to handle editing an existing item
	function handleEdit(item: Item) {
		formMode = 'edit'; // Set form mode to edit
		selectedItem = { ...item }; // Clone the item to avoid direct mutation
		showForm = true; // Show the form
	}

	// Function to handle form submission
	async function handleSubmit(item: Item) {
		const url =
			formMode === 'edit' && item.id
				? `http://localhost:8000/api/v1/items/${item.id}` // URL for updating an existing item
				: 'http://localhost:8000/api/v1/items'; // URL for creating a new item

		const method = formMode === 'edit' ? 'PUT' : 'POST'; // Determine the HTTP method

		try {
			const res = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json'
				},
				credentials: 'include',
				body: JSON.stringify(item) // Send the item data as JSON
			});

			if (!res.ok) {
				const errorData = await res.json();
				throw new Error(errorData.message || 'Failed to save item'); // Handle error response
			}

			showForm = false; // Close the form after successful submission
			await fetchItems(); // Refresh the item list
		} catch (err) {
			console.error(err); // Log error to the console
			alert(err.message || 'Failed to save item'); // Alert the user on error
		}
	}

	// Function to handle form cancellation
	function handleCancel() {
		showForm = false; // Close the form
	}
</script>

<h1 class="text-2xl font-bold mb-4">Inventory Dashboard</h1>

{#if $loading}
	<p>Loading...</p>
{:else if $error}
	<p class="text-red-500">{$error}</p>
{:else}
	<div class="overflow-x-auto">
		<table class="min-w-full border border-gray-300 rounded-lg shadow-lg bg-white">
			<thead class="bg-gray-200">
				<tr>
					<th class="p-4 text-left text-gray-700 font-medium">Name</th>
					<th class="p-4 text-left text-gray-700 font-medium">SKU</th>
					<th class="p-4 text-left text-gray-700 font-medium">Barcode</th>
					<th class="p-4 text-left text-gray-700 font-medium">Cost Price</th>
					<th class="p-4 text-left text-gray-700 font-medium">Selling Price</th>
					<th class="p-4 text-left text-gray-700 font-medium">Tax Rate</th>
					<th class="p-4 text-left text-gray-700 font-medium">Status</th>
					<th class="p-4 text-left text-gray-700 font-medium">Last Modified</th>
					<th class="p-4 text-left text-gray-700 font-medium">Actions</th>
				</tr>
			</thead>
			<tbody class="bg-white">
				{#each $items as item}
					<tr class="border-b hover:bg-gray-100 transition duration-200">
						<td class="p-4">{item.name}</td>
						<td class="p-4">{item.sku}</td>
						<td class="p-4">{item.barcode}</td>
						<td class="p-4">${parseFloat(item.cost_price).toFixed(2)}</td>
						<td class="p-4">${parseFloat(item.selling_price).toFixed(2)}</td>
						<td class="p-4">{parseFloat(item.tax_rate).toFixed(2)}%</td>
						<td class="p-4">{item.is_active ? 'Active' : 'Inactive'}</td>
						<td class="p-4"
							>{item.last_modified ? new Date(item.last_modified).toLocaleString() : 'N/A'}</td
						>
						<td class="p-4">
							<button
								class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 focus:outline-none transition duration-200"
								on:click={() => handleEdit(item)}
							>
								Edit
							</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<style>
		/* Additional custom styles can be added here */
		table {
			border-collapse: collapse; /* Ensures borders are merged */
			border: 1px solid;
		}

		th {
			border-bottom: 2px solid #e0e0e0; /* Adds bottom border to headers */
			border: 1px solid;
		}

		td,
		th {
			transition: background-color 0.3s; /* Smooth transitions for hover effects */
			border: 1px solid;
			padding: 5px;
		}

		tr:hover td {
			background-color: #f5f5f5; /* Light gray background on row hover */
			border: 1px solid;
		}
	</style>

	<button class="mt-4 px-4 py-2 bg-green-600 text-white rounded" on:click={handleNew}>
		Add New Item
	</button>

	{#if showForm}
		<ItemForm {selectedItem} {formMode} onSubmit={handleSubmit} onCancel={handleCancel} />
	{/if}
{/if}
