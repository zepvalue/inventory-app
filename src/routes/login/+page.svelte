<script lang="ts">
	import { goto } from '$app/navigation';
	import { login } from '$lib/api/auth';
	import { MdFilledButton, MdTextField } from '$lib/components';

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

<svelte:head>
	<style>
		.login-wrap {
			min-height: 100vh;
			display: flex;
			align-items: center;
			justify-content: center;
			background: linear-gradient(135deg, var(--md-ref-palette-primary95) 0%, var(--md-sys-color-surface) 100%);
			padding: 16px;
		}

		.login-card {
			width: 100%;
			max-width: 400px;
			background: var(--md-sys-color-surface);
			border-radius: var(--md-sys-shape-extra-large);
			box-shadow: var(--md-sys-elevation-level2);
			padding: 40px 32px 32px;
			display: flex;
			flex-direction: column;
			animation: cardIn 350ms var(--md-sys-motion-easing-emphasized);
		}

		.login-logo {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 64px;
			height: 64px;
			border-radius: var(--md-sys-shape-large);
			background: var(--md-sys-color-primary-container);
			margin: 0 auto 16px;
		}

		.login-logo i {
			font-size: 32px;
			color: var(--md-sys-color-on-primary-container);
		}

		h1 {
			margin: 0;
			font-size: 1.75rem;
			font-weight: 400;
			line-height: 2.25rem;
			color: var(--md-sys-color-on-surface);
			text-align: center;
		}

		.sub {
			margin: 4px 0 24px;
			color: var(--md-sys-color-on-surface-variant);
			font-size: 0.875rem;
			text-align: center;
		}

		.login-form {
			display: flex;
			flex-direction: column;
			gap: 16px;
		}

		.error-banner {
			display: flex;
			align-items: center;
			gap: 8px;
			background: var(--md-sys-color-error-container);
			color: var(--md-sys-color-on-error-container);
			border-radius: var(--md-sys-shape-small);
			padding: 12px 16px;
			font-size: 0.875rem;
			animation: shakeIn 300ms var(--md-sys-motion-easing-emphasized);
		}

		.error-banner i {
			font-size: 20px;
		}

		.login-submit {
			margin-top: 8px;
		}

		@keyframes cardIn {
			from {
				opacity: 0;
				transform: translateY(20px) scale(0.96);
			}
			to {
				opacity: 1;
				transform: translateY(0) scale(1);
			}
		}

		@keyframes shakeIn {
			0% { transform: translateX(0); }
			25% { transform: translateX(-8px); }
			50% { transform: translateX(8px); }
			75% { transform: translateX(-4px); }
			100% { transform: translateX(0); }
		}
	</style>
</svelte:head>

<div class="login-wrap">
	<form class="login-card" onsubmit={handleSubmit}>
		<div class="login-logo">
			<i class="material-icons-round">inventory_2</i>
		</div>
		<h1>Inventory</h1>
		<p class="sub">Sign in to continue</p>

		{#if error}
			<div class="error-banner" role="alert">
				<i class="material-icons-round">error_outline</i>
				<span>{error}</span>
			</div>
		{/if}

		<div class="login-form">
			<MdTextField
				label="Email"
				type="email"
				value={email}
				oninput={(e) => email = (e.target as HTMLInputElement).value}
				required={true}
			/>

			<MdTextField
				label="Password"
				type="password"
				value={password}
				oninput={(e) => password = (e.target as HTMLInputElement).value}
				required={true}
			/>

			<div class="login-submit">
				<MdFilledButton
					type="submit"
					disabled={loading}
					icon={loading ? undefined : 'login'}
					{loading}
					style="width: 100%; height: 48px; border-radius: 24px; font-size: 1rem;"
				>
					{loading ? 'Signing in…' : 'Sign in'}
				</MdFilledButton>
			</div>
		</div>
	</form>
</div>
