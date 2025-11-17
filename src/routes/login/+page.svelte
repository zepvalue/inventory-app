<script lang="ts">
	import { goto } from '$app/navigation';
	import { writable } from 'svelte/store';
	import { onMount } from 'svelte';
	import ItemForm from '$lib/components/ItemForm.svelte';

	let email = '';
	let password = '';
	let errorMessage = '';
	const isLoading = writable<boolean>(true);
	let showForm = false; // Flag to determine if the form should be shown
	let formMode: 'create' | 'edit' = 'create'; // Track whether the form is in create or edit mode
	let selectedItem: Item | null = null; // The currently selected item for editing

	// Store to hold online status
	const isOnline = writable<boolean>(false);
	const checking = writable<boolean>(true); // To indicate if we are checking connectivity

	// Store for managing items, loading state, and error messages
	const items = writable<Item[]>([]);
	const error = writable<string | null>(null);

	interface Item {
		id?: number;
		sku: string;
		name: string;
		barcode: string;
		is_active: boolean;
	}

	// Function to fetch items from the backend API
	async function fetchItems() {
		isLoading.set(true); // Set loading state
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
			isLoading.set(false); // Reset loading state
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

	// Function to check internet connectivity
	async function checkInternetConnection() {
		try {
			// Attempt to fetch a small resource to check connectivity
			const response = await fetch('https://www.google.com/favicon.ico', {
				method: 'HEAD', // Use HEAD to minimize data transfer
				mode: 'no-cors' // Prevent CORS issues, we just need the response
			});
			console.log({ response });
			if (response.ok) {
				isOnline.set(true); // Set online status to true
				isLoading.set(false);
				await fetchItems();
			}
		} catch (error) {
			console.error('No internet connection:', error);
			isOnline.set(false); // Set online status to false
		} finally {
			checking.set(false); // Mark checking as complete
		}
	}

	onMount(() => {
		console.log('ONLINE!');
		// Check online status using the function
		checkInternetConnection();

		// Set up event listeners for online/offline events
		window.addEventListener('online', checkInternetConnection);
		window.addEventListener('offline', () => {
			isOnline.set(false);
			checking.set(false); // Mark checking as complete
		});

		// Cleanup event listeners on component destroy
		return () => {
			window.removeEventListener('online', checkInternetConnection);
			window.removeEventListener('offline', () => isOnline.set(false));
		};
	});

	async function login() {
		// Step 1: Fetch fresh CSRF cookie
		await fetch('http://localhost:8000/sanctum/csrf-cookie', {
			method: 'GET',
			credentials: 'include'
		});

		// Step 2: Read fresh XSRF-TOKEN from cookies
		const cookies = document.cookie.split(';').map((c) => c.trim());
		const xsrfCookie = cookies.find((c) => c.startsWith('XSRF-TOKEN='));
		const csrfToken = xsrfCookie ? decodeURIComponent(xsrfCookie.split('=')[1]) : '';

		// Step 3: Send login request with fresh XSRF token header
		const formData = new URLSearchParams();
		formData.append('email', email);
		formData.append('password', password);

		const res = await fetch('http://localhost:8000/api/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-XSRF-TOKEN': csrfToken,
				Accept: 'application/json'
			},
			credentials: 'include',
			body: formData
		});

		if (!res.ok) {
			// Handle error
		} else {
			goto('/dashboard');
		}
	}
</script>

<!-- Online/Offline Status Indicator -->
{#if isOnline}
	<div class="bg-green-100 border-l-4 border-green-500 text-green-700 p-2 mb-4">
		You are online. All changes will be synced.
	</div>
{:else}
	<div class="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-2 mb-4">
		You are currently offline. Changes will be stored locally and synced when back online.
	</div>
{/if}

{#if errorMessage}
	<div style="color: red;">{errorMessage}</div>
{/if}

<div class="p-4">
	<h1 class="text-2xl font-bold mb-4">Inventory Dashboard !!</h1>

	{#if $isLoading}
		<p>Loading...</p>
	{:else if $error}
		<p class="text-red-500">{$error}</p>
	{:else}
		<div class="overflow-x-auto">
			<table class="min-w-full border">
				<thead>
					<tr class="bg-gray-100">
						<th class="p-2 text-left">Name</th>
						<th class="p-2 text-left">SKU</th>
						<th class="p-2 text-left">Barcode</th>
						<th class="p-2 text-left">Status</th>
						<th class="p-2 text-left">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each $items as item}
						<tr class="border-b hover:bg-gray-50">
							<td class="p-2">{item.name}</td>
							<td class="p-2">{item.sku}</td>
							<td class="p-2">{item.barcode}</td>
							<td class="p-2">{item.is_active ? 'Active' : 'Inactive'}</td>
							<td class="p-2">
								<button
									class="text-sm text-blue-600 hover:underline"
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

		<button class="mt-4 px-4 py-2 bg-green-600 text-white rounded" on:click={handleNew}>
			Add New Item
		</button>

		{#if showForm}
			<ItemForm {selectedItem} {formMode} onSubmit={handleSubmit} onCancel={handleCancel} />
		{/if}
	{/if}
</div>

<!-- <form on:submit|preventDefault={login}>
	<label>
		Email:
		<input type="email" bind:value={email} required />
	</label>

	<label>
		Password:
		<input type="password" bind:value={password} required />
	</label>

	<button type="submit" disabled={isLoading}>
		{isLoading ? 'Logging in...' : 'Login'}
	</button>
</form> -->
