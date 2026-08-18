/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Offline app shell for the SPA. SvelteKit builds this file and registers it
// automatically (the manual registration in +layout.svelte is gone). Unlike the
// old hand-rolled worker in static/, `build` lists every hashed bundle of the
// *current* build, so the precache is always complete and consistent — the
// stale-HTML-pointing-at-missing-chunks race that caused the offline white
// screen can't happen: a new deploy gets a new `version`, hence a new cache,
// and old caches are dropped only after the new one is fully populated.

const sw = self as unknown as ServiceWorkerGlobalScope;

import { build, files, version } from '$service-worker';

const CACHE = `app-shell-${version}`;

// adapter-static's SPA fallback (build/index.html) is served for every route
// but appears in neither `build` nor `files`, so cache it via '/' explicitly.
// Offline navigations to any route get this shell and the client router takes
// over — which also retires static/offline.html.
const SHELL = '/';

const PRECACHE = [...build, ...files, SHELL];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	// Convex traffic is a websocket (not intercepted) or cross-origin photo
	// URLs; only same-origin GETs are ours to serve.
	if (event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	if (url.origin !== sw.location.origin) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);

			// Precached assets are content-hashed → immutable → cache-first.
			if (PRECACHE.includes(url.pathname)) {
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
			}

			try {
				const response = await fetch(event.request);
				if (response.ok) cache.put(event.request, response.clone());
				return response;
			} catch (err) {
				const cached = await cache.match(event.request);
				if (cached) return cached;
				// Any offline navigation falls back to the SPA shell.
				if (event.request.mode === 'navigate') {
					const shell = await cache.match(SHELL);
					if (shell) return shell;
				}
				throw err;
			}
		})()
	);
});
