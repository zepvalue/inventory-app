import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
    // Consult https://kit.svelte.dev/docs/integrations#preprocessors
    // for more information about preprocessors
    preprocess: vitePreprocess(),

    kit: {
        // This is the crucial part. We're telling SvelteKit to use the static adapter.
        adapter: adapter({
            // default options are fine
            pages: 'build',
            assets: 'build',
            fallback: 'index.html', // This enables SPA mode.
            precompress: false,
            strict: true
        })
    }
};

export default config;
