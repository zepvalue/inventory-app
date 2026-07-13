import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, goto } = vi.hoisted(() => ({
	store: { token: null as string | null },
	goto: vi.fn()
}));

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('./auth-token', () => ({
	getToken: () => store.token,
	clearToken: () => {
		store.token = null;
	}
}));

import { apiFetch } from './http';
import { getToken } from './auth-token';

describe('apiFetch', () => {
	beforeEach(() => {
		store.token = 'stale-token';
		goto.mockClear();
		window.history.replaceState({}, '', '/dashboard');
	});

	it('attaches the bearer token', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		await apiFetch('/api/v1/items');

		const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Headers;
		expect(headers.get('Authorization')).toBe('Bearer stale-token');
	});

	it('on 401 clears the token and redirects to /login', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

		const res = await apiFetch('/api/v1/items');

		expect(res.status).toBe(401);
		expect(getToken()).toBeNull();
		expect(goto).toHaveBeenCalledWith('/login');
	});

	it('does not redirect if already on /login', async () => {
		window.history.replaceState({}, '', '/login');
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

		await apiFetch('/api/login');

		expect(goto).not.toHaveBeenCalled();
	});

	it('leaves the token intact on a successful response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

		await apiFetch('/api/v1/items');

		expect(getToken()).toBe('stale-token');
		expect(goto).not.toHaveBeenCalled();
	});
});
