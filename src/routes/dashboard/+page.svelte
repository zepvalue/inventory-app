<script lang="ts">
	// --- IMPORTS ---
	import { tick, onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { dbService, type Item } from '$lib/services/db';
	import { compressImage } from '$lib/services/image';
	import { buildSqlExport } from '$lib/services/sql-export';
	import {
		buildPhotoManifest,
		buildPhotoUrlIndex,
		serialisePhotoManifest
	} from '$lib/services/photo-manifest';
	import { listItems, getCurrentSource } from '$lib/convex';
	import {
		sync,
		queueSync,
		initSync,
		online,
		syncing,
		pendingCount,
		lastSyncError
	} from '$lib/services/sync';
	import { sourceForCreationTime } from '$lib/services/source';

	// --- CONSTANTS ---
	const categories = [
		'Kitchen',
		'Rig',
		'Toys',
		'Shade',
		'Tensegrities',
		'Wizard Hut',
		'Power',
		'Lighting',
		'Water/Shower',
		'Store',
		'Trash',
		'Replace',
		'Donate'
	];

	// A distinct, muted hex per category (not tied to MD3 tokens) so items are
	// scannable by category at a glance in the list. Deliberately avoids the
	// saturated greens/ambers/reds already used by sync-status chips, so a
	// category dot is never mistaken for a status indicator.
	const categoryColors: Record<string, string> = {
		Kitchen: '#C97B4A',
		Rig: '#5B7B92',
		Toys: '#B0558C',
		Shade: '#4E8B6E',
		Tensegrities: '#7C6FAE',
		'Wizard Hut': '#8C5E9C',
		Power: '#A97C3F',
		Lighting: '#D3A94E',
		'Water/Shower': '#4C8DA6',
		Store: '#6B7280',
		Trash: '#8D6E63',
		Replace: '#9C7A54',
		Donate: '#5C8A72'
	};
	function categoryColor(category: string): string {
		return categoryColors[category] ?? 'var(--md-sys-color-outline)';
	}

	// --- STATE ---
	let items = $state<Item[]>([]);
	let formMode = $state<'create' | 'edit'>('create');
	let selectedItem = $state<Item | null>(null);
	let formData = $state<Item | null>(null);
	let showMenu = $state(false);

	// Groups the flat item list into category sections, sorted alphabetically
	// within each group. Without this, items render in whatever order the
	// local DB returns them (most-recently-changed first), which reads as
	// arbitrary once there are more than a handful — grouping gives the list
	// real structure to scan by, the way a physical inventory would be
	// organized on shelves. Category order follows the app's own `categories`
	// list (same order as the add/edit form) rather than alphabetical, since
	// that's the order the person already thinks in; anything outside that
	// list (or blank) falls into "Uncategorized" at the end.
	interface CategoryGroup {
		category: string;
		color: string;
		items: Item[];
	}
	function groupItemsByCategory(list: Item[]): CategoryGroup[] {
		const byCategory = new Map<string, Item[]>();
		for (const item of list) {
			const key = item.category?.trim() || 'Uncategorized';
			const bucket = byCategory.get(key);
			if (bucket) bucket.push(item);
			else byCategory.set(key, [item]);
		}
		const orderIndex = new Map(categories.map((c, i) => [c, i]));
		const keys = [...byCategory.keys()].sort((a, b) => {
			if (a === 'Uncategorized') return 1;
			if (b === 'Uncategorized') return -1;
			const ai = orderIndex.get(a) ?? categories.length;
			const bi = orderIndex.get(b) ?? categories.length;
			return ai !== bi ? ai - bi : a.localeCompare(b);
		});
		return keys.map((key) => ({
			category: key,
			color: categoryColor(key),
			items: byCategory.get(key)!.sort((a, b) => a.name.localeCompare(b.name))
		}));
	}
	let groupedItems = $derived(groupItemsByCategory(items));

	// Reload the on-screen list from the local (offline-first) database.
	async function refresh() {
		items = await dbService.getAllItems();
	}

	// Show local data instantly, then start the sync engine. It pushes pending
	// changes and pulls server changes whenever a connection is available (on load,
	// on reconnect, and after edits); refresh() re-renders when that completes.
	onMount(() => {
		refresh();
		return initSync(refresh);
	});

	// SCAT/SCAB indicator — reflects which source tag a *new* item created
	// right now would get (see convex/source.ts for the cutover instant).
	// Sourced from the Convex server's clock (items:currentSource), not the
	// device's, so a wrong/spoofed local clock can't show a misleading tag.
	// Starts as `null` (loading) rather than seeding from the device clock —
	// seeding locally first caused a visible flash-then-correct whenever the
	// device clock disagreed with the server. Falls back to a local
	// estimate — clearly labeled — only once we know we're actually offline,
	// since there's no server to ask then. Refreshed on load, on reconnect,
	// and every minute so it flips live near the cutover.
	let currentSource = $state<string | null>(null);
	let currentSourceIsServerConfirmed = $state(false);
	async function refreshCurrentSource() {
		try {
			currentSource = await getCurrentSource();
			currentSourceIsServerConfirmed = true;
		} catch {
			// Offline or unreachable — fall back to the device clock. Still
			// correct for a device with a sane clock; just not server-verified.
			currentSource = sourceForCreationTime();
			currentSourceIsServerConfirmed = false;
		}
	}
	onMount(() => {
		refreshCurrentSource();
		const interval = setInterval(refreshCurrentSource, 60_000);
		window.addEventListener('online', refreshCurrentSource);
		return () => {
			clearInterval(interval);
			window.removeEventListener('online', refreshCurrentSource);
		};
	});

	// Alert on sync failures even when they happen in the background (e.g. the
	// debounced sync after a save, or a reconnect sync) — lastSyncError otherwise
	// only surfaces as a tooltip on the status chip, easy to miss. Gated on the
	// message changing so a repeated/unresolved error doesn't re-alert every
	// retry.
	let lastAlertedSyncError = $state<string | null>(null);
	$effect(() => {
		if ($lastSyncError && $lastSyncError !== lastAlertedSyncError) {
			lastAlertedSyncError = $lastSyncError;
			alert(`Sync finished with errors: ${$lastSyncError}`);
		}
	});

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
	let viewingItem = $state<Item | null>(null);
	let detailBackdrop = $state<HTMLElement | null>(null);

	// Keeps the open detail page's data current if a background sync/refresh
	// updates that same item underneath it (e.g. syncStatus flips once the
	// push completes) — otherwise the detail page would keep showing a
	// stale snapshot taken at the moment it was opened.
	$effect(() => {
		if (viewingItem?.id == null) return;
		const updated = items.find((i) => i.id === viewingItem?.id);
		if (updated && updated !== viewingItem) viewingItem = updated;
	});

	function openDetail(item: Item) {
		viewingItem = item;
		tick().then(() => detailBackdrop?.focus());
	}
	function closeDetail() {
		viewingItem = null;
	}
	function editFromDetail(item: Item) {
		closeDetail();
		handleEdit(item);
	}
	function deleteFromDetail(item: Item) {
		closeDetail();
		promptForDelete(item);
	}

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
			formData.sku = generateSku(formData.category ?? '');
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
	// The Refresh button triggers a full sync (push pending + pull server), then
	// re-renders from the local store.
	async function fetchItems() {
		await sync();
		await refresh();
	}

	// --- CSV, SQL & DOWNLOAD ---
	function download(contents: string, filename: string, mime: string) {
		const blob = new Blob([contents], { type: `${mime};charset=utf-8;` });
		const link = document.createElement('a');
		const url = URL.createObjectURL(blob);
		link.setAttribute('href', url);
		link.setAttribute('download', filename);
		link.click();
		URL.revokeObjectURL(url);
	}

	// Export shaped for the external inventory database (the Laravel/MySQL
	// schema), not for re-import into this app — use Export CSV for that.
	//
	// Photo links come from a live Convex pull rather than the local display
	// cache, which can be stale or incomplete for legacy items. Offline (or if
	// the pull fails) the export simply omits the photo_urls column, so the file
	// stays safe to import — it just leaves existing links alone.
	let exportingSql = $state(false);
	async function exportToSQL() {
		if (items.length === 0) return alert('No items to export.');

		let photoUrls: Map<string, string[]> | undefined;
		if ($online) {
			exportingSql = true;
			try {
				photoUrls = buildPhotoUrlIndex(await listItems());
			} catch (error) {
				console.error('Could not fetch photo links:', error);
			} finally {
				exportingSql = false;
			}
		}

		const { sql, exported, skipped, duplicateSkus, photoUrlsIncluded } = buildSqlExport(
			items,
			Date.now(),
			photoUrls
		);
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		download(sql, `inventory_import_${stamp}.sql`, 'application/sql');

		const notes: string[] = [];
		if (skipped.length) notes.push(`${skipped.length} skipped (missing sku or name — see NOTES)`);
		if (duplicateSkus.length) notes.push(`${duplicateSkus.length} duplicate sku(s) collapsed`);
		notes.push(
			photoUrlsIncluded
				? `${photoUrls?.size ?? 0} item(s) carry photo links`
				: 'No photo links (offline or Convex unreachable) — the import will leave existing links untouched'
		);
		alert(`Exported ${exported} item(s) as SQL.\n\n${notes.join('\n')}`);
	}

	// Companion to the SQL export: a sku -> photo-URL manifest for the Laravel
	// side to pull through Spatie MediaLibrary (see docs/photo-migration.md).
	// Unlike the other exports this needs the network — the URLs are resolved
	// fresh by Convex rather than read from the local display cache, which can be
	// stale or (for legacy items) missing entries.
	let exportingPhotos = $state(false);
	async function exportPhotoManifest() {
		if (!$online) return alert('Photo manifest needs a connection — the URLs come from Convex.');
		if (
			$pendingCount > 0 &&
			!confirm(
				`${$pendingCount} item(s) haven't synced yet. Their photos exist only on this device and ` +
					`will be missing from the manifest.\n\nExport anyway?`
			)
		)
			return;

		exportingPhotos = true;
		try {
			const manifest = buildPhotoManifest(await listItems());
			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			download(
				serialisePhotoManifest(manifest),
				`photo_manifest_${stamp}.json`,
				'application/json'
			);
			alert(
				`Manifest lists ${manifest.photo_count} photo(s) across ${manifest.item_count} item(s).` +
					(manifest.warnings.length
						? `\n\n${manifest.warnings.length} warning(s) — see "warnings" in the file.`
						: '')
			);
		} catch (error) {
			console.error('Photo manifest export failed:', error);
			alert(
				`Could not build the photo manifest: ${error instanceof Error ? error.message : error}`
			);
		} finally {
			exportingPhotos = false;
		}
	}

	function exportToCSV() {
		if (items.length === 0) return alert('No items to export.');
		const headers = [
			'id',
			'name',
			'sku',
			'barcode',
			'description',
			'category',
			'is_active',
			'photos',
			'syncStatus'
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
		download(csvRows.join('\n'), `inventory_export_${new Date().toISOString()}.csv`, 'text/csv');
	}

	function parseCsvRow(row: string): string[] {
		const result: string[] = [];
		let currentField = '';
		let inQuotes = false;
		for (let i = 0; i < row.length; i++) {
			const char = row[i];
			if (char === '"') {
				if (inQuotes && row[i + 1] === '"') {
					currentField += '"';
					i++;
				} else {
					inQuotes = !inQuotes;
				}
			} else if (char === ',' && !inQuotes) {
				result.push(currentField);
				currentField = '';
			} else {
				currentField += char;
			}
		}
		result.push(currentField);
		return result;
	}

	function handleFileImport(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = async (e) => {
			const text = e.target?.result as string;
			if (!text) return;
			try {
				const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
				if (lines.length < 2) return;

				const headers = parseCsvRow(lines[0]).map((h) => h.trim().toLowerCase());
				const importedItems: Partial<Item>[] = [];
				for (let i = 1; i < lines.length; i++) {
					const values = parseCsvRow(lines[i]);
					const itemData: any = {};
					headers.forEach((key, index) => (itemData[key] = values[index] || ''));

					importedItems.push({
						name: itemData.name,
						sku: itemData.sku,
						barcode: itemData.barcode || '',
						description: itemData.description || '',
						category: itemData.category || categories[0],
						is_active: String(itemData.is_active).toLowerCase() === 'true',
						photos: itemData.photos ? itemData.photos.split(';') : []
					});
				}
				// Save locally first (offline-first), then let the sync engine push them.
				await dbService.bulkCreate(importedItems);
				await refresh();
				queueSync(refresh);
				alert(
					`Imported ${importedItems.length} items locally. They will sync automatically when online.`
				);
			} catch (error) {
				console.error('Error parsing CSV:', error);
				alert('Failed to parse CSV file.');
			}
		};
		reader.readAsText(file);
		target.value = '';
	}

	// `photos[i]` is a `data:` URL (not yet synced) or a Convex storage id
	// (synced, not directly displayable) — resolve to whatever's renderable.
	function photoSrc(photos: string[], photoUrls: string[] | undefined, index: number): string {
		const photo = photos[index];
		return photo?.startsWith('data:') ? photo : (photoUrls?.[index] ?? '');
	}

	function downloadPhoto(dataUrl: string, sku: string, index: number) {
		const link = document.createElement('a');
		link.href = dataUrl;
		link.download = `${sku || 'download'}_${index + 1}.jpeg`;
		link.click();
	}

	// --- DATABASE SYNC ---
	// All syncing is handled centrally by the sync engine; these just trigger it and
	// re-render. The engine pushes every pending/error item and pulls server changes.
	async function syncAllItems() {
		if ($pendingCount === 0) return alert('Everything is already up-to-date.');
		await sync();
		await refresh();
		if (!$lastSyncError) alert('Sync complete!');
	}

	async function syncItem(_item: Item) {
		await sync();
		await refresh();
	}

	// --- LOCAL CRUD & Other Handlers ---
	async function handleSubmit(e: Event) {
		e.preventDefault();
		if (!formData) return;
		if (!formData.name || !formData.sku) return alert('Item Name and SKU are required.');

		// Save locally first; the sync engine pushes it when a connection is available.
		if (formMode === 'create') {
			await dbService.create(formData);
		} else if (formData.id != null) {
			await dbService.update(formData.id, formData);
		}
		await refresh();
		queueSync(refresh);
		handleCancel();
	}

	async function executeDelete() {
		if (!itemToDelete || itemToDelete.id == null) return;
		// Soft-delete locally (or drop outright if it never reached the server); the
		// sync engine sends the DELETE to the backend when online.
		await dbService.remove(itemToDelete.id);
		await refresh();
		queueSync(refresh);
		itemToDelete = null;
	}

	async function handleNew() {
		formMode = 'create';
		const defaultCategory = categories[0];
		const newItem: Item = {
			serverId: null,
			name: '',
			sku: generateSku(defaultCategory),
			barcode: '',
			description: '',
			category: defaultCategory,
			is_active: true,
			photos: [],
			syncStatus: 'pending',
			lastModified: 0
		};
		selectedItem = newItem;
		formData = { ...newItem };
		await tick();
		modalBackdrop?.focus();
	}

	async function handleEdit(item: Item) {
		formMode = 'edit';
		selectedItem = { ...item, photos: item.photos || [], photoUrls: item.photoUrls || [] };
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
			mediaStream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' }
			});
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

	async function capturePhoto() {
		if (!videoElement || !canvasElement || !formData) return;
		canvasElement.width = videoElement.videoWidth;
		canvasElement.height = videoElement.videoHeight;
		const context = canvasElement.getContext('2d');
		if (context) {
			context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
			const photoDataUrl = await compressImage(canvasElement.toDataURL('image/jpeg'));
			if (formData) {
				formData.photos.push(photoDataUrl);
				formData.photos = [...formData.photos];
			}
		}
		stopCamera();
	}

	function removePhoto(indexToRemove: number) {
		if (formData) {
			formData.photos.splice(indexToRemove, 1);
			formData.photos = [...formData.photos];
			if (formData.photoUrls) {
				formData.photoUrls.splice(indexToRemove, 1);
				formData.photoUrls = [...formData.photoUrls];
			}
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
			reader.onload = async () => {
				const compressed = await compressImage(reader.result as string);
				if (formData) {
					formData.photos.push(compressed);
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
			padding: 12px 16px;
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
			display: flex;
			flex-direction: column;
			gap: 8px;
			position: sticky;
			top: 0;
			z-index: 10;
		}
		.top-bar-row {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 8px;
		}
		.top-bar-title {
			display: flex;
			align-items: baseline;
			gap: 8px;
			min-width: 0;
		}
		.top-bar h1 {
			font-size: 1.375rem;
			font-weight: 600;
			margin: 0;
		}
		.top-bar-status-row {
			min-height: 28px;
		}
		.top-bar-actions {
			display: flex;
			gap: 4px;
			align-items: center;
		}
		main {
			padding: 10px 14px;
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
			transition:
				transform 150ms ease,
				box-shadow 150ms ease;
		}
		.fab.fab-pulse {
			animation: fabPulse 6s ease-in-out infinite;
		}
		.fab:hover {
			transform: scale(1.08);
			box-shadow: 0 6px 16px rgba(0, 0, 0, 0.25);
		}
		.fab:active {
			transform: scale(0.94);
			box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
		}
		.empty-state {
			text-align: center;
			padding: 4rem 1.5rem;
			color: var(--md-sys-color-on-surface-variant);
		}
		.empty-state-icon {
			font-size: 3.5rem;
			color: var(--md-sys-color-outline);
		}
		.empty-state-title {
			margin: 1rem 0 0.25rem;
			font-size: 1.0625rem;
			font-weight: 500;
			color: var(--md-sys-color-on-surface);
		}
		.empty-state-hint {
			margin: 0;
			font-size: 0.875rem;
		}
		.item-card {
			display: flex;
			align-items: center;
			gap: 12px;
			width: 100%;
			background-color: var(--md-sys-color-surface);
			border: none;
			border-radius: 14px;
			box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
			padding: 8px 10px;
			margin-bottom: 6px;
			font-family: inherit;
			text-align: left;
			cursor: pointer;
			transition:
				transform 200ms ease,
				box-shadow 200ms ease;
		}
		.item-card:hover {
			transform: translateY(-1px);
			box-shadow: 0 3px 10px rgba(0, 0, 0, 0.08);
		}
		.item-card:active {
			transform: translateY(0);
			box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
		}
		.item-card-thumb {
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			width: 44px;
			height: 44px;
			border-radius: 10px;
			background-color: var(--md-sys-color-surface-variant);
			color: var(--md-sys-color-on-surface-variant);
			overflow: hidden;
		}
		.item-card-thumb img {
			width: 100%;
			height: 100%;
			object-fit: cover;
		}
		.item-card-thumb .material-icons {
			font-size: 20px;
			opacity: 0.6;
		}
		.item-card-heading {
			min-width: 0;
			flex-grow: 1;
		}
		.item-card-heading h3 {
			font-size: 1rem;
			font-weight: 600;
			margin: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--md-sys-color-on-surface);
		}
		.item-card-meta {
			display: flex;
			align-items: center;
			gap: 6px;
			margin: 1px 0 0;
			font-size: 0.75rem;
			color: var(--md-sys-color-on-surface-variant);
		}
		.item-card-sku {
			font-family: 'Roboto Mono', monospace;
			font-size: 0.6875rem;
		}
		.item-card-status-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			flex-shrink: 0;
		}
		.item-card-status-dot.pending {
			background-color: #ff6f00;
		}
		.item-card-status-dot.error {
			background-color: var(--md-sys-color-error);
		}
		.item-card-chevron {
			flex-shrink: 0;
			color: var(--md-sys-color-outline);
			font-size: 20px;
		}
		.category-section {
			margin-bottom: 18px;
		}
		.category-section:last-child {
			margin-bottom: 0;
		}
		.category-header {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 4px 2px 8px;
		}
		.category-dot {
			width: 9px;
			height: 9px;
			border-radius: 50%;
			flex-shrink: 0;
		}
		.category-header h2 {
			margin: 0;
			font-size: 0.8125rem;
			font-weight: 600;
			letter-spacing: 0.02em;
			color: var(--md-sys-color-on-surface-variant);
		}
		.category-count {
			font-size: 0.75rem;
			color: var(--md-sys-color-outline);
			font-variant-numeric: tabular-nums;
		}
		.detail-page {
			position: fixed;
			inset: 0;
			z-index: 40;
			background-color: var(--md-sys-color-surface);
			display: flex;
			flex-direction: column;
		}
		.detail-header {
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 10px 8px;
			border-bottom: 1px solid var(--md-sys-color-outline-variant);
			flex-shrink: 0;
		}
		.detail-header h2 {
			flex-grow: 1;
			min-width: 0;
			margin: 0;
			font-size: 1.0625rem;
			font-weight: 600;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			padding: 0 4px;
		}
		.detail-body {
			flex-grow: 1;
			overflow-y: auto;
			padding: 16px;
		}
		.detail-section {
			margin-bottom: 20px;
		}
		.detail-section:last-child {
			margin-bottom: 0;
		}
		.detail-label {
			margin: 0 0 4px;
			font-size: 0.75rem;
			font-weight: 600;
			color: var(--md-sys-color-on-surface-variant);
		}
		.detail-value {
			margin: 0;
			font-size: 0.9375rem;
			color: var(--md-sys-color-on-surface);
		}
		.detail-value.mono {
			font-family: 'Roboto Mono', monospace;
		}
		.detail-value-description {
			white-space: pre-wrap;
		}
		.detail-value.detail-empty {
			color: var(--md-sys-color-on-surface-variant);
			font-style: italic;
		}
		.detail-sync-row {
			display: flex;
			align-items: center;
			gap: 4px;
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
			text-transform: capitalize;
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
		.source-badge {
			display: inline-flex;
			align-items: center;
			flex-shrink: 0;
			padding: 1px 7px;
			border-radius: 10px;
			font-family: 'Roboto Mono', monospace;
			font-size: 0.6875rem;
			font-weight: 600;
			letter-spacing: 0.02em;
			border: 1px solid currentColor;
			background: none;
			position: relative;
			top: -1px;
		}
		.source-badge.scat {
			color: var(--md-sys-color-secondary);
		}
		.source-badge.scab {
			color: var(--md-sys-color-tertiary);
		}
		.source-chip-offline-mark {
			margin-left: 2px;
			font-weight: 700;
		}
		@keyframes pulse {
			0% {
				opacity: 1;
			}
			50% {
				opacity: 0.4;
			}
			100% {
				opacity: 1;
			}
		}
		@keyframes fabPulse {
			0%,
			100% {
				box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
			}
			50% {
				box-shadow: 0 4px 16px rgba(103, 80, 164, 0.4);
			}
		}
		@keyframes spin {
			from {
				transform: rotate(0deg);
			}
			to {
				transform: rotate(360deg);
			}
		}
		.modal-backdrop {
			position: fixed;
			inset: 0;
			background-color: rgba(0, 0, 0, 0.5);
			display: flex;
			align-items: center;
			justify-content: center;
			z-index: 50;
			padding: 16px;
		}
		.modal-content {
			background-color: var(--md-sys-color-surface);
			border-radius: 28px;
			padding: 20px;
			width: 100%;
			max-width: 400px;
			box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
			max-height: 90vh;
			overflow-y: auto;
		}
		.modal-header {
			font-size: 1.375rem;
			margin-bottom: 16px;
		}
		.form-field {
			margin-bottom: 16px;
		}
		.form-field label,
		.form-field-label {
			display: block;
			font-size: 0.75rem;
			color: var(--md-sys-color-primary);
			margin-bottom: 4px;
			padding-left: 16px;
		}
		.input-container {
			position: relative;
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.form-field input[type='text'],
		.form-field textarea,
		.form-field select {
			background-color: var(--md-sys-color-surface-variant);
			border: none;
			border-radius: 4px;
			padding: 14px 16px;
			font-size: 1rem;
			color: var(--md-sys-color-on-surface-variant);
			width: 100%;
			box-sizing: border-box;
		}
		.form-field textarea {
			font-family: 'Roboto', sans-serif;
			resize: vertical;
		}
		.checkbox-field {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 12px 0;
		}
		.modal-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			margin-top: 24px;
		}
		.btn {
			padding: 10px 20px;
			border-radius: 20px;
			border: none;
			font-weight: 500;
			font-size: 0.875rem;
			cursor: pointer;
		}
		.btn-text {
			background: none;
			color: var(--md-sys-color-primary);
			transition: background-color 150ms ease;
		}
		.btn-text:hover {
			background-color: rgba(103, 80, 164, 0.08);
		}
		.btn-filled {
			background-color: var(--md-sys-color-primary);
			color: var(--md-sys-color-on-primary);
			transition:
				box-shadow 150ms ease,
				transform 100ms ease;
		}
		.btn-filled:hover:not(:disabled) {
			box-shadow: 0 2px 8px rgba(103, 80, 164, 0.35);
		}
		.btn-filled:active:not(:disabled) {
			transform: scale(0.97);
		}
		.btn-filled:disabled {
			background-color: #e0e0e0;
			color: #9e9e9e;
			cursor: not-allowed;
		}
		.btn-icon {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			width: 40px;
			height: 40px;
			padding: 0;
			border-radius: 50%;
			border: none;
			background: none;
			cursor: pointer;
			color: var(--md-sys-color-on-surface-variant);
			transition:
				background-color 150ms ease,
				transform 100ms ease;
		}
		.btn-icon:hover {
			background-color: rgba(0, 0, 0, 0.06);
		}
		.btn-icon:active {
			transform: scale(0.9);
		}
		.btn-icon-danger {
			color: var(--md-sys-color-on-surface-variant);
		}
		.btn-icon-danger:hover,
		.btn-icon-danger:focus-visible {
			color: var(--md-sys-color-error);
			background-color: var(--md-sys-color-error-container);
		}
		#scanner-container {
			width: 100%;
			height: 250px;
			position: relative;
			background-color: #000;
			border-radius: 12px;
			overflow: hidden;
			margin-bottom: 16px;
		}
		.photo-gallery {
			display: flex;
			flex-wrap: wrap;
			gap: 8px;
			margin-top: 8px;
		}
		.photo-gallery-compact {
			gap: 6px;
			margin-top: 6px;
		}
		.photo-gallery-compact .thumbnail {
			width: 52px;
			height: 52px;
		}
		.photo-gallery-compact .thumbnail .btn-icon {
			width: 24px;
			height: 24px;
		}
		.thumbnail {
			position: relative;
			width: 72px;
			height: 72px;
		}
		.thumbnail img {
			width: 100%;
			height: 100%;
			object-fit: cover;
			border-radius: 4px;
			border: 1px solid var(--md-sys-color-outline);
		}
		.thumbnail .remove-btn {
			position: absolute;
			top: -4px;
			right: -4px;
			width: 20px;
			height: 20px;
			border-radius: 50%;
			border: 1px solid white;
			background-color: var(--md-sys-color-error);
			color: white;
			display: flex;
			align-items: center;
			justify-content: center;
			cursor: pointer;
			font-size: 14px;
			line-height: 1;
		}
		.dropdown {
			position: relative;
		}
		.dropdown-menu {
			position: absolute;
			top: 100%;
			right: 0;
			background-color: var(--md-sys-color-surface);
			border-radius: 4px;
			box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
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
			transition: background-color 120ms ease;
		}
		.dropdown-item:hover {
			background-color: rgba(0, 0, 0, 0.05);
		}
	</style>
</svelte:head>

<div class="app-container">
	<header class="top-bar">
		<div class="top-bar-row">
			<div class="top-bar-title">
				<h1>Inventory</h1>
				{#if currentSource}
					<span
						class="source-badge {currentSource === 'SCAB' ? 'scab' : 'scat'}"
						title={currentSourceIsServerConfirmed
							? `New items are currently tagged source: ${currentSource} (server-confirmed)`
							: `New items are currently tagged source: ${currentSource} (device estimate — offline)`}
					>
						{currentSource}{#if !currentSourceIsServerConfirmed}<span
								class="source-chip-offline-mark">*</span
							>{/if}
					</span>
				{/if}
			</div>
			<div class="dropdown">
				<button onclick={() => (showMenu = !showMenu)} class="btn-icon" aria-label="More options">
					<i class="material-icons">more_vert</i>
				</button>
				{#if showMenu}
					<div class="dropdown-menu" transition:fly={{ y: -8, x: 8, duration: 150 }}>
						<label for="csv-import" class="dropdown-item">
							<i class="material-icons">upload</i>
							<span>Import CSV</span>
						</label>
						<input
							type="file"
							id="csv-import"
							accept=".csv"
							onchange={handleFileImport}
							style="display: none;"
						/>
						<div class="dropdown-item" onclick={exportToCSV}>
							<i class="material-icons">download</i>
							<span>Export CSV</span>
						</div>
						<div class="dropdown-item" onclick={exportToSQL}>
							<i class="material-icons">storage</i>
							<span>{exportingSql ? 'Building…' : 'Export SQL'}</span>
						</div>
						<div class="dropdown-item" onclick={exportPhotoManifest}>
							<i class="material-icons">photo_library</i>
							<span>{exportingPhotos ? 'Building…' : 'Export Photo Manifest'}</span>
						</div>
					</div>
					<div class="fixed inset-0 z-10" onclick={() => (showMenu = false)}></div>
				{/if}
			</div>
		</div>
		<div class="top-bar-row top-bar-status-row">
			<span
				class="status-chip {!$online
					? 'error'
					: $syncing
						? 'pending'
						: $pendingCount > 0
							? 'local'
							: 'synced'}"
				title={$lastSyncError ?? ''}
			>
				{#if !$online}
					Offline
				{:else if $syncing}
					Syncing…
				{:else if $pendingCount > 0}
					{$pendingCount} pending
				{:else}
					Synced
				{/if}
			</span>
			<div class="top-bar-actions">
				<button onclick={fetchItems} class="btn-icon" aria-label="Refresh items" disabled={$syncing}>
					<i class="material-icons" style={$syncing ? 'animation: spin 1s linear infinite;' : ''}
						>refresh</i
					>
				</button>
				<button
					class="btn btn-filled"
					onclick={syncAllItems}
					disabled={$pendingCount === 0 || $syncing}
				>
					{#if $syncing}
						Syncing...
					{:else}
						Sync All ({$pendingCount})
					{/if}
				</button>
			</div>
		</div>
	</header>

	<main>
		{#if items.length === 0}
			<div class="empty-state">
				<i class="material-icons empty-state-icon">inventory_2</i>
				<p class="empty-state-title">No items yet</p>
				<p class="empty-state-hint">Tap + to add your first item.</p>
			</div>
		{:else}
			<div class="items-list">
				{#each groupedItems as group (group.category)}
					<div class="category-section">
						<div class="category-header">
							<span class="category-dot" style="background-color: {group.color}"></span>
							<h2>{group.category}</h2>
							<span class="category-count">{group.items.length}</span>
						</div>
						{#each group.items as item (item.id)}
							<button
								class="item-card"
								onclick={() => openDetail(item)}
								in:fly={{ y: 20, duration: 250, delay: Math.min(200, 30) }}
							>
								<div class="item-card-thumb">
									{#if item.photos && item.photos.length > 0}
										<img src={photoSrc(item.photos, item.photoUrls, 0)} alt="" />
									{:else}
										<i class="material-icons">inventory_2</i>
									{/if}
								</div>
								<div class="item-card-heading">
									<h3>{item.name}</h3>
									<p class="item-card-meta">
										<span class="item-card-sku">{item.sku || 'No SKU'}</span>
									</p>
								</div>
								{#if item.syncStatus && item.syncStatus !== 'synced'}
									<span
										class="item-card-status-dot {item.syncStatus}"
										title="Sync status: {item.syncStatus}"
									></span>
								{/if}
								<i class="material-icons item-card-chevron" aria-hidden="true">chevron_right</i>
							</button>
						{/each}
					</div>
				{/each}
			</div>
		{/if}
	</main>

	{#if viewingItem}
		<div
			bind:this={detailBackdrop}
			class="detail-page"
			role="dialog"
			aria-label="{viewingItem.name} details"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'Escape') closeDetail();
			}}
			transition:fly={{ x: 32, duration: 200 }}
		>
			<div class="detail-header">
				<button class="btn-icon" onclick={closeDetail} aria-label="Back to list">
					<i class="material-icons">arrow_back</i>
				</button>
				<h2>{viewingItem.name}</h2>
				<button class="btn-icon" onclick={() => viewingItem && editFromDetail(viewingItem)} aria-label="Edit Item">
					<i class="material-icons">edit</i>
				</button>
				<button
					class="btn-icon btn-icon-danger"
					onclick={() => viewingItem && deleteFromDetail(viewingItem)}
					aria-label="Delete Item"
				>
					<i class="material-icons">delete</i>
				</button>
			</div>

			<div class="detail-body">
				{#if viewingItem.photos && viewingItem.photos.length > 0}
					<div class="detail-section">
						<div class="photo-gallery">
							{#each viewingItem.photos as photo, i}
								<div class="thumbnail">
									<img
										src={photoSrc(viewingItem.photos, viewingItem.photoUrls, i)}
										alt="{viewingItem.name} preview {i + 1}"
									/>
									<button
										class="btn-icon"
										style="position:absolute; bottom:0; right:0; background:rgba(0,0,0,0.5);"
										onclick={() =>
											viewingItem &&
											downloadPhoto(
												photoSrc(viewingItem.photos, viewingItem.photoUrls, i),
												viewingItem.sku,
												i
											)}
									>
										<i class="material-icons" style="color:white; font-size:16px;">download</i>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<div class="detail-section">
					<p class="detail-label">SKU</p>
					<p class="detail-value mono">{viewingItem.sku || 'No SKU'}</p>
				</div>

				<div class="detail-section">
					<p class="detail-label">Category</p>
					<p class="detail-value">{viewingItem.category || 'Uncategorized'}</p>
				</div>

				{#if viewingItem.barcode}
					<div class="detail-section">
						<p class="detail-label">Barcode</p>
						<p class="detail-value mono">{viewingItem.barcode}</p>
					</div>
				{/if}

				<div class="detail-section">
					<p class="detail-label">Description</p>
					{#if viewingItem.description}
						<p class="detail-value detail-value-description">{viewingItem.description}</p>
					{:else}
						<p class="detail-value detail-empty">No description</p>
					{/if}
				</div>

				<div class="detail-section">
					<p class="detail-label">Status</p>
					<span class="status-chip {viewingItem.is_active ? 'active' : 'inactive'}"
						>{viewingItem.is_active ? 'Active' : 'Inactive'}</span
					>
				</div>

				<div class="detail-section">
					<p class="detail-label">Sync</p>
					<div class="detail-sync-row">
						<span class="status-chip {viewingItem.syncStatus ?? 'pending'}"
							>{viewingItem.syncStatus ?? 'pending'}</span
						>
						{#if viewingItem.syncStatus === 'pending' || viewingItem.syncStatus === 'error'}
							<button class="btn btn-text" onclick={() => viewingItem && syncItem(viewingItem)}>
								Sync now
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<button class="fab {items.length === 0 ? 'fab-pulse' : ''}" onclick={handleNew} aria-label="Add New Item">
		<i class="material-icons">add</i>
	</button>

	{#if selectedItem && formData}
		<div
			bind:this={modalBackdrop}
			class="modal-backdrop"
			role="dialog"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'Escape') handleCancel();
			}}
			transition:fade={{ duration: 150 }}
		>
			<div class="modal-content">
				{#if showCamera}
					<h2 class="modal-header" in:fly={{ y: 16, duration: 200 }}>Take Photo</h2>
					<!-- svelte-ignore a11y-media-has-caption -->
					<video bind:this={videoElement} autoplay playsinline class="w-full rounded-md bg-black"
					></video>
					<canvas bind:this={canvasElement} style="display: none;"></canvas>
					<div class="modal-actions">
						<button type="button" onclick={stopCamera} class="btn btn-text">Cancel</button>
						<button type="button" onclick={capturePhoto} class="btn btn-filled">Capture</button>
					</div>
				{:else if showScanner}
					<h2 class="modal-header" in:fly={{ y: 16, duration: 200 }}>Scan Barcode</h2>
					<div bind:this={scannerContainer} id="scanner-container"></div>
					<div class="modal-actions">
						<button
							class="btn btn-text"
							onclick={() => {
								showScanner = false;
								stopScanner();
							}}>Cancel</button
						>
					</div>
				{:else}
					<h2 class="modal-header" in:fly={{ y: 16, duration: 200 }}>
						{formMode === 'create' ? 'Add New Item' : 'Edit Item'}
					</h2>
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
										<img
											src={photoSrc(formData.photos, formData.photoUrls, index)}
											alt={`Preview ${index + 1}`}
										/>
										<button type="button" class="remove-btn" onclick={() => removePhoto(index)}
											>&times;</button
										>
									</div>
								{/each}
							</div>
							<div class="photo-actions" style="display: flex; gap: 8px; margin-top: 8px;">
								<button type="button" onclick={startCamera} class="btn btn-text">
									<i class="material-icons" style="vertical-align: middle; margin-right: 4px;"
										>photo_camera</i
									>Take Photo
								</button>
								<input
									type="file"
									id="photo-upload"
									accept="image/*"
									onchange={handleFileSelect}
									style="display: none;"
									multiple
								/>
								<label
									for="photo-upload"
									class="btn btn-text"
									style="cursor: pointer; display: inline-flex; align-items: center;"
								>
									<i class="material-icons" style="vertical-align: middle; margin-right: 4px;"
										>photo_library</i
									>From Gallery
								</label>
							</div>
						</div>
						<div class="form-field">
							<label for="barcode">Barcode</label>
							<div class="input-container">
								<input type="text" id="barcode" bind:value={formData.barcode} />
								<button
									type="button"
									onclick={startBarcodeScanner}
									class="btn-icon"
									aria-label="Scan Barcode"><i class="material-icons">qr_code_scanner</i></button
								>
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

	{#if itemToDelete}
		<div
			bind:this={deleteModalBackdrop}
			class="modal-backdrop"
			role="dialog"
			tabindex="-1"
			onkeydown={(e) => {
				if (e.key === 'Escape') itemToDelete = null;
			}}
			transition:fade={{ duration: 150 }}
		>
			<div class="modal-content">
				<h2 class="modal-header" in:fly={{ y: 16, duration: 200 }}>Delete Item</h2>
				<p>Delete <strong>{itemToDelete.name || 'this item'}</strong>? This can't be undone.</p>
				<div class="modal-actions">
					<button type="button" onclick={() => (itemToDelete = null)} class="btn btn-text"
						>Cancel</button
					>
					<button
						type="button"
						onclick={executeDelete}
						class="btn btn-filled"
						style="background: var(--md-sys-color-error); color: white;">Delete</button
					>
				</div>
			</div>
		</div>
	{/if}
</div>
