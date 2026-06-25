import { redirect } from '@sveltejs/kit';
import { getToken } from '$lib/api/auth-token';

// The app has no content at `/` — send people to the right place. Runs
// client-side only (ssr is disabled in +layout.ts), so localStorage is available.
export const load = () => {
	throw redirect(307, getToken() ? '/dashboard' : '/login');
};
