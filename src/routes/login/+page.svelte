<script lang="ts">
	import { goto } from '$app/navigation';
	import { login } from '$lib/api/auth';

	// Demo credentials pre-filled for convenience (see backend DEMO_EMAIL/DEMO_PASSWORD).
	let email = $state('admin@example.com');
	let password = $state('password');
	let error = $state('');
	let loading = $state(false);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		loading = true;
		error = '';
		const result = await login(email, password);
		loading = false;
		if (result.success) {
			goto('/dashboard');
		} else {
			error = result.message ?? 'Login failed';
		}
	}
</script>

<div class="login-wrap">
	<form class="login-card" onsubmit={handleSubmit}>
		<h1>Inventory</h1>
		<p class="sub">Sign in to continue</p>

		{#if error}
			<div class="error" role="alert">{error}</div>
		{/if}

		<label>
			Email
			<input type="email" bind:value={email} required autocomplete="username" />
		</label>

		<label>
			Password
			<input type="password" bind:value={password} required autocomplete="current-password" />
		</label>

		<button type="submit" disabled={loading}>
			{loading ? 'Signing in…' : 'Sign in'}
		</button>
	</form>
</div>

<style>
	.login-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f8fafc;
		padding: 16px;
	}
	.login-card {
		width: 100%;
		max-width: 360px;
		background: #fff;
		border-radius: 16px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
		padding: 28px 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	h1 {
		margin: 0;
		font-size: 1.6rem;
		color: #1e293b;
	}
	.sub {
		margin: -8px 0 4px;
		color: #64748b;
		font-size: 0.9rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.85rem;
		color: #475569;
	}
	input {
		padding: 12px 14px;
		border: 1px solid #cbd5e1;
		border-radius: 8px;
		font-size: 1rem;
	}
	input:focus {
		outline: 2px solid #4f46e5;
		border-color: transparent;
	}
	button {
		margin-top: 6px;
		padding: 12px;
		background: #4f46e5;
		color: #fff;
		border: none;
		border-radius: 8px;
		font-size: 1rem;
		font-weight: 600;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.error {
		background: #fef2f2;
		color: #b91c1c;
		border: 1px solid #fecaca;
		border-radius: 8px;
		padding: 10px 12px;
		font-size: 0.875rem;
	}
</style>
