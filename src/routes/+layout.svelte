<script lang="ts">
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';

    onMount(() => {
        // This check ensures the code only runs in the browser, not on the server.
        if (browser && 'serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js')
                .then((registration) => {
                    console.log('Service Worker registered with scope:', registration.scope);
                })
                .catch((error) => {
                    console.error('Service Worker registration failed:', error);
                });
        }
    });
</script>

<svelte:head>
    <!-- This links your manifest file to the application -->
    <link rel="manifest" href="/manifest.json" />
    <!-- This sets the theme color for the browser UI on mobile -->
    <meta name="theme-color" content="#4f46e5" />
</svelte:head>

<!-- The <slot /> tag is where your page content (like +page.svelte) will be rendered. -->
<slot />

