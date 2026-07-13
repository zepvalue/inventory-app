import { redirect } from '@sveltejs/kit';

// The app has no content at `/`. Auth is deferred (Phase 1 of the Convex
// migration), so there's no login gate yet — send everyone straight to the
// dashboard. Restore the token check here when Convex auth lands.
export const load = () => {
	throw redirect(307, '/dashboard');
};
