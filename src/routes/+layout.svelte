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
<div class="app-shell">
    <!-- The <slot /> tag is where your page content (like +page.svelte) will be rendered. -->
    <slot />
    <footer class="app-footer">Powered by <a class="app-footer-link" href="https://zepvalue.github.io" target="_blank" rel="noopener noreferrer">zepvalue</a></footer>
</div>
</MdTheme>

<style>
    .app-shell {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
    }

    .app-footer {
        flex-shrink: 0;
        text-align: center;
        padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
        font-size: 12px;
        color: var(--md-sys-color-on-surface-variant);
    }

    .app-footer-link {
        color: var(--md-sys-color-primary);
        text-decoration: none;
    }

    .app-footer-link:hover,
    .app-footer-link:focus-visible {
        text-decoration: underline;
    }
</style>
