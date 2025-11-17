<script lang="ts">
  import { writable } from 'svelte/store';
  import { onMount } from 'svelte';

  // States
  const equipmentList = writable<Array<string>>([]);
  const isOnline = writable<boolean>(false);
  const isLoading = writable<boolean>(true);
  const error = writable<string | null>(null);

  // API URL (replace with your actual API endpoint)
  const apiUrl = import.meta.env.VITE_API_URL;

  // Fetch equipment data from API
  const fetchEquipment = async () => {
    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error('Failed to fetch equipment');
      }
      const data = await response.json();
      equipmentList.set(data); // Assuming the data is an array of equipment
    } catch (err: any) {
      error.set(err.message);
    } finally {
      isLoading.set(false);
    }
  };

  // Run when the component mounts
  onMount(() => {
    fetchEquipment();

    // Set online/offline status
    isOnline.set(navigator.onLine);
    window.addEventListener('online', () => isOnline.set(true));
    window.addEventListener('offline', () => isOnline.set(false));

    // Cleanup event listeners
    return () => {
      window.removeEventListener('online', () => isOnline.set(true));
      window.removeEventListener('offline', () => isOnline.set(false));
    };
  });
</script>

<main class="p-4">
  <h1>Equipment List</h1>

  <!-- Display online/offline status -->
  <div>Status: {$isOnline ? 'Online' : 'Offline'}</div>

  <!-- Show loading indicator if fetching data -->
  {#if $isLoading}
    <div>Loading equipment...</div>
  {:else if $error}
    <div>Error: {$error}</div>
  {:else}
    <!-- Display the equipment list -->
    <ul>
      {#each $equipmentList as equipment}
        <li>{equipment.name}</li> <!-- Adjust this based on the structure of your API response -->
      {/each}
    </ul>
  {/if}
</main>

<style>
  main {
    font-family: sans-serif;
  }

  ul {
    padding-left: 20px;
  }

  li {
    list-style-type: circle;
  }
</style>
