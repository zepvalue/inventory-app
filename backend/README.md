# inventory-backend

TypeScript (Express) backend that implements the exact API contract the
`inventory-mobile` SvelteKit frontend expects.

## Routes

| Method | Path | Purpose | Response |
| --- | --- | --- | --- |
| GET | `/` | Health check | `{ status: 'ok' }` |
| GET | `/up` | Health check (Laravel-style) | `200 OK` |
| POST | `/login` | Login (JSON or form) | `{ token, user }` / `422` |
| POST | `/api/login` | Same as `/login` (used by the login page) | `{ token, user }` / `422` |
| POST | `/logout` | Revoke the bearer token | `204` |
| GET | `/api/v1/items` | List items 🔒 | `{ data: Item[] }` |
| GET | `/api/v1/items/:id` | Get one item 🔒 | `Item` |
| POST | `/api/v1/items` | Create item 🔒 | `201 Item` |
| PUT/PATCH | `/api/v1/items/:id` | Update item 🔒 | `Item` |
| DELETE | `/api/v1/items/:id` | Delete item 🔒 | `204` |

🔒 = requires `Authorization: Bearer <token>`.

`Item` = `{ id, sku, name, barcode, description, is_active, category?, photos? }`

## Auth

Bearer-token flow (no cookies, no CSRF): the client POSTs credentials to
`/api/login` and receives `{ token }`, then sends `Authorization: Bearer <token>`
on every protected request. `/logout` revokes the token. Tokens are stored
in-memory, so they reset when the server restarts. Default demo credentials
(override via env):

```
admin@example.com / password
```

## Run locally

```bash
npm install
npm run dev      # tsx watch, http://localhost:8000
# or
npm run build && npm start
npm test         # vitest + supertest, covers every route
```

Configure via env vars — see [.env.example](.env.example).

## Notes

- **Storage is in-memory** and resets on restart. Swap `src/store.ts` for a real
  database (Postgres/SQLite) when you need persistence — callers won't change.
- **CORS**: set `CORS_ORIGINS` to your frontend origin(s) in production. For a
  Capacitor mobile build, include `capacitor://localhost` and `https://localhost`.

## Deploy to Render

- New **Web Service**, root directory `backend/`
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Render provides `PORT` automatically; set `DEMO_EMAIL`, `DEMO_PASSWORD`, and
  `CORS_ORIGINS` in the dashboard.
