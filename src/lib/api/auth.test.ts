import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the token store so the test doesn't depend on browser/localStorage.
// (vitest requires factory-referenced vars to be `mock`-prefixed.)
const mockStore: { token: string | null } = { token: null };
vi.mock('./auth-token', () => ({
	getToken: () => mockStore.token,
	setToken: (t: string) => {
		mockStore.token = t;
	},
	clearToken: () => {
		mockStore.token = null;
	}
}));

import { login } from './auth';
import { getToken } from './auth-token';

describe('login', () => {
	beforeEach(() => {
		mockStore.token = null;
	});
	afterEach(() => vi.restoreAllMocks());

	it('stores the token and returns success', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'abc123' }), { status: 200 }))
		);

		const result = await login('admin@example.com', 'password');

		expect(result).toEqual({ success: true });
		expect(getToken()).toBe('abc123');
	});

	it('surfaces the server message on bad credentials', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ message: 'These credentials do not match our records.' }), {
					status: 422
				})
			)
		);

		const result = await login('admin@example.com', 'wrong');

		expect(result.success).toBe(false);
		expect(result.message).toBe('These credentials do not match our records.');
		expect(getToken()).toBeNull();
	});

	it('fails when the response has no token', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));

		const result = await login('admin@example.com', 'password');

		expect(result.success).toBe(false);
		expect(getToken()).toBeNull();
	});

	it('returns a generic error when fetch throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

		const result = await login('admin@example.com', 'password');

		expect(result).toEqual({ success: false, message: 'Unexpected error during login' });
	});
});
