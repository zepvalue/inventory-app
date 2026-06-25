<div align="center">

# 📦 Inventory

### Offline-first inventory management that syncs when you're ready.

*Scan barcodes, snap photos, and manage your stuff — with or without a connection.*

<br/>

![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?style=for-the-badge&logo=svelte&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Capacitor](https://img.shields.io/badge/Capacitor-7-119EFF?style=for-the-badge&logo=capacitor&logoColor=white)
![Express](https://img.shields.io/badge/Express-4-000000?style=for-the-badge&logo=express&logoColor=white)
![Dexie](https://img.shields.io/badge/Dexie-IndexedDB-DC382D?style=for-the-badge&logoColor=white)
![Material Design](https://img.shields.io/badge/Material_Design-3-6750A4?style=for-the-badge&logo=materialdesign&logoColor=white)

</div>

---

## ✨ What is Inventory?

Inventory is a **mobile-first, offline-first** app for tracking physical items. Add gear with auto-generated SKUs, snap photos with the camera, scan barcodes live, and bulk import from CSV — all without an internet connection. When you're back online, a background sync engine pushes your changes and pulls remote updates with conflict-aware reconciliation.

It's built as a **SvelteKit SPA** wrapped in **Capacitor** for native iOS and Android, backed by an Express API you can host anywhere.

<div align="center">
<img src="docs/screenshots/Screenshot%202026-06-25%20at%206.18.40PM.png" width="250" alt="Inventory Dashboard"/>
&nbsp;&nbsp;&nbsp;
<img src="docs/screenshots/Screenshot%202026-06-25%20at%206.18.49%E2%80%AFPM.png" width="250" alt="Add Item Form"/>
&nbsp;&nbsp;&nbsp;
<img src="docs/screenshots/Screenshot%202026-06-25%20at%206.19.07%E2%80%AFPM.png" width="250" alt="Item Detail View"/>
</div>

---

## 🎮 Features

- 🏠 **Offline-first** — create, edit, and delete items with zero connectivity; everything saves to IndexedDB
- 🔄 **Background sync** — pending changes push automatically when online, with conflict-aware two-way reconciliation
- 📷 **Camera capture** — snap photos directly in the app and attach them to items
- 📱 **Live barcode scanning** — point your camera at any Code 128, EAN, or UPC barcode
- 🏷️ **Auto-generated SKUs** — category-prefixed identifiers generated on the fly (e.g. `KIT12345678`)
- 📥 **CSV import/export** — bulk load items from a spreadsheet or dump your inventory to a file
- 🔐 **Bearer token auth** — simple email/password login with stateless tokens (no cookies, no CSRF)
- 🎨 **Material Design 3** — polished UI with Svelte 5 runes and smooth transitions
- 🚀 **One-click deploy** — Render Blueprint included for backend + static frontend

---

## 🧱 Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | SvelteKit (SPA) · Svelte 5 runes · Material Design 3 |
| **Mobile** | Capacitor 7 (iOS + Android) |
| **Local DB** | Dexie.js (IndexedDB) |
| **Barcode** | Quagga · ZXing |
| **Backend** | Express · TypeScript |
| **Auth** | Bearer token (in-memory) |
| **Test** | Vitest · Supertest |
| **Deploy** | Render Blueprint |

---

## 🚀 Getting Started

```bash
# 1. Install all dependencies (frontend + backend)
make install && make backend-install

# 2. Run the full stack (frontend + backend concurrently)
make dev-all
```

The frontend runs at **http://localhost:5173** and the backend at **http://localhost:8000**.

### Essential commands

| Command | What it does |
|---------|--------------|
| `make dev` | Frontend dev server (hot reload) |
| `make backend-dev` | Backend API on port 8000 |
| `make dev-all` | Both frontend + backend concurrently |
| `make build` | Production build |
| `make test` | Run frontend unit tests |
| `make backend-test` | Run backend tests |
| `make verify` | Tests + type-check + lint |
| `make ci` | Full CI: install → verify → build |
| `make mobile-ios` | Build, sync, and open in Xcode |
| `make mobile-android` | Build, sync, and open in Android Studio |
| `make help` | See every available command |

Run **`make help`** for the full categorized menu.

---

## 📁 Project Structure

```
inventory-app/
├── src/
│   ├── routes/
│   │   ├── dashboard/       # Main inventory screen (CRUD, scan, camera, CSV)
│   │   └── login/           # Auth screen
│   └── lib/
│       ├── api/             # HTTP client + auth token helpers
│       ├── components/      # Reusable Material Design 3 components
│       └── services/
│           ├── db.ts        # Local IndexedDB store (Dexie)
│           ├── sync.ts      # Background sync engine (push/pull)
│           └── sync-logic.ts # Pure reconciliation logic (unit-testable)
├── backend/
│   └── src/
│       ├── app.ts           # Express API (auth + CRUD)
│       ├── store.ts         # In-memory item store
│       └── types.ts         # Shared types
├── docs/screenshots/        # Screenshots used in this README
├── static/                  # PWA assets (service worker, manifest, icons)
├── Makefile                 # Command center (run `make help`)
└── render.yaml              # Render Blueprint for production deploy
```

---

## 🧠 How Offline-First Works

1. **Every write goes to IndexedDB first.** Create, update, delete — it's instant and survives reloads.
2. **Items get a `syncStatus`:** `pending` (local change not yet pushed), `synced` (matches server), `error` (push failed, will retry), or `deleted` (soft-deleted locally).
3. **The sync engine** pushes pending items on app load, on reconnect, and after every edit (debounced). It then pulls server changes and reconciles them without clobbering unsynced local work.
4. **Conflict resolution** is handled by `planReconcile()` — server items refresh local synced records, but any item with unsynced changes is preserved until the next push succeeds.

---

## 🗺️ Roadmap

- [ ] **Push notifications** — alert when sync fails or items need attention
- [ ] **Photo sync** — upload captured photos to the server (currently local-only)
- [ ] **Multi-user teams** — shared inventories with role-based access
- [ ] **JWT auth** — replace in-memory bearer tokens with signed JWTs
- [ ] **SQLite backend** — persist server data beyond restarts
- [ ] **Fastlane** — automated App Store / Play Store builds
- [ ] **E2E tests** — Playwright or Maestro for critical flows
- [ ] **Dark mode** — Material Design 3 dark theme toggle
- [ ] **Item search & filter** — full-text search across name, SKU, description
- [ ] **CI/CD** — GitHub Actions for lint, test, build on every PR

---

<div align="center">

Built for keeping track of everything, everywhere.

</div>