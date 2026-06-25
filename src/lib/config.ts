/**
 * Base URL of the backend API.
 *
 * Configure per-environment with the PUBLIC_API_BASE env var (see .env.example).
 * Vite inlines this at build time (envPrefix includes PUBLIC_ in vite.config.ts).
 * Falls back to the production host when unset so existing builds keep working.
 */
const DEFAULT_API_BASE = 'https://inventory-app-2aqa.onrender.com';

export const API_BASE = (import.meta.env.PUBLIC_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');

/** Build an absolute API URL from a path, e.g. apiUrl('/api/v1/items'). */
export function apiUrl(path: string): string {
	return `${API_BASE}/${path.replace(/^\/+/, '')}`;
}
