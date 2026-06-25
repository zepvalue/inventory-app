import { redirect } from '@sveltejs/kit';
import { getToken } from '$lib/api/auth-token';

// Guard the dashboard: without a token the API calls would 401 anyway.
export const load = () => {
	if (!getToken()) throw redirect(307, '/login');
};
