// Auth is deferred (Phase 1 of the Convex migration): no login gate yet, so the
// dashboard is reachable without a token. Convex item functions are currently
// unauthenticated. Restore a guard here when Convex auth lands.
export const load = () => {};
