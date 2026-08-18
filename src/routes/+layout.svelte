<script lang="ts">
    import { MdTheme } from '$lib/components';

    // The service worker (src/service-worker.ts) is registered by SvelteKit
    // automatically in production builds — no manual registration here.
</script>

<svelte:head>
    <!-- This links your manifest file to the application -->
    <link rel="manifest" href="/manifest.json" />
    <!-- This sets the theme color for the browser UI on mobile -->
    <meta name="theme-color" content="#6750a4" />
</svelte:head>

<MdTheme>
<!-- The <slot /> tag is where your page content (like +page.svelte) will be rendered. -->
<slot />
</MdTheme>


