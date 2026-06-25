// This is an offline-first SPA: there is no runtime server. Disabling SSR keeps
// browser-only code (Dexie/IndexedDB, navigator.onLine) out of the build-time
// render, and adapter-static still emits the index.html fallback shell.
export const ssr = false;
export const prerender = false;
