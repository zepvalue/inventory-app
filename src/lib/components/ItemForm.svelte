<script lang="ts">
	import { browser } from '$app/environment';

	// --- Svelte 5 Props ---
	let {
		selectedItem,
		formMode,
		submit,
		cancel
	} = $props<{
		selectedItem: Item;
		formMode: 'create' | 'edit';
		submit: (item: Item) => void;
		cancel: () => void;
	}>();

	// --- Type Definition ---
	interface Item {
		id?: number;
		sku: string;
		name: string;
		barcode: string;
		is_active: boolean;
	}

	// --- Svelte 5 State ---
	let formData = $state({ ...selectedItem });
	let showScanner = $state(false);
	let scannerComponent = $state<any>(null);

	$effect(() => {
		formData = { ...selectedItem };
	});

	// --- HANDLERS ---
	function handleSubmit(e: Event) {
		e.preventDefault();
		submit(formData);
	}

	function handleCancel() {
		cancel();
	}

	// This function now has detailed logging to help us debug.
	async function startBarcodeScanner() {
		console.log('1. "Scan" button clicked.');
		if (browser) {
			console.log('2. Running in browser environment.');
			try {
				if (!scannerComponent) {
					console.log('3. Scanner component not loaded yet. Importing...');
					const module = await import('./BarcodeScanner.svelte');
					console.log('4. Import successful. Module:', module);
					scannerComponent = module.default;
					console.log('5. scannerComponent state updated.');
				} else {
					console.log('3. Scanner component is already loaded.');
				}
				showScanner = true;
				console.log('6. showScanner state updated to true. The modal should now be visible.');
			} catch (error) {
				console.error('ERROR: Failed to load BarcodeScanner component:', error);
				alert('Error: Could not load the barcode scanner. Check the console for details.');
			}
		} else {
			console.log('2. NOT running in browser environment. Aborting.');
		}
	}

	function stopBarcodeScanner() {
		showScanner = false;
	}

	function onBarcodeScanned(event: CustomEvent<string>) {
		formData.barcode = event.detail;
		showScanner = false;
	}
</script>

<div class="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center">
	<div class="bg-white p-6 rounded-lg shadow-lg w-full max-w-md">
		<h2 class="text-xl font-bold mb-4">{formMode === 'create' ? 'Add New Item' : 'Edit Item'}</h2>

		<form onsubmit={handleSubmit} class="space-y-4">
			<!-- Form fields -->
			<div>
				<label class="block text-sm font-medium text-gray-700" for="sku">
					SKU
					<input
						type="text"
						id="sku"
						bind:value={formData.sku}
						required
						class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
					/>
				</label>
			</div>
			<div>
				<label class="block text-sm font-medium text-gray-700" for="name">
					Name
					<input
						type="text"
						id="name"
						bind:value={formData.name}
						required
						class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
					/>
				</label>
			</div>
			<div>
				<label class="block text-sm font-medium text-gray-700" for="barcode">
					Barcode
					<div class="flex items-center space-x-2">
						<input
							type="text"
							id="barcode"
							bind:value={formData.barcode}
							required
							class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
						/>
						<button
							type="button"
							onclick={startBarcodeScanner}
							class="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700"
						>
							Scan
						</button>
					</div>
				</label>
			</div>
			<div>
				<label class="flex items-center text-sm font-medium text-gray-700" for="is_active">
					<input
						type="checkbox"
						id="is_active"
						bind:checked={formData.is_active}
						class="mr-2 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
					/>
					Active
				</label>
			</div>

			<!-- Form Buttons -->
			<div class="flex justify-end space-x-3 pt-4">
				<button
					type="button"
					onclick={handleCancel}
					class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
				>
					Cancel
				</button>
				<button
					type="submit"
					class="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700"
				>
					{formMode === 'create' ? 'Create' : 'Update'}
				</button>
			</div>
		</form>
	</div>
</div>

<!-- Barcode Scanner Modal -->
{#if showScanner && scannerComponent}
	<div class="fixed inset-0 z-50 bg-black bg-opacity-75 flex items-center justify-center">
		<div class="bg-white p-4 rounded-lg shadow-lg">
			<h3 class="text-lg font-bold mb-2">Scan Barcode</h3>
			<scannerComponent onscanned={onBarcodeScanned} oncancel={stopBarcodeScanner}></scannerComponent>
		</div>
	</div>
{/if}
