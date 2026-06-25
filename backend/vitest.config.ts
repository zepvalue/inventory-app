import { defineConfig } from 'vitest/config';

// Self-contained config so vitest doesn't inherit the parent SvelteKit vite.config.ts.
export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
