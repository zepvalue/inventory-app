import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import devtoolsJson from 'vite-plugin-devtools-json';

export default defineConfig({
    plugins: [
        sveltekit(),
        devtoolsJson()
    ],
    server: {
        // This setting is correct for running behind a proxy.
        host: true,

        // This is good for virtual environments.
        watch: {
            usePolling: true,
        },
        port: 5173,
        strictPort: true,

        // --- THIS IS THE FIX ---
        // This line explicitly tells Vite that it is safe to serve
        // requests from your public domain.
        allowedHosts: [
            'test.inventory.online'
        ],
    }
});
