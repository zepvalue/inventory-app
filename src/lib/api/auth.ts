export async function loginWithSanctum(email: string, password: string) {
	try {
		// 1. Get CSRF cookie
		await fetch('http://localhost:8000/sanctum/csrf-cookie', {
			credentials: 'include'
		});

		// 2. Get token from cookie
		const xsrfToken = document.cookie
			.split('; ')
			.find((row) => row.startsWith('XSRF-TOKEN='))
			?.split('=')[1];

		if (!xsrfToken) {
			return { success: false, message: 'CSRF token not found' };
		}

		// 3. Login
		const res = await fetch('http://localhost:8000/login', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-XSRF-TOKEN': decodeURIComponent(xsrfToken)
			},
			body: new URLSearchParams({ email, password }),
			credentials: 'include'
		});

		if (!res.ok) {
			const errText = await res.text();
			return { success: false, message: errText || 'Login failed' };
		}

		return { success: true };
	} catch (err: any) {
		console.error(err);
		return { success: false, message: 'Unexpected error during login' };
	}
}
