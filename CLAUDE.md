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
- Avoid `any`. TypeScript is strict everywhere (frontend `tsconfig` and `convex/`).
- Write or update tests as part of every task, not as an afterthought.

---

## 2. Project overview

**Product:** A mobile-first inventory management app. Users manage inventory items
(SKU, name, barcode, description, active flag). Items are scanned via the device
camera, stored offline on-device, and synced to **Convex** (the online store).

**Shape:** A SvelteKit single-page app wrapped with **Capacitor** so the same web
build ships as a native iOS/Android app.

> ℹ️ **Backend is Convex** (functions in `convex/`, running on Convex's cloud). It
> replaced the old Express API, which has been removed. The offline-first Dexie
> layer is unchanged; the sync engine pushes/pulls through `src/lib/convex.ts`.
> **Auth is deferred (Phase 2):** there's no login gate and the Convex item
> functions are currently **unauthenticated** — anyone with the deployment URL can
> read/write. Provision a deployment with `npx convex dev`; the frontend reads
> `PUBLIC_CONVEX_URL`.

**Key characteristics:**
- **Offline-first** — items live in IndexedDB (Dexie) and sync to Convex.
- **Barcode scanning** — camera-based, runs in the WebView (works in browser too).
- **No auth yet** — deferred to Phase 2 (was bearer-token against Express).

---

## 3. Repository structure

```
inventory-app/
├── src/                         SvelteKit frontend (package name: inventory-mobile)
│   ├── lib/
│   │   ├── convex.ts            The Convex seam — listItems/createItem/updateItem/removeItem
│   │   ├── api/auth.ts          Login/logout (DEFERRED — unused until Phase 2 auth)
│   │   ├── api/http.ts          apiFetch chokepoint (DEFERRED — used only by auth.ts now)
│   │   ├── components/          BarcodeScanner, Dashboard, ItemForm (Svelte 5)
│   │   ├── services/db.ts       Dexie (IndexedDB) store — `dbService` singleton
│   │   ├── services/sync.ts     Sync engine — pushes/pulls via src/lib/convex.ts
│   │   ├── services/sync-logic.ts  Pure reconcile helpers (unit-tested)
│   │   └── config.ts            apiUrl()/API_BASE (DEFERRED — only the auth flow uses it)
│   └── routes/                  SvelteKit pages (dashboard, login, …)
├── convex/                      Convex backend (runs on Convex cloud)
│   ├── schema.ts                `items` table definition
│   ├── items.ts                 list/create/update/remove functions
│   └── _generated/              Convex codegen (created by `npx convex dev`)
├── static/                      Static assets served as-is
├── build/                       adapter-static output → Capacitor `webDir`
├── capacitor.config.ts          appId online.inventory.app, webDir 'build'
├── svelte.config.js             adapter-static, SPA mode (fallback index.html)
├── vite.config.ts               host:true, PUBLIC_ env prefix, vitest config
├── render.yaml                  Render Blueprint (static frontend + convex deploy)
└── Makefile                     Convenience targets (see `make help`)
```

**One npm package** at the repo root. Convex functions live in `convex/` and are
pushed to Convex's cloud by the Convex CLI, not bundled by Vite.

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
| Backend | Convex (functions in `convex/`, hosted on Convex cloud) |
| Auth | None yet — deferred to Phase 2 (Convex functions are unauthenticated) |
| Testing | Vitest (jsdom) |
| Lint / format | ESLint 9 + Prettier |
| Hosting | Frontend: Render static site (`render.yaml`) · Backend: Convex cloud |

---

## 5. Backend contract (Convex)

The sync engine depends on the exact shapes the Convex functions return — treat
these as a public API. Functions live in [`convex/items.ts`](convex/items.ts); the
frontend calls them only through the seam in [`src/lib/convex.ts`](src/lib/convex.ts)
(`listItems` / `createItem` / `updateItem` / `removeItem`).

- `items.list` (query) → all item docs (the pull).
- `items.create` (mutation) → inserts, returns the new doc — the frontend maps
  `_id` onto its local `serverId`.
- `items.update` (mutation) → full replace of the editable fields, returns the doc.
- `items.remove` (mutation) → hard delete by `_id`.

The item fields are defined once in [`convex/schema.ts`](convex/schema.ts)
(`itemFields`): `{ sku, name, barcode, description, category?, photos, is_active }`.
Convex supplies `_id` and `_creationTime`; there is no separate `id` column.
Argument validation is Convex validators (`v.*`) — invalid args are rejected
before the handler runs.

**These functions are unauthenticated (Phase 1).** Anyone with the deployment URL
can read/write. Gating them on a session is the Phase 2 auth pass.

---

## 6. Auth (deferred to Phase 2)

There is currently **no login gate**. The old bearer-token flow against Express is
retired, but its frontend plumbing is kept for the Phase 2 auth pass:
[`src/lib/api/auth.ts`](src/lib/api/auth.ts) (login/logout),
[`src/lib/api/auth-token.ts`](src/lib/api/auth-token.ts) (localStorage token), and
the [`apiFetch`](src/lib/api/http.ts) chokepoint. None of it is exercised by the
item flow anymore — items go through `src/lib/convex.ts`. When Phase 2 lands,
either wire these to Convex auth or delete them.

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

- The Convex deployment URL comes from **`PUBLIC_CONVEX_URL`** (Vite inlines
  `PUBLIC_`-prefixed vars at build time). Locally, `npx convex dev` provisions a
  dev deployment and writes the URL to `.env.local`; in production, the Render
  build injects it via `npx convex deploy --cmd-url-env-var-name PUBLIC_CONVEX_URL`
  (see [`render.yaml`](render.yaml)).
- `CONVEX_DEPLOY_KEY` is a **build-time secret** set in the Render dashboard
  (never committed, never shipped to the browser) — it lets the build push the
  `convex/` functions to the prod deployment.
- `PUBLIC_API_BASE` / [`src/lib/config.ts`](src/lib/config.ts) are **deferred** —
  only the unused Phase 2 auth flow reads them. See [`.env.example`](.env.example).
- **Never commit `.env` / `.env.local`.** Commit `.env.example` (no secrets) instead.

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

**Backend (Convex, repo root):**
```bash
npx convex dev       # provision/watch a dev deployment; pushes convex/ on change
npx convex deploy    # push functions to the prod deployment (CI does this)
```

**Mobile (Capacitor) — Xcode + CocoaPods (iOS) / Android Studio + JDK (Android):**
```bash
make mobile-add-ios          # one-time: scaffold native iOS project
make mobile-add-android      # one-time: scaffold native Android project
npm run cap:sync             # build web assets + copy into native projects
npm run cap:ios              # build, sync, open Xcode
npm run cap:android          # build, sync, open Android Studio
```

**Testing on a phone over Wi-Fi (no native build):** run `npm run dev` (with
`npx convex dev` running so `PUBLIC_CONVEX_URL` is set) and open
`http://<mac-lan-ip>:5173` in the phone's browser (same Wi-Fi). The Vite server
already binds all interfaces, and Convex is reachable from anywhere.

---

## 10. Testing

- Tests run under **jsdom** (`vite.config.ts`); files match
  `src/**/*.{test,spec}.{js,ts}` — e.g. the pure sync-reconcile helpers in
  `src/lib/services/sync-logic.ts`.
- A change to the Convex function contract (names, args, or return shapes in
  `convex/items.ts`) must update **both** the seam in `src/lib/convex.ts` and any
  sync code/tests that depend on it.
- Don't test third-party internals (Dexie, Convex), pixel positions, or things
  the type system already guarantees.

---

## 11. Architecture & conventions

- **No hardcoded URLs** — the Convex URL comes from `PUBLIC_CONVEX_URL` via
  [`src/lib/convex.ts`](src/lib/convex.ts); nothing else should construct backend URLs.
- **No direct Convex calls from components** — go through the `src/lib/convex.ts` seam.
- **No direct Dexie access from components** — go through `dbService`.
- Keep the frontend a pure SPA: `adapter-static` with `fallback: index.html` means
  there is **no server-side rendering or server routes** in the SvelteKit app. Don't
  add `+page.server.ts` / `+server.ts` logic that assumes a Node server at runtime.
- Components are **Svelte 5** — use runes (`$state`, `$derived`, `$props`) for new code.
- Convex functions validate their args with **Convex validators** (`v.*` from
  `convex/values`) — define shared field shapes once in `convex/schema.ts`
  (`itemFields`) and reuse them in function args.

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
2. Check [`convex/items.ts`](convex/items.ts) / [`src/lib/convex.ts`](src/lib/convex.ts)
   before changing anything that crosses the frontend↔backend boundary.
3. Check [`src/lib/services/db.ts`](src/lib/services/db.ts) before touching offline/sync logic.
4. For mobile/native behaviour, check [`capacitor.config.ts`](capacitor.config.ts) and the
   Capacitor docs.
5. Ask one focused question rather than assuming and proceeding.
