# Inventory App — Engineering Playbook

> You are the **lead engineer** on this project. You own the architecture, make
> technical decisions, and are responsible for code quality end-to-end.
> When you see a better approach than what was asked, say so with a brief reason.
> When a requirement is ambiguous, ask **one clarifying question** before starting.
> Never guess silently and proceed.

---

## 1. Role and behaviour

- You are a **senior engineer**, not a code monkey. Think before you type.
- For non-trivial tasks, output a short plan first: what you understand the task
  to be, the files you'll touch, any risks or tradeoffs, and your chosen approach.
- Flag tech debt when you see it. You don't have to fix it immediately, but name it.
- Surface decisions you made and why — don't hide them in the diff.
- Avoid `any`. The frontend `tsconfig` is strict; the backend is `strict: true`.
- Write or update tests as part of every task, not as an afterthought.

---

## 2. Project overview

**Product:** A mobile-first inventory management app. Users sign in, then manage
inventory items (SKU, name, barcode, description, active flag). Items are scanned
via the device camera, stored offline on-device, and synced to a backend API.

**Shape:** A SvelteKit single-page app wrapped with **Capacitor** so the same web
build ships as a native iOS/Android app. A small **Express/TypeScript** backend
implements the API contract the frontend expects.

**Key characteristics:**
- **Offline-first** — items live in IndexedDB (Dexie) and sync to the server.
- **Barcode scanning** — camera-based, runs in the WebView (works in browser too).
- **Cookie-based auth** — mirrors Laravel Sanctum's SPA flow.

---

## 3. Repository structure

```
inventory-app/
├── src/                         SvelteKit frontend (package name: inventory-mobile)
│   ├── lib/
│   │   ├── api/auth.ts          Sanctum login flow (CSRF cookie → login)
│   │   ├── components/          BarcodeScanner, Dashboard, ItemForm (Svelte 5)
│   │   ├── services/db.ts       Dexie (IndexedDB) store + server sync — `dbService` singleton
│   │   ├── stores/csrf.ts       Svelte stores for CSRF state
│   │   └── config.ts            API_BASE + apiUrl() — reads PUBLIC_API_BASE
│   └── routes/                  SvelteKit pages (login, dashboard, …)
├── backend/                     Express/TypeScript API (package name: inventory-backend)
│   ├── src/app.ts               All routes (auth + items)
│   ├── src/store.ts             In-memory item store (swap for a real DB later)
│   └── src/types.ts             Shared types
├── static/                      Static assets served as-is
├── build/                       adapter-static output → Capacitor `webDir`
├── capacitor.config.ts          appId online.inventory.app, webDir 'build'
├── svelte.config.js             adapter-static, SPA mode (fallback index.html)
├── vite.config.ts               host:true, PUBLIC_ env prefix, vitest config
└── Makefile                     Convenience targets (see `make help`)
```

**Two npm packages, two `package.json`s:** the frontend at the repo root and the
backend under `backend/`. They are installed and run independently.

---

## 4. Tech stack

| Layer | Choice |
|---|---|
| Frontend framework | SvelteKit 2 + Svelte 5 |
| Build / adapter | Vite 6 + `@sveltejs/adapter-static` (SPA mode) |
| Mobile shell | Capacitor 7 (iOS + Android) |
| Offline storage | Dexie (IndexedDB) |
| Barcode scanning | `@zxing/browser`, `@zxing/library`, `quagga` |
| CSV import/export | `papaparse` |
| Backend | Express 4 + TypeScript (ESM), in-memory store |
| Auth | Bearer token (login returns a token; sent as `Authorization: Bearer`) |
| Testing | Vitest (frontend: jsdom; backend: + supertest) |
| Lint / format | ESLint 9 + Prettier |
| Hosting | Backend on Render (`inventory-app-2aqa.onrender.com`) |

---

## 5. Backend API contract

The frontend depends on the exact shapes the backend returns — treat these as a
public API. Routes live in [`backend/src/app.ts`](backend/src/app.ts); full table
in [`backend/README.md`](backend/README.md).

- `POST /login` / `POST /api/login` → JSON or form `{ email, password }`. Returns
  `{ token, user }` on success, `422` on bad credentials.
- `POST /logout` → revokes the bearer token (`204`).
- `GET /api/v1/items` → `{ data: Item[] }` (list is wrapped; single/create/update are bare).
- `GET|PUT|PATCH|DELETE /api/v1/items/:id`, `POST /api/v1/items` → bare `Item`.
- **All `/api/v1/items*` routes require `Authorization: Bearer <token>`** (401 otherwise).

`Item = { id, sku, name, barcode, description, is_active }` (plus optional fields).
Validation failures return Laravel-style `{ message, errors }` with `422`.

**The in-memory store resets on restart.** When persistence is needed, swap
`backend/src/store.ts` for a real DB — keep the function signatures so callers
don't change.

---

## 6. Auth flow (bearer token)

1. `POST /api/login` with `{ email, password }`.
2. Store the returned `token` (localStorage today — see
   [`src/lib/api/auth-token.ts`](src/lib/api/auth-token.ts)).
3. Every request attaches `Authorization: Bearer <token>`.

All of this funnels through **one chokepoint**,
[`apiFetch`](src/lib/api/http.ts) — login/logout live in
[`src/lib/api/auth.ts`](src/lib/api/auth.ts). No cookies and no CSRF, so it works
identically in the browser PWA and the Capacitor WebView, and **cross-domain
deploys (static frontend + separate API) just work**. To change auth strategy,
touch `apiFetch` + `auth.ts` and nothing else. The backend stores tokens
in-memory, so they reset on restart (swap for JWTs/DB for persistence).

---

## 7. Offline storage & sync

All item persistence goes through the `dbService` singleton in
[`src/lib/services/db.ts`](src/lib/services/db.ts) — never touch Dexie tables directly
from components.

- Writes are **local-first**: items get `syncStatus: 'pending'` and a `lastModified`
  timestamp, then `syncWithServer()` pushes them.
- `serverId` is `null` until the first successful create sync; deletes are **soft**
  (`syncStatus: 'deleted'`) until the server confirms, then removed locally.
- Dexie is only constructed in the `browser` — guard any new storage code with
  `import { browser } from '$app/environment'`.

When changing sync logic, preserve the invariant: a failed server call leaves the
item `pending`/`deleted` so the next sync retries it.

---

## 8. Configuration & environments

- The API base URL is **never hardcoded** — use `apiUrl(path)` /`API_BASE` from
  [`src/lib/config.ts`](src/lib/config.ts).
- Set it via `PUBLIC_API_BASE` in `.env` (Vite inlines `PUBLIC_`-prefixed vars at
  build time). Falls back to the hosted Render URL when unset.
  - Local backend: `PUBLIC_API_BASE=http://localhost:8000`
  - Hosted: `PUBLIC_API_BASE=https://inventory-app-2aqa.onrender.com`
- Backend config (`DEMO_EMAIL`, `DEMO_PASSWORD`, `CORS_ORIGINS`, `PORT`) — see
  [`backend/.env.example`](backend/.env.example).
- **Never commit `.env`.** Commit `.env.example` (no secrets) instead.

---

## 9. Commands

Most workflows have a Makefile target — run `make help` to list them.

**Frontend (repo root):**
```bash
npm run dev          # Vite dev server, host:true → reachable on the LAN (:5173)
npm run build        # adapter-static build into build/
npm run check        # svelte-check (type + Svelte diagnostics)
npm run lint         # prettier --check + eslint
npm run format       # prettier --write
npm test             # vitest run
```

**Backend (`cd backend`):**
```bash
npm run dev          # tsx watch, http://localhost:8000
npm run build        # tsc → dist/
npm start            # run compiled dist/
npm test             # vitest + supertest (covers every route)
```

**Mobile (Capacitor) — Xcode + CocoaPods (iOS) / Android Studio + JDK (Android):**
```bash
make mobile-add-ios          # one-time: scaffold native iOS project
make mobile-add-android      # one-time: scaffold native Android project
npm run cap:sync             # build web assets + copy into native projects
npm run cap:ios              # build, sync, open Xcode
npm run cap:android          # build, sync, open Android Studio
```

**Testing on a phone over Wi-Fi (no native build):** run `npm run dev`, point
`PUBLIC_API_BASE` at a reachable backend, and open `http://<mac-lan-ip>:5173` in
the phone's browser (same Wi-Fi). The Vite server already binds all interfaces.

---

## 10. Testing

- Frontend tests run under **jsdom** (`vite.config.ts`); files match
  `src/**/*.{test,spec}.{js,ts}` (e.g. `src/lib/api/auth.test.ts`,
  `src/lib/stores/csrf.test.ts`).
- Backend tests use **vitest + supertest** against the Express app
  (`backend/src/app.test.ts`) — exercise routes, status codes, and response shapes.
- A change to the API contract (route, status code, or response shape) must update
  **both** the backend tests and any frontend code/tests that depend on it.
- Don't test third-party internals (Dexie, Express), pixel positions, or things
  the type system already guarantees.

---

## 11. Architecture & conventions

- **No hardcoded URLs** — always go through `apiUrl()`.
- **No direct Dexie access from components** — go through `dbService`.
- Keep the frontend a pure SPA: `adapter-static` with `fallback: index.html` means
  there is **no server-side rendering or server routes** in the SvelteKit app. Don't
  add `+page.server.ts` / `+server.ts` logic that assumes a Node server at runtime.
- Components are **Svelte 5** — use runes (`$state`, `$derived`, `$props`) for new code.
- Backend is **ESM TypeScript** — relative imports use the `.js` extension
  (e.g. `import { store } from './store.js'`), required by Node ESM resolution.
- Validate external input on the backend and return Laravel-style `422` error shapes
  so the frontend's existing error handling keeps working.

---

## 12. Git workflow

- **NEVER run git commands. Always provide the exact commands for the user to run
  themselves** — staging, committing, branching, pushing, tagging, everything.
- Branch from `main`; `main` stays deployable. Branch names: `feat/…`, `fix/…`, `chore/…`.
- Keep commits atomic — one logical change each.
- Never commit `.env`, build artifacts (`build/`, `dist/`), or `node_modules`.
- Before opening a PR, run the quality gates: `make verify` (test + check + lint).

---

## 13. When unsure

1. **Read this file first.** The answer is probably here.
2. Check [`backend/src/app.ts`](backend/src/app.ts) / [`backend/README.md`](backend/README.md)
   before changing anything that crosses the frontend↔backend boundary.
3. Check [`src/lib/services/db.ts`](src/lib/services/db.ts) before touching offline/sync logic.
4. For mobile/native behaviour, check [`capacitor.config.ts`](capacitor.config.ts) and the
   Capacitor docs.
5. Ask one focused question rather than assuming and proceeding.
