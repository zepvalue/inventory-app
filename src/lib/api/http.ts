import { browser } from '$app/environment';
import { goto } from '$app/navigation';
import { apiUrl } from '$lib/config';
import { getToken, clearToken } from './auth-token';

/**
 * The single chokepoint for all backend calls. Auth lives here and nowhere else,
 * so the sync engine and UI never deal with tokens directly: if a token has been
 * stored (set at login), it's attached as `Authorization: Bearer <token>`.
 *
 * A 401 means the stored token is gone or invalid (e.g. the in-memory backend
 * restarted and dropped it). Drop the dead token and bounce to /login so the
 * user re-authenticates instead of silently 401-ing against stale credentials.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const headers = new Headers(init.headers);
	headers.set('Accept', 'application/json');
	if (init.body && !headers.has('Content-Type')) {
		headers.set('Content-Type', 'application/json');
	}

	const token = getToken();
	if (token && !headers.has('Authorization')) {
		headers.set('Authorization', `Bearer ${token}`);
	}

	const res = await fetch(apiUrl(path), { ...init, headers });

	if (res.status === 401 && browser) {
		clearToken();
		if (!window.location.pathname.startsWith('/login')) {
			void goto('/login');
		}
	}

	return res;
}
