<script lang="ts">
	import Quagga from 'quagga';

	// --- Svelte 5 Props ---
	const {
		onscanned,
		oncancel,
		onerror
	} = $props<{
		onscanned: (barcode: string) => void;
		oncancel: () => void;
		onerror?: (error: Error) => void;
	}>();

	// --- Svelte 5 State ---
	let scannerContainer = $state<HTMLElement | null>(null);
	let isScannerInitialized = $state(false);

	// --- Svelte 5 Lifecycle Effect ---
	$effect(() => {
		console.log('[Scanner] $effect running.');
		// We add a guard to prevent initializing multiple times.
		if (isScannerInitialized || !scannerContainer) {
			console.log(`[Scanner] Aborting initialization. Initialized: ${isScannerInitialized}, Container: ${scannerContainer ? 'Exists' : 'null'}`);
			return;
		}

		// Use a short timeout to ensure the DOM is fully ready for Quagga.
		// This is a robust way to handle timing issues with DOM-manipulating libraries.
		const initTimeout = setTimeout(() => {
			console.log('[Scanner] Timeout finished. scannerContainer element should be ready. Initializing Quagga...');
			Quagga.init(
				{
					inputStream: {
						name: 'Live',
						type: 'LiveStream',
						target: scannerContainer, // Use the direct element reference
						constraints: {
							width: { min: 640 },
							height: { min: 480 },
							facingMode: 'environment'
						}
					},
					decoder: {
						readers: [
							'code_128_reader',
							'ean_reader',
							'ean_8_reader',
							'upc_reader',
							'code_39_reader'
						]
					}
				},
				(err) => {
					if (err) {
						console.error('[Scanner] FATAL: Quagga.init() returned an error:', err);
						alert(`Camera Error: ${err.message}. Please ensure you have given camera permissions.`);
						if (onerror) {
							onerror(err);
						}
						return;
					}
					console.log('[Scanner] Quagga initialized successfully. Starting camera stream...');
					Quagga.start();
					isScannerInitialized = true;

					Quagga.onDetected((result) => {
						const barcode = result.codeResult.code;
						console.log('[Scanner] Barcode detected:', barcode);
						onscanned(barcode);
					});
				}
			);
		}, 100); // 100ms delay

		// The return function is for cleanup and runs when the component is destroyed.
		return () => {
			clearTimeout(initTimeout); // Clear the timeout if the component is destroyed before it runs
			if (isScannerInitialized) {
				Quagga.stop();
				console.log('[Scanner] Quagga stream stopped.');
			}
		};
	});
</script>

<div>
	<!-- We bind the div element to our state variable so Quagga can target it -->
	<div bind:this={scannerContainer} id="scanner-container" class="w-full h-64 relative">
		<!-- These elements are used by Quagga to show the camera feed -->
		<video class="w-full h-full" autoplay="true" preload="auto" playsinline="true" muted="true"></video>
		<canvas class="w-full h-full absolute top-0 left-0"></canvas>
	</div>
	<button onclick={oncancel} class="mt-4 w-full px-4 py-2 bg-red-600 text-white rounded-md">
		Cancel
	</button>
</div>
