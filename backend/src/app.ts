import express, { type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { store } from './store.js';

// --- Config -------------------------------------------------------------
const DEMO_EMAIL = process.env.DEMO_EMAIL ?? 'admin@example.com';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'password';
// Comma-separated allowlist; if unset, the request Origin is reflected (dev-friendly).
const CORS_ORIGINS = (process.env.CORS_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// Issued bearer tokens. In-memory, so they reset on restart — fine for this demo.
// Swap for signed JWTs or a DB-backed table when you need persistence.
const tokens = new Set<string>();

function issueToken(): string {
	const token = randomUUID();
	tokens.add(token);
	return token;
}

function bearerFrom(req: Request): string | undefined {
	const header = req.get('Authorization');
	return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

/** Gate protected routes: require a valid bearer token. */
function requireAuth(req: Request, res: Response, next: NextFunction) {
	const token = bearerFrom(req);
	if (!token || !tokens.has(token)) {
		return res.status(401).json({ message: 'Unauthenticated.' });
	}
	next();
}

export function createApp() {
	const app = express();

	app.use(
		cors({
			origin: (origin, cb) => {
				// Allow non-browser clients (curl) and same-origin requests with no Origin.
				if (!origin) return cb(null, true);
				if (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) return cb(null, true);
				return cb(new Error(`Origin ${origin} not allowed by CORS`));
			},
			credentials: true,
			allowedHeaders: ['Content-Type', 'Accept', 'X-XSRF-TOKEN', 'Authorization'],
			methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
		})
	);
	app.use(express.json());
	app.use(express.urlencoded({ extended: true }));
	app.use(cookieParser());

	// --- Health --------------------------------------------------------
	app.get('/', (_req, res) => res.json({ status: 'ok', service: 'inventory-backend' }));
	app.get('/up', (_req, res) => res.status(200).send('OK')); // Laravel-style health route

	// --- Auth (bearer token) -------------------------------------------
	// Login validates credentials and returns a token; the client stores it and
	// sends it back as `Authorization: Bearer <token>` on every protected request.
	// No cookies, no CSRF — works the same in a browser PWA and a Capacitor app.
	function handleLogin(req: Request, res: Response) {
		const { email, password } = req.body ?? {};
		if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
			return res.status(200).json({ token: issueToken(), user: { email } });
		}
		// Laravel returns 422 with this shape on a failed login.
		return res.status(422).json({
			message: 'These credentials do not match our records.',
			errors: { email: ['These credentials do not match our records.'] }
		});
	}

	app.post('/login', handleLogin);
	app.post('/api/login', handleLogin);

	app.post('/logout', (req, res) => {
		const token = bearerFrom(req);
		if (token) tokens.delete(token);
		res.status(204).end();
	});

	// --- Items (v1) ----------------------------------------------------
	// Every item route requires a valid bearer token.
	app.use('/api/v1/items', requireAuth);

	// List: Laravel API-resource shape `{ data: [...] }`.
	app.get('/api/v1/items', (_req, res) => {
		res.json({ data: store.all() });
	});

	app.get('/api/v1/items/:id', (req, res) => {
		const item = store.find(Number(req.params.id));
		if (!item) return res.status(404).json({ message: 'Item not found.' });
		res.json(item);
	});

	// Create: returns the bare item (frontend reads `serverItem.id`).
	app.post('/api/v1/items', (req, res) => {
		const { name, sku } = req.body ?? {};
		if (!name || !sku) {
			return res.status(422).json({
				message: 'The given data was invalid.',
				errors: {
					...(name ? {} : { name: ['The name field is required.'] }),
					...(sku ? {} : { sku: ['The sku field is required.'] })
				}
			});
		}
		const item = store.create(req.body);
		res.status(201).json(item);
	});

	// Update: returns the bare updated item.
	app.put('/api/v1/items/:id', (req, res) => {
		const item = store.update(Number(req.params.id), req.body ?? {});
		if (!item) return res.status(404).json({ message: 'Item not found.' });
		res.json(item);
	});
	app.patch('/api/v1/items/:id', (req, res) => {
		const item = store.update(Number(req.params.id), req.body ?? {});
		if (!item) return res.status(404).json({ message: 'Item not found.' });
		res.json(item);
	});

	app.delete('/api/v1/items/:id', (req, res) => {
		const ok = store.remove(Number(req.params.id));
		if (!ok) return res.status(404).json({ message: 'Item not found.' });
		res.status(204).end();
	});

	// --- Fallbacks -----------------------------------------------------
	app.use((_req, res) => res.status(404).json({ message: 'Not found.' }));
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
		res.status(500).json({ message: err.message });
	});

	return app;
}
