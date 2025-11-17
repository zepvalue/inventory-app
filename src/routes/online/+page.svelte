<script lang="ts">
	import { onMount } from 'svelte';
	import { writable } from 'svelte/store';
	import Dashboard from '$lib/components/Dashboard.svelte'; // Import the Dashboard component

	// Store to hold online status
	const isOnline = writable<boolean>(false);
	const checking = writable<boolean>(true); // To indicate if we are checking connectivity

	// Function to check internet connectivity
	async function checkInternetConnection() {
		try {
			// Attempt to fetch a small resource to check connectivity
			const response = await fetch('https://www.google.com/favicon.ico', {
				method: 'HEAD', // Use HEAD to minimize data transfer
				mode: 'no-cors' // Prevent CORS issues, we just need the response
			});
			isOnline.set(true); // Set online status to true
		} catch (error) {
			console.error('No internet connection:', error);
			isOnline.set(false); // Set online status to false
		} finally {
			checking.set(false); // Mark checking as complete
		}
	}

	onMount(() => {
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
</script>

<div>
	{#if $checking}
		<p>Checking internet connection...</p>
	{:else if $isOnline}
		<div class="bg-green-100 border-l-4 border-green-500 text-green-700 p-2 mb-4">
			You are online. All changes will be synced.
		</div>
	{:else}
		<div class="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-2 mb-4">
			You are currently offline. Changes will be stored locally and synced when back online.
		</div>
	{/if}

	<Dashboard {isOnline} {checking} />
</div>
