import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
	appId: 'online.inventory.app',
	appName: 'Inventory',
	// SvelteKit's adapter-static writes the SPA build here (see svelte.config.js).
	webDir: 'build',
	server: {
		// Required for cookie-based (Sanctum) auth to work inside the WebView.
		androidScheme: 'https'
	}
};

export default config;
