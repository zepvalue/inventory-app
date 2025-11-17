<script lang="ts">
	// --- IMPORTS ---
	import { tick } from 'svelte';
	// NOTE: Your Item type now needs 'photos' and 'category'
	import type { Item } from '$lib/types';

	// --- CONSTANTS ---
	const categories = [
		'Kitchen', 'Rig', 'Toys', 'Shade', 'Tensegrities',
		'Wizard Hut', 'Power', 'Lighting', 'Store', 'Trash',
		'Replace', 'Donate'
	];

	// --- STATE ---
	let items = $state<Item[]>([]);
	let formMode = $state<'create' | 'edit'>('create');
	let selectedItem = $state<Item | null>(null);
	let formData = $state<Item | null>(null);
	let isSyncingAll = $state(false);
	let showMenu = $state(false);

	let itemsToSyncCount = $derived(
		items.filter((i) => i.syncStatus === 'local' || i.syncStatus === 'error').length
	);

	// ... other state variables
	let modalBackdrop = $state<HTMLElement | null>(null);
	let showScanner = $state(false);
	let scannerContainer = $state<HTMLElement | null>(null);
	let isScannerInitialized = $state(false);
	let QuaggaLib = $state<any>(null);
	let showCamera = $state(false);
	let videoElement = $state<HTMLVideoElement | null>(null);
	let canvasElement = $state<HTMLCanvasElement | null>(null);
	let mediaStream = $state<MediaStream | null>(null);
	let itemToDelete = $state<Item | null>(null);
	let deleteModalBackdrop = $state<HTMLElement | null>(null);

	// --- LIFECYCLE & SKU GENERATION ---
	$effect(() => {
		// This effect only handles cleanup on unmount
		return () => {
			stopScanner();
			stopCamera();
		};
	});

	// This effect regenerates the SKU whenever the category changes in the form for a NEW item
	$effect(() => {
		if (formData && formMode === 'create') {
			formData.sku = generateSku(formData.category);
		}
	});

	function generateSku(category: string): string {
		if (!category) return '';
		const prefix = category.substring(0, 3).toUpperCase();
		// Generates a random number between 10,000,000 and 99,999,999
		const randomNumber = Math.floor(10000000 + Math.random() * 90000000);
		return `${prefix}${randomNumber}`;
	}

	// --- DATA HANDLING ---
	async function fetchItems() {
		try {
			const response = await fetch('https://inventory.online/api/v1/items');
			if (!response.ok) throw new Error('Failed to fetch');
			const serverResponse = await response.json();
			let serverItems = [];
			if (Array.isArray(serverResponse)) {
				serverItems = serverResponse;
			} else if (serverResponse && typeof serverResponse === 'object') {
				serverItems = [serverResponse];
			}
			items = serverItems.map((item: Item) => ({
				...item,
				photos: item.photos || [],
				syncStatus: 'synced'
			}));
		} catch (error) {
			console.error('Fetch error:', error);
			alert('Could not load inventory from the server.');
		}
	}

	// --- CSV & DOWNLOAD ---
	function exportToCSV() {
		if (items.length === 0) return alert('No items to export.');
		const headers = [
			'id', 'name', 'sku', 'barcode', 'description', 'category', 
			'is_active', 'photos', 'syncStatus'
		];
		const csvRows = [headers.join(',')];
		for (const item of items) {
			const values = headers.map((header) => {
				const key = header as keyof Item;
				let rawValue: any = item.hasOwnProperty(key) ? item[key] : '';
				if (header === 'photos' && Array.isArray(rawValue)) {
					rawValue = rawValue.join(';');
				}
				const escaped = String(rawValue).replace(/"/g, '""');
				return `"${escaped}"`;
			});
			csvRows.push(values.join(','));
		}
		const csvString = csvRows.join('\n');
		const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
		const link = document.createElement('a');
		const url = URL.createObjectURL(blob);
		link.setAttribute('href', url);
		link.setAttribute('download', `inventory_export_${new Date().toISOString()}.csv`);
		link.click();
		URL.revokeObjectURL(url);
	}

	function parseCsvRow(row: string): string[] {
		const result: string[] = [];
		let currentField = '';
		let inQuotes = false;
		for (let i = 0; i < row.length; i++) {
			const char = row[i];
			if (char === '"') {
				if (inQuotes && row[i + 1] === '"') { currentField += '"'; i++; } else { inQuotes = !inQuotes; }
			} else if (char === ',' && !inQuotes) { result.push(currentField); currentField = '';
			} else { currentField += char; }
		}
		result.push(currentField);
		return result;
	}

	function handleFileImport(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = (e) => {
			const text = e.target?.result as string;
			if (!text) return;
			try {
				const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
				if (lines.length < 2) return;

				const headers = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
				const importedItems: Item[] = [];
				for (let i = 1; i < lines.length; i++) {
					const values = parseCsvRow(lines[i]);
					const itemData: any = {};
					headers.forEach((key, index) => (itemData[key] = values[index] || ''));
					
					importedItems.push({
						id: -Date.now() + i,
						name: itemData.name,
						sku: itemData.sku,
						barcode: itemData.barcode || '',
						description: itemData.description || '',
						category: itemData.category || categories[0],
						is_active: String(itemData.is_active).toLowerCase() === 'true',
						photos: itemData.photos ? itemData.photos.split(';') : [],
						syncStatus: 'local'
					});
				}
				items = importedItems;
				alert(
					`Successfully imported ${importedItems.length} items. Use the 'Sync All' button to save them to the database.`
				);
			} catch (error) {
				console.error('Error parsing CSV:', error);
				alert('Failed to parse CSV file.');
			}
		};
		reader.readAsText(file);
		target.value = '';
	}

	function downloadPhoto(dataUrl: string, sku: string, index: number) {
		const link = document.createElement('a');
		link.href = dataUrl;
		link.download = `${sku || 'download'}_${index + 1}.jpeg`;
		link.click();
	}

	// --- DATABASE SYNC ---
	async function syncAllItems() {
		const itemsToSync = items.filter(
			(item) => item.syncStatus === 'local' || item.syncStatus === 'error'
		);
		if (itemsToSync.length === 0) return alert('Everything is already up-to-date.');
		isSyncingAll = true;
		let successCount = 0;
		let errorCount = 0;
		for (const item of itemsToSync) {
			try {
				await syncItem(item);
				successCount++;
			} catch (e) {
				errorCount++;
			}
		}
		isSyncingAll = false;
		alert(`Sync complete! ${successCount} items synced, ${errorCount} items failed.`);
	}

	async function syncItem(itemToSync: Item) {
		const itemIndex = items.findIndex((i) => i.id === itemToSync.id);
		if (itemIndex === -1) throw new Error('Item not found');

		items[itemIndex].syncStatus = 'pending';
		items = [...items];

		const isNewOnServer = itemToSync.id < 0;
		const url = isNewOnServer
			? 'https://inventory.online/api/v1/items'
			: `https://inventory.online/api/v1/items/${itemToSync.id}`;
		const method = isNewOnServer ? 'POST' : 'PUT';

		try {
			const payload = { ...itemToSync };
			if (isNewOnServer) delete payload.id;

			const response = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			if (!response.ok) throw new Error('Server request failed');

			const savedItem = await response.json();

			items[itemIndex] = { ...savedItem, photos: savedItem.photos || [], syncStatus: 'synced' };
			items = [...items];
		} catch (error) {
			console.error('Sync error:', error);
			items[itemIndex].syncStatus = 'error';
			items = [...items];
			throw error;
		}
	}

	// --- LOCAL CRUD & Other Handlers ---
	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!formData) return;
		if (!formData.name || !formData.sku) return alert('Item Name and SKU are required.');

		if (formMode === 'create') {
			const newItem = { ...formData, id: -Date.now(), syncStatus: 'local' as const };
			items = [...items, newItem];
		} else {
			const index = items.findIndex((i) => i.id === formData!.id);
			if (index !== -1) {
				items[index] = { ...formData, syncStatus: 'local' };
				items = [...items];
			}
		}
		handleCancel();
	}

	async function executeDelete() {
		if (!itemToDelete) return;
		const { id, syncStatus } = itemToDelete;

		if (id > 0 && (syncStatus === 'synced' || syncStatus === 'error')) {
			try {
				const response = await fetch(`https://inventory.online/api/v1/items/${id}`, {
					method: 'DELETE'
				});
				if (!response.ok) throw new Error('Server delete failed');
			} catch (error) {
				alert('Failed to delete item from server. It will be removed locally.');
			}
		}
		items = items.filter((i) => i.id !== id);
		itemToDelete = null;
	}

	async function handleNew() {
		formMode = 'create';
		const defaultCategory = categories[0];
		const newItem = {
			id: -1,
			name: '',
			sku: generateSku(defaultCategory),
			barcode: '',
			description: '',
			category: defaultCategory,
			is_active: true,
			photos: [],
			syncStatus: 'local' as const
		};
		selectedItem = newItem;
		formData = { ...newItem };
		await tick();
		modalBackdrop?.focus();
	}

	async function handleEdit(item: Item) {
		formMode = 'edit';
		selectedItem = { ...item, photos: item.photos || [] };
		formData = { ...selectedItem };
		await tick();
		modalBackdrop?.focus();
	}

	function handleCancel() {
		selectedItem = null;
		formData = null;
		showScanner = false;
		stopScanner();
		stopCamera();
	}

	async function promptForDelete(item: Item) {
		itemToDelete = item;
		await tick();
		deleteModalBackdrop?.focus();
	}

	// --- CAMERA & PHOTO ---
	async function startCamera() {
		showCamera = true;
		await tick();
		if (!videoElement) return;
		try {
			mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
			videoElement.srcObject = mediaStream;
		} catch (err) {
			alert('Could not access the camera. Please check permissions.');
			showCamera = false;
		}
	}

	function stopCamera() {
		if (mediaStream) mediaStream.getTracks().forEach((track) => track.stop());
		mediaStream = null;
		showCamera = false;
	}

	function capturePhoto() {
		if (!videoElement || !canvasElement || !formData) return;
		canvasElement.width = videoElement.videoWidth;
		canvasElement.height = videoElement.videoHeight;
		const context = canvasElement.getContext('2d');
		if (context) {
			context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
			const photoDataUrl = canvasElement.toDataURL('image/jpeg');
			formData.photos.push(photoDataUrl);
			formData.photos = [...formData.photos];
		}
		stopCamera();
	}

	function removePhoto(indexToRemove: number) {
		if (formData) {
			formData.photos.splice(indexToRemove, 1);
			formData.photos = [...formData.photos];
		}
	}

	function handleFileSelect(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = target.files;
		if (!files || !formData) return;

		for (const file of Array.from(files)) {
			if (!file.type.startsWith('image/')) {
				alert(`Skipping non-image file: ${file.name}`);
				continue;
			}
			const maxSizeInBytes = 5 * 1024 * 1024; // 5MB
			if (file.size > maxSizeInBytes) {
				alert(`Skipping large file (>5MB): ${file.name}`);
				continue;
			}

			const reader = new FileReader();
			reader.onload = () => {
				if (formData) {
					formData.photos.push(reader.result as string);
					formData.photos = [...formData.photos];
				}
			};
			reader.readAsDataURL(file);
		}
	}

	// --- BARCODE SCANNER ---
	async function startBarcodeScanner() {
		showScanner = true;
		await tick();
		if (!scannerContainer) return;
		try {
			const Quagga = (await import('quagga')).default;
			QuaggaLib = Quagga;
			Quagga.init(
				{
					inputStream: {
						name: 'Live',
						type: 'LiveStream',
						target: scannerContainer,
						constraints: { facingMode: 'environment' }
					},
					decoder: { readers: ['code_128_reader', 'ean_reader', 'upc_reader'] }
				},
				(err: any) => {
					if (err) {
						alert(`Camera Error: ${err.message}.`);
						showScanner = false;
						return;
					}
					Quagga.start();
					isScannerInitialized = true;
					Quagga.onDetected((result: { codeResult: { code: string } }) => {
						if (formData) formData.barcode = result.codeResult.code;
						showScanner = false;
						stopScanner();
					});
				}
			);
		} catch (e) {
			alert('Failed to load scanner resources.');
		}
	}

	function stopScanner() {
		if (QuaggaLib && isScannerInitialized) {
			QuaggaLib.stop();
			isScannerInitialized = false;
		}
	}
</script>

<svelte:head>
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap"
	/>
	<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons" />
	<style>
		:root {
			--md-sys-color-primary: #6750a4;
			--md-sys-color-on-primary: #ffffff;
			--md-sys-color-primary-container: #eaddff;
			--md-sys-color-on-primary-container: #21005d;
			--md-sys-color-error: #b3261e;
			--md-sys-color-on-error: #ffffff;
			--md-sys-color-background: #fffbfe;
			--md-sys-color-on-background: #1c1b1f;
			--md-sys-color-surface: #fffbfe;
			--md-sys-color-on-surface: #1c1b1f;
			--md-sys-color-surface-variant: #e7e0ec;
			--md-sys-color-on-surface-variant: #49454f;
			--md-sys-color-outline: #79747e;
		}
		body {
			font-family: 'Roboto', sans-serif;
			background-color: var(--md-sys-color-background);
			color: var(--md-sys-color-on-background);
			margin: 0;
		}
		.app-container {
			display: flex;
			flex-direction: column;
			min-height: 100vh;
		}
		.top-bar {
			background-color: var(--md-sys-color-surface);
			padding: 16px;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
			display: flex;
			justify-content: space-between;
			align-items: center;
			position: sticky;
			top: 0;
			z-index: 10;
		}
		.top-bar h1 {
			font-size: 1.5rem;
			font-weight: 500;
			margin: 0;
		}
		.top-bar-actions {
			display: flex;
			gap: 8px;
			align-items: center;
		}
		main {
			padding: 16px;
			flex-grow: 1;
		}
		.fab {
			position: fixed;
			bottom: 16px;
			right: 16px;
			background-color: var(--md-sys-color-primary-container);
			color: var(--md-sys-color-on-primary-container);
			width: 56px;
			height: 56px;
			border-radius: 16px;
			border: none;
			display: flex;
			align-items: center;
			justify-content: center;
			box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
			cursor: pointer;
		}
		.item-card {
			background-color: var(--md-sys-color-surface);
			border-radius: 12px;
			box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
			padding: 16px;
			margin-bottom: 12px;
		}
		.item-card-header {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			gap: 8px;
		}
		.item-card-header h3 {
			font-size: 1.25rem;
			font-weight: 500;
			margin: 0;
			flex-grow: 1;
		}
		.item-card-actions {
			display: flex;
			gap: 4px;
			flex-shrink: 0;
			align-items: center;
		}
		.item-card-body {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 12px;
			font-size: 0.875rem;
			color: var(--md-sys-color-on-surface-variant);
			padding-top: 12px;
			border-top: 1px solid var(--md-sys-color-outline);
			margin-top: 12px;
		}
		.item-card-body .label {
			font-weight: 500;
		}
		.item-card-body .value {
			font-family: 'Roboto Mono', monospace;
			word-break: break-all;
		}
		.item-card-body .full-width {
			grid-column: 1 / -1;
		}
		.item-card-body .value-description {
			color: var(--md-sys-color-on-surface);
			white-space: pre-wrap;
		}
		.item-photo-preview,
		.form-photo-preview {
			max-width: 100%;
			height: auto;
			border-radius: 8px;
			margin-top: 8px;
			border: 1px solid var(--md-sys-color-outline);
		}
		.form-photo-preview {
			max-height: 150px;
			width: auto;
		}
		video {
			width: 100%;
			height: auto;
			border-radius: 12px;
			background-color: #000;
		}
		.status-chip {
			display: inline-flex;
			align-items: center;
			padding: 4px 10px;
			border-radius: 16px;
			font-size: 0.75rem;
			font-weight: 500;
			text-transform: uppercase;
		}
		.status-chip.active {
			background-color: #c8e6c9;
			color: #2e7d32;
		}
		.status-chip.inactive {
			background-color: #f5f5f5;
			color: #616161;
		}
		.status-chip.synced {
			background-color: #bbdefb;
			color: #0d47a1;
		}
		.status-chip.local {
			background-color: #ffecb3;
			color: #ff6f00;
		}
		.status-chip.pending {
			background-color: #e0e0e0;
			color: #424242;
			animation: pulse 1.5s infinite;
		}
		.status-chip.error {
			background-color: #ffcdd2;
			color: #b71c1c;
		}
		@keyframes pulse {
			0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; }
		}
		.modal-backdrop {
			position: fixed; inset: 0; background-color: rgba(0, 0, 0, 0.5);
			display: flex; align-items: center; justify-content: center;
			z-index: 50; padding: 16px;
		}
		.modal-content {
			background-color: var(--md-sys-color-surface); border-radius: 28px;
			padding: 20px; width: 100%; max-width: 400px;
			box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2); max-height: 90vh; overflow-y: auto;
		}
		.modal-header { font-size: 1.375rem; margin-bottom: 16px; }
		.form-field { margin-bottom: 16px; }
		.form-field label, .form-field-label {
			display: block; font-size: 0.75rem; color: var(--md-sys-color-primary);
			margin-bottom: 4px; padding-left: 16px;
		}
		.input-container { position: relative; display: flex; align-items: center; gap: 8px; }
		.form-field input[type='text'], .form-field textarea, .form-field select {
			background-color: var(--md-sys-color-surface-variant); border: none;
			border-radius: 4px; padding: 14px 16px; font-size: 1rem;
			color: var(--md-sys-color-on-surface-variant); width: 100%; box-sizing: border-box;
		}
		.form-field textarea { font-family: 'Roboto', sans-serif; resize: vertical; }
		.checkbox-field { display: flex; align-items: center; gap: 8px; padding: 12px 0; }
		.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
		.btn {
			padding: 10px 20px; border-radius: 20px; border: none;
			font-weight: 500; text-transform: uppercase; cursor: pointer;
		}
		.btn-text { background: none; color: var(--md-sys-color-primary); }
		.btn-filled { background-color: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
		.btn-filled:disabled { background-color: #e0e0e0; color: #9e9e9e; cursor: not-allowed; }
		.btn-icon {
			display: inline-flex; align-items: center; justify-content: center;
			width: 40px; height: 40px; padding: 0; border-radius: 50%;
			border: none; background: none; cursor: pointer; color: var(--md-sys-color-on-surface-variant);
		}
		#scanner-container {
			width: 100%; height: 250px; position: relative; background-color: #000;
			border-radius: 12px; overflow: hidden; margin-bottom: 16px;
		}
		.photo-gallery { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
		.thumbnail { position: relative; width: 72px; height: 72px; }
		.thumbnail img {
			width: 100%; height: 100%; object-fit: cover; border-radius: 4px;
			border: 1px solid var(--md-sys-color-outline);
		}
		.thumbnail .remove-btn {
			position: absolute; top: -4px; right: -4px; width: 20px; height: 20px;
			border-radius: 50%; border: 1px solid white; background-color: var(--md-sys-color-error);
			color: white; display: flex; align-items: center; justify-content: center;
			cursor: pointer; font-size: 14px; line-height: 1;
		}
		.dropdown { position: relative; }
		.dropdown-menu {
			position: absolute;
			top: 100%;
			right: 0;
			background-color: var(--md-sys-color-surface);
			border-radius: 4px;
			box-shadow: 0 2px 8px rgba(0,0,0,0.15);
			padding: 8px 0;
			z-index: 20;
			min-width: 160px;
		}
		.dropdown-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 16px;
			cursor: pointer;
			color: var(--md-sys-color-on-surface);
		}
		.dropdown-item:hover {
			background-color: rgba(0,0,0,0.05);
		}
	</style>
</svelte:head>

<div class="app-container">
	<header class="top-bar">
		<h1>Inventory</h1>
		<div class="top-bar-actions">
			<button onclick={fetchItems} class="btn-icon" aria-label="Refresh items">
				<i class="material-icons">refresh</i>
			</button>
			<button
				class="btn btn-filled"
				onclick={syncAllItems}
				disabled={itemsToSyncCount === 0 || isSyncingAll}
			>
				{#if isSyncingAll}
					Syncing...
				{:else}
					Sync All ({itemsToSyncCount})
				{/if}
			</button>
			<div class="dropdown">
				<button onclick={() => showMenu = !showMenu} class="btn-icon" aria-label="More options">
					<i class="material-icons">more_vert</i>
				</button>
				{#if showMenu}
					<div class="dropdown-menu">
						<label for="csv-import" class="dropdown-item">
							<i class="material-icons">upload</i>
							<span>Import CSV</span>
						</label>
						<input type="file" id="csv-import" accept=".csv" onchange={handleFileImport} style="display: none;" />
						<div class="dropdown-item" onclick={exportToCSV}>
							<i class="material-icons">download</i>
							<span>Export CSV</span>
						</div>
					</div>
					<div class="fixed inset-0 z-10" onclick={() => showMenu = false}></div>
				{/if}
			</div>
		</div>
	</header>

	<main>
		{#if items.length === 0}
			<div style="text-align: center; padding: 3rem; color: #757575;">
				<i class="material-icons" style="font-size: 4rem; color: #bdbdbd;">inventory_2</i>
				<p style="margin-top: 1rem;">No items in inventory.</p>
				<p>Click "Refresh" to load data or "+" to add a new item.</p>
			</div>
		{:else}
			<div class="items-list">
				{#each items as item (item.id)}
					<div class="item-card">
						<div class="item-card-header">
							<h3>{item.name}</h3>
							<div class="item-card-actions">
								{#if item.syncStatus === 'local' || item.syncStatus === 'error'}
									<button class="btn-icon" onclick={() => syncItem(item)} aria-label="Sync Item">
										<i class="material-icons" style={item.syncStatus === 'error' ? 'color: var(--md-sys-color-error)' : ''}>sync</i>
									</button>
								{/if}
								<button class="btn-icon" onclick={() => handleEdit(item)} aria-label="Edit Item"><i class="material-icons">edit</i></button>
								<button class="btn-icon" onclick={() => promptForDelete(item)} aria-label="Delete Item"><i class="material-icons" style="color: var(--md-sys-color-error)">delete</i></button>
							</div>
						</div>
						<div class="item-card-body">
							<div><p class="label">SKU</p><p class="value">{item.sku || 'N/A'}</p></div>
							<div><p class="label">Category</p><p class="value">{item.category || 'N/A'}</p></div>
							<div class="full-width"><p class="label">Sync Status</p><p><span class="status-chip {item.syncStatus ?? 'local'}">{item.syncStatus ?? 'local'}</span></p></div>
							<div class="full-width"><p class="label">Photos</p>
								{#if item.photos && item.photos.length > 0}
									<div class="photo-gallery">
										{#each item.photos as photo, i}
											<div class="thumbnail">
												<img src={photo} alt="{item.name} preview {i + 1}" />
												<button class="btn-icon" style="position:absolute; bottom:0; right:0; background:rgba(0,0,0,0.5);" onclick={() => downloadPhoto(photo, item.sku, i)}>
													<i class="material-icons" style="color:white; font-size:16px;">download</i>
												</button>
											</div>
										{/each}
									</div>
								{:else}
									<p class="value">No Photos</p>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</main>

	<button class="fab" onclick={handleNew} aria-label="Add New Item">
		<i class="material-icons">add</i>
	</button>

	{#if selectedItem && formData}
		<div bind:this={modalBackdrop} class="modal-backdrop" role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') handleCancel(); }}>
			<div class="modal-content">
				{#if showCamera}
					<h2 class="modal-header">Take Photo</h2>
					<!-- svelte-ignore a11y-media-has-caption -->
					<video bind:this={videoElement} autoplay playsinline class="w-full rounded-md bg-black"></video>
					<canvas bind:this={canvasElement} style="display: none;"></canvas>
					<div class="modal-actions">
						<button type="button" onclick={stopCamera} class="btn btn-text">Cancel</button>
						<button type="button" onclick={capturePhoto} class="btn btn-filled">Capture</button>
					</div>
				{:else if showScanner}
					<h2 class="modal-header">Scan Barcode</h2>
					<div bind:this={scannerContainer} id="scanner-container"></div>
					<div class="modal-actions"><button class="btn btn-text" onclick={() => { showScanner = false; stopScanner(); }}>Cancel</button></div>
				{:else}
					<h2 class="modal-header">{formMode === 'create' ? 'Add New Item' : 'Edit Item'}</h2>
					<form onsubmit={handleSubmit}>
						<div class="form-field">
							<label for="category">Category</label>
							<select id="category" bind:value={formData.category} required>
								{#each categories as category}
									<option value={category}>{category}</option>
								{/each}
							</select>
						</div>
						<div class="form-field">
							<label for="sku">SKU</label>
							<input type="text" id="sku" bind:value={formData.sku} required readonly />
						</div>
						<div class="form-field">
							<label for="name">Name</label>
							<input type="text" id="name" bind:value={formData.name} required />
						</div>
						<div class="form-field">
							<label for="description">Description</label>
							<textarea id="description" rows="3" bind:value={formData.description}></textarea>
						</div>
						<div class="form-field">
							<div class="form-field-label">Photos</div>
							<div class="photo-gallery">
								{#each formData.photos as photo, index}
									<div class="thumbnail">
										<img src={photo} alt={`Preview ${index + 1}`} />
										<button type="button" class="remove-btn" onclick={() => removePhoto(index)}>&times;</button>
									</div>
								{/each}
							</div>
							<div class="photo-actions" style="display: flex; gap: 8px; margin-top: 8px;">
								<button type="button" onclick={startCamera} class="btn btn-text">
									<i class="material-icons" style="vertical-align: middle; margin-right: 4px;">photo_camera</i>Take Photo
								</button>
								<input type="file" id="photo-upload" accept="image/*" onchange={handleFileSelect} style="display: none;" multiple />
								<label for="photo-upload" class="btn btn-text" style="cursor: pointer; display: inline-flex; align-items: center;">
									<i class="material-icons" style="vertical-align: middle; margin-right: 4px;">photo_library</i>From Gallery
								</label>
							</div>
						</div>
						<div class="form-field">
							<label for="barcode">Barcode</label>
							<div class="input-container">
								<input type="text" id="barcode" bind:value={formData.barcode} />
								<button type="button" onclick={startBarcodeScanner} class="btn-icon" aria-label="Scan Barcode"><i class="material-icons">qr_code_scanner</i></button>
							</div>
						</div>
						<div class="checkbox-field">
							<input type="checkbox" id="is_active" bind:checked={formData.is_active} />
							<label for="is_active">Item is Active</label>
						</div>
						<div class="modal-actions">
							<button type="button" onclick={handleCancel} class="btn btn-text">Cancel</button>
							<button type="submit" class="btn btn-filled">Save Locally</button>
						</div>
					</form>
				{/if}
			</div>
		</div>
	{/if}
</div>
