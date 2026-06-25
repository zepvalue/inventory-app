import { apiUrl } from '$lib/config';
import { apiFetch } from './http';
import { setToken, clearToken } from './auth-token';

export interface LoginResult {
	success: boolean;
	message?: string;
}

/**
 * Bearer-token login: POST credentials, store the returned token. Every
 * subsequent request authenticates via that token (see apiFetch). No cookies,
 * no CSRF — identical behaviour in the browser PWA and the Capacitor app.
 */
export async function login(email: string, password: string): Promise<LoginResult> {
	try {
		const res = await fetch(apiUrl('/api/login'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ email, password })
		});

		if (!res.ok) {
			let message = 'Invalid email or password';
			try {
				const data = await res.json();
				if (data?.message) message = data.message;
			} catch {
				/* non-JSON error body — keep the default message */
			}
			return { success: false, message };
		}

		const data = await res.json();
		if (!data?.token) return { success: false, message: 'No token returned by the server' };

		setToken(data.token);
		return { success: true };
	} catch (err) {
		console.error(err);
		return { success: false, message: 'Unexpected error during login' };
	}
}

/** Revoke the token server-side (best effort) and clear it locally. */
export async function logout(): Promise<void> {
	try {
		await apiFetch('/logout', { method: 'POST' });
	} catch {
		/* offline — clear locally anyway */
	}
	clearToken();
}
