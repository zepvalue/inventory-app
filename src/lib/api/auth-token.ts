// Tiny wrapper around the persisted auth token. Kept isolated so the storage
// mechanism (localStorage today; Capacitor Preferences / SecureStore later) can
// change without touching callers.
import { browser } from '$app/environment';

const KEY = 'auth_token';

export function getToken(): string | null {
	if (!browser) return null;
	try {
		return localStorage.getItem(KEY);
	} catch {
		return null;
	}
}

export function setToken(token: string): void {
	if (!browser) return;
	try {
		localStorage.setItem(KEY, token);
	} catch {
		/* storage unavailable (private mode) — ignore */
	}
}

export function clearToken(): void {
	if (!browser) return;
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* ignore */
	}
}
