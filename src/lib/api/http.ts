import { apiUrl } from '$lib/config';
import { getToken } from './auth-token';

/**
 * The single chokepoint for all backend calls. Auth lives here and nowhere else,
 * so the sync engine and UI never deal with tokens directly: if a token has been
 * stored (set at login), it's attached as `Authorization: Bearer <token>`.
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

	return fetch(apiUrl(path), { ...init, headers });
}
