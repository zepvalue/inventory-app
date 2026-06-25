import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

const app = createApp();

const CREDS = { email: 'admin@example.com', password: 'password' };

/** Log in and return the bearer token the SPA would store. */
async function authToken(): Promise<string> {
	const res = await request(app).post('/api/login').send(CREDS);
	return res.body.token as string;
}

describe('health', () => {
	it('GET / returns ok', async () => {
		const res = await request(app).get('/');
		expect(res.status).toBe(200);
		expect(res.body.status).toBe('ok');
	});
});

describe('auth', () => {
	it('logs in with correct credentials and returns a token', async () => {
		const res = await request(app).post('/api/login').send(CREDS);
		expect(res.status).toBe(200);
		expect(res.body.token).toBeTypeOf('string');
		expect(res.body.user.email).toBe(CREDS.email);
	});

	it('rejects bad credentials with 422', async () => {
		const res = await request(app).post('/login').send({ ...CREDS, password: 'wrong' });
		expect(res.status).toBe(422);
		expect(res.body.errors).toBeDefined();
	});

	it('rejects item access without a token (401)', async () => {
		const res = await request(app).get('/api/v1/items');
		expect(res.status).toBe(401);
	});

	it('rejects item access with an invalid token (401)', async () => {
		const res = await request(app).get('/api/v1/items').set('Authorization', 'Bearer nope');
		expect(res.status).toBe(401);
	});
});

describe('items (authenticated)', () => {
	it('GET /api/v1/items returns { data: [...] }', async () => {
		const token = await authToken();
		const res = await request(app).get('/api/v1/items').set('Authorization', `Bearer ${token}`);
		expect(res.status).toBe(200);
		expect(Array.isArray(res.body.data)).toBe(true);
		expect(res.body.data.length).toBeGreaterThan(0);
	});

	it('full CRUD lifecycle', async () => {
		const token = await authToken();
		const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

		// CREATE -> returns bare item with id
		const created = await auth(
			request(app)
				.post('/api/v1/items')
				.send({ sku: 'SKU-TEST', name: 'Test Item', barcode: '999', description: 'x', is_active: true })
		);
		expect(created.status).toBe(201);
		expect(created.body.id).toBeTypeOf('number');
		const id = created.body.id;

		// UPDATE -> returns bare updated item
		const updated = await auth(request(app).put(`/api/v1/items/${id}`).send({ name: 'Renamed' }));
		expect(updated.status).toBe(200);
		expect(updated.body.name).toBe('Renamed');
		expect(updated.body.id).toBe(id);

		// DELETE -> 204
		const del = await auth(request(app).delete(`/api/v1/items/${id}`));
		expect(del.status).toBe(204);

		// gone
		const gone = await auth(request(app).get(`/api/v1/items/${id}`));
		expect(gone.status).toBe(404);
	});

	it('rejects create without required fields (422)', async () => {
		const token = await authToken();
		const res = await request(app)
			.post('/api/v1/items')
			.set('Authorization', `Bearer ${token}`)
			.send({ barcode: 'only' });
		expect(res.status).toBe(422);
		expect(res.body.errors).toBeDefined();
	});
});
