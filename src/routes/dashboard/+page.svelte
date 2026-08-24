<script lang="ts">
	// --- IMPORTS ---
	import { tick, onMount } from 'svelte';
	import { fly, fade } from 'svelte/transition';
	import { browser } from '$app/environment';
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
	let showPhotoSourceMenu = $state(false);
	let showFilterMenu = $state(false);
	let showSortMenu = $state(false);
	let activeCategoryFilters = $state<string[]>([]);
	type SortOption = 'name-asc' | 'name-desc' | 'date-newest' | 'date-oldest';
	let sortOption = $state<SortOption>('name-asc');
	const sortOptions: { value: SortOption; label: string }[] = [
		{ value: 'name-asc', label: 'Name (A–Z)' },
		{ value: 'name-desc', label: 'Name (Z–A)' },
		{ value: 'date-newest', label: 'Date added (newest)' },
		{ value: 'date-oldest', label: 'Date added (oldest)' }
	];

	// Groups the flat item list into category buckets purely to drive the
	// filter chip bar (name, color, count per category) — items render as a
	// single flat, alphabetically-sorted list filtered down to whichever chip
	// (if any) is active, rather than always-on grouped sections. Category
	// order follows the app's own `categories` list (same order as the
	// add/edit form) rather than alphabetical, since that's the order the
	// person already thinks in; anything outside that list (or blank) becomes
	// an "Uncategorized" chip at the end.
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
	let categoryFilters = $derived(groupItemsByCategory(items));

	// The flat list actually rendered: every item if no filters are active,
	// otherwise items matching ANY selected category (multi-select, not
	// AND'd), ordered by whichever sort option is active. "Date added" uses
	// the local auto-increment `id` rather than `lastModified`, since id is
	// assigned once at creation and never changes, while lastModified also
	// updates on edits — id is the accurate "when was this added" signal.
	let filteredItems = $derived(sortItems(applyCategoryFilter(items)));

	function applyCategoryFilter(list: Item[]): Item[] {
		return activeCategoryFilters.length === 0
			? list
			: list.filter((i) => activeCategoryFilters.includes(i.category?.trim() || 'Uncategorized'));
	}
	function sortItems(list: Item[]): Item[] {
		const sorted = list.slice();
		switch (sortOption) {
			case 'name-desc':
				return sorted.sort((a, b) => b.name.localeCompare(a.name));
			case 'date-newest':
				return sorted.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
			case 'date-oldest':
				return sorted.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
			case 'name-asc':
			default:
				return sorted.sort((a, b) => a.name.localeCompare(b.name));
		}
	}

	function toggleCategoryFilter(category: string) {
		activeCategoryFilters = activeCategoryFilters.includes(category)
			? activeCategoryFilters.filter((c) => c !== category)
			: [...activeCategoryFilters, category];
	}
	function clearCategoryFilters() {
		activeCategoryFilters = [];
	}
	function selectSortOption(option: SortOption) {
		sortOption = option;
		showSortMenu = false;
	}

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

	// Locks background scroll while any full-screen/modal overlay is open.
	// Without this, the item list underneath is still scrollable — on mobile,
	// scrolling past the top or bottom of the overlay's own content triggers
	// the browser's rubber-band overscroll, which reveals the scrolled list
	// behind it for a moment even though the overlay is position: fixed and
	// covers the full viewport.
	$effect(() => {
		if (!browser) return;
		const overlayOpen =
			viewingItem !== null ||
			selectedItem !== null ||
			itemToDelete !== null ||
			lightboxIndex !== null;
		document.body.style.overflow = overlayOpen ? 'hidden' : '';
		return () => {
			document.body.style.overflow = '';
		};
	});

	function openDetail(item: Item) {
		viewingItem = item;
		tick().then(() => detailBackdrop?.focus());
	}
	function closeDetail() {
		viewingItem = null;
	}

	// Swipe-down-to-close on the bottom sheet. Only starts from the drag
	// handle or the header bar (not the scrollable body), so it can never
	// fight with normal content scrolling, and bails out entirely if the
	// gesture starts on a button (back/edit/delete) so taps there still work.
	// Pointer events (not touch-only) so this also works with mouse drag in
	// a desktop browser during development.
	const SHEET_CLOSE_THRESHOLD_PX = 100;
	let sheetDragging = $state(false);
	let sheetDragY = $state(0);
	let dragStartClientY = 0;

	function isInteractiveTarget(e: PointerEvent): boolean {
		return !!(e.target as HTMLElement).closest('button, a');
	}
	function onSheetDragStart(e: PointerEvent) {
		if (isInteractiveTarget(e)) return;
		sheetDragging = true;
		dragStartClientY = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onSheetDragMove(e: PointerEvent) {
		if (!sheetDragging) return;
		// Only allow dragging downward — this is a close gesture, not a resize.
		sheetDragY = Math.max(0, e.clientY - dragStartClientY);
	}
	function onSheetDragEnd() {
		if (!sheetDragging) return;
		sheetDragging = false;
		if (sheetDragY > SHEET_CLOSE_THRESHOLD_PX) {
			closeDetail();
		}
		sheetDragY = 0;
	}

	function editFromDetail(item: Item) {
		closeDetail();
		handleEdit(item);
	}
	function deleteFromDetail(item: Item) {
		closeDetail();
		promptForDelete(item);
	}

	// Full-screen photo viewer, opened by tapping the hero image or any
	// thumbnail in the detail page's Photos section. `null` = closed;
	// otherwise the index into viewingItem.photos currently shown.
	let lightboxIndex = $state<number | null>(null);
	let lightboxBackdrop = $state<HTMLElement | null>(null);

	function openLightbox(index: number) {
		lightboxIndex = index;
		tick().then(() => lightboxBackdrop?.focus());
	}
	function closeLightbox() {
		lightboxIndex = null;
	}
	function nextPhoto() {
		if (!viewingItem || lightboxIndex === null) return;
		lightboxIndex = (lightboxIndex + 1) % viewingItem.photos.length;
	}
	function prevPhoto() {
		if (!viewingItem || lightboxIndex === null) return;
		lightboxIndex = (lightboxIndex - 1 + viewingItem.photos.length) % viewingItem.photos.length;
	}

	// Swipe left/right to move between photos, or swipe down to close --
	// mirrors the detail sheet's drag-to-close, applied to the image wrapper
	// (a plain div with no Svelte transition: directive of its own, so its
	// reactive transform can't collide with one the way the sheet's did).
	// Horizontal swipe stays a discrete "go to next/prev" action (compares
	// start/end X only); vertical drag live-follows the finger like the sheet.
	const LIGHTBOX_CLOSE_THRESHOLD_PX = 100;
	let lightboxSwipeStartX = 0;
	let lightboxSwipeStartY = 0;
	let lightboxDragging = $state(false);
	let lightboxDragY = $state(0);

	function onLightboxPointerDown(e: PointerEvent) {
		lightboxSwipeStartX = e.clientX;
		lightboxSwipeStartY = e.clientY;
		lightboxDragging = true;
		lightboxDragY = 0;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onLightboxPointerMove(e: PointerEvent) {
		if (!lightboxDragging) return;
		// Only follow downward drags visually — this is a close gesture, not
		// a way to pan the image around.
		lightboxDragY = Math.max(0, e.clientY - lightboxSwipeStartY);
	}
	function onLightboxPointerUp(e: PointerEvent) {
		if (!lightboxDragging) return;
		lightboxDragging = false;
		const deltaX = e.clientX - lightboxSwipeStartX;
		const deltaY = e.clientY - lightboxSwipeStartY;
		if (Math.abs(deltaY) > Math.abs(deltaX) && deltaY > LIGHTBOX_CLOSE_THRESHOLD_PX) {
			closeLightbox();
			return;
		}
		lightboxDragY = 0;
		if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
			if (deltaX < 0) nextPhoto();
			else prevPhoto();
		}
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
		// Closes the hero's photo-source menu if it was open -- harmless no-op
		// if the file was picked via the other "From Gallery" trigger further
		// down the form, which doesn't use this menu at all.
		showPhotoSourceMenu = false;
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
		.item-card-category-dot {
			width: 6px;
			height: 6px;
			border-radius: 50%;
			flex-shrink: 0;
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
		.filter-row {
			display: flex;
			gap: 8px;
			margin-bottom: 12px;
		}
		.filter-trigger {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 7px 14px;
			border-radius: 20px;
			border: 1px solid var(--md-sys-color-outline-variant);
			background: none;
			color: var(--md-sys-color-on-surface-variant);
			font-family: inherit;
			font-size: 0.8125rem;
			font-weight: 500;
			cursor: pointer;
		}
		.filter-trigger .material-icons {
			font-size: 18px;
		}
		.filter-trigger.active {
			border-color: var(--md-sys-color-primary);
			color: var(--md-sys-color-primary);
		}
		.filter-trigger-count {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 18px;
			height: 18px;
			padding: 0 5px;
			border-radius: 9px;
			background-color: var(--md-sys-color-primary);
			color: var(--md-sys-color-on-primary);
			font-size: 0.6875rem;
			font-weight: 600;
		}
		.filter-menu {
			left: 0;
			right: auto;
			min-width: 220px;
			max-height: 340px;
			overflow-y: auto;
		}
		.sort-menu {
			min-width: 190px;
		}
		.filter-menu-item {
			width: 100%;
			border: none;
			background: none;
			font-family: inherit;
			text-align: left;
			font-size: 0.875rem;
		}
		.filter-menu-divider {
			height: 1px;
			margin: 6px 0;
			background-color: var(--md-sys-color-outline-variant);
		}
		.filter-menu-check {
			display: flex;
			align-items: center;
			justify-content: center;
			flex-shrink: 0;
			width: 18px;
			height: 18px;
			border-radius: 4px;
			border: 1.5px solid var(--filter-color, var(--md-sys-color-outline));
		}
		.filter-menu-check.checked {
			background-color: var(--filter-color, var(--md-sys-color-primary));
			border-color: var(--filter-color, var(--md-sys-color-primary));
		}
		.filter-menu-check .material-icons {
			font-size: 14px;
			color: #fff;
		}
		.filter-menu-radio {
			flex-shrink: 0;
			width: 16px;
			height: 16px;
			border-radius: 50%;
			border: 1.5px solid var(--md-sys-color-outline);
		}
		.filter-menu-radio.checked {
			border-color: var(--md-sys-color-primary);
			border-width: 5px;
		}
		.filter-menu-label {
			flex-grow: 1;
			color: var(--md-sys-color-on-surface);
		}
		.filter-menu-count {
			font-size: 0.75rem;
			color: var(--md-sys-color-on-surface-variant);
			font-variant-numeric: tabular-nums;
		}
		.detail-backdrop {
			position: fixed;
			inset: 0;
			z-index: 40;
			background-color: rgba(0, 0, 0, 0.5);
			display: flex;
			align-items: flex-end;
		}
		.detail-sheet {
			width: 100%;
			max-height: 88vh;
			max-height: 88dvh;
			background-color: var(--md-sys-color-surface);
			border-radius: 20px 20px 0 0;
			overflow: hidden;
		}
		/* Deliberately a separate element from .detail-sheet. .detail-sheet
		   carries the mount/unmount transition:fly (which briefly manipulates
		   its own transform during that animation); .detail-sheet-inner carries
		   the live drag-follow transform instead. Putting both on the same
		   element caused them to fight over the same CSS property -- Svelte's
		   transition directive and a manually-bound reactive style="transform"
		   binding don't compose safely together, and the drag gesture silently
		   stopped moving the sheet as a result. */
		.detail-sheet-inner {
			display: flex;
			flex-direction: column;
			height: 100%;
			min-height: 0;
		}
		.detail-sheet-handle {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 22px;
			flex-shrink: 0;
			cursor: grab;
			touch-action: none;
			user-select: none;
			-webkit-user-select: none;
		}
		.detail-sheet-handle::after {
			content: '';
			width: 36px;
			height: 4px;
			border-radius: 2px;
			background-color: var(--md-sys-color-outline-variant);
		}
		.detail-header {
			display: flex;
			align-items: center;
			gap: 4px;
			padding: 4px 8px 10px;
			border-bottom: 1px solid var(--md-sys-color-outline-variant);
			flex-shrink: 0;
			touch-action: none;
			user-select: none;
			-webkit-user-select: none;
			-webkit-touch-callout: none;
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
			-webkit-user-select: none;
			user-select: none;
		}
		.detail-body {
			flex-grow: 1;
			overflow-y: auto;
			padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
		}
		.detail-hero {
			display: block;
			width: 100%;
			height: 150px;
			border-radius: 14px;
			margin-bottom: 14px;
			padding: 0;
			border: none;
			background: none;
			cursor: pointer;
		}
		.detail-hero-image {
			width: 100%;
			height: 100%;
			border-radius: 14px;
			object-fit: cover;
		}
		.detail-hero-placeholder {
			width: 100%;
			height: 100%;
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.form-hero-placeholder {
			flex-direction: column;
			gap: 6px;
		}
		.form-hero-placeholder .material-icons {
			font-size: 40px;
			opacity: 0.7;
		}
		.form-hero-placeholder span {
			font-size: 0.8125rem;
			font-weight: 500;
			text-align: center;
			padding: 0 16px;
		}
		.form-hero-dropdown {
			position: relative;
			width: 100%;
			height: 100%;
		}
		.form-hero-trigger {
			display: block;
			width: 100%;
			height: 100%;
			padding: 0;
			border: none;
			background: none;
			cursor: pointer;
		}
		.form-hero-menu {
			left: 50%;
			right: auto;
			transform: translateX(-50%);
			min-width: 220px;
		}
		.form-label-with-dot {
			display: flex !important;
			align-items: center;
			gap: 6px;
		}
		.thumbnail {
			cursor: pointer;
		}
		.lightbox {
			position: fixed;
			inset: 0;
			z-index: 60;
			background-color: rgba(0, 0, 0, 0.92);
			display: flex;
			align-items: center;
			justify-content: center;
		}
		.lightbox-topbar {
			position: absolute;
			top: 0;
			left: 0;
			right: 0;
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding: calc(10px + env(safe-area-inset-top)) 12px 10px;
			z-index: 1;
		}
		.lightbox-count {
			color: rgba(255, 255, 255, 0.85);
			font-size: 0.8125rem;
			font-variant-numeric: tabular-nums;
		}
		.lightbox-actions {
			display: flex;
			gap: 4px;
		}
		.lightbox-btn {
			color: #fff;
		}
		.lightbox-btn:hover {
			background-color: rgba(255, 255, 255, 0.15);
		}
		.lightbox-image-wrap {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 100%;
			height: 100%;
			touch-action: pan-y;
		}
		.lightbox-image {
			max-width: 100%;
			max-height: 100%;
			object-fit: contain;
		}
		.lightbox-nav {
			position: absolute;
			top: 50%;
			transform: translateY(-50%);
			display: flex;
			align-items: center;
			justify-content: center;
			width: 40px;
			height: 40px;
			border-radius: 50%;
			border: none;
			background-color: rgba(255, 255, 255, 0.15);
			color: #fff;
			cursor: pointer;
		}
		.lightbox-nav:hover {
			background-color: rgba(255, 255, 255, 0.25);
		}
		.lightbox-nav-prev {
			left: 12px;
		}
		.lightbox-nav-next {
			right: 12px;
		}
		.detail-section-title {
			margin: 4px 0 8px;
			font-size: 0.8125rem;
			font-weight: 600;
			color: var(--md-sys-color-on-surface-variant);
		}
		.detail-grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 16px 12px;
			margin-bottom: 20px;
		}
		.detail-grid-cell {
			min-width: 0;
		}
		.detail-sync-btn {
			display: block;
			margin-top: 4px;
			padding: 2px 0;
			height: auto;
		}
		.detail-category-dot {
			width: 8px;
			height: 8px;
			border-radius: 50%;
			flex-shrink: 0;
		}
		.detail-description {
			margin-bottom: 8px;
		}
		.detail-photos {
			margin-bottom: 8px;
		}
		.detail-label {
			margin: 0 0 3px;
			font-size: 0.8125rem;
			font-weight: 600;
			color: var(--md-sys-color-on-surface-variant);
		}
		.detail-value {
			margin: 0;
			font-size: 1rem;
			color: var(--md-sys-color-on-surface);
		}
		.detail-value.mono {
			font-family: 'Roboto Mono', monospace;
		}
		.detail-value.sku-value {
			display: inline-flex;
			align-items: center;
			padding: 2px 8px;
			border-radius: 6px;
			background-color: var(--md-sys-color-surface-variant);
			font-family: 'Roboto Mono', monospace;
			font-weight: 600;
			letter-spacing: 0.03em;
		}
		.detail-value.category-value {
			display: flex;
			align-items: center;
			gap: 6px;
		}
		.detail-value-description {
			margin: 0;
			font-size: 1rem;
			line-height: 1.55;
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
			/* vh is the full screen height and does not shrink when the on-screen
			   keyboard opens on many mobile browsers -- a modal full of text
			   inputs (this one) could then be sized taller than what's actually
			   visible above the keyboard, pushing its own Cancel/Save buttons
			   out of reach. dvh (dynamic viewport height) accounts for the
			   keyboard on browsers that support it; vh is kept first as a
			   fallback for older browsers that don't understand dvh, since an
			   unsupported value is simply ignored, leaving the vh one in effect. */
			max-height: 90vh;
			max-height: 90dvh;
			overflow-y: auto;
		}
		/* The edit/create form specifically: title stays pinned at the top and
		   Cancel/Save stays pinned at the bottom, with only the fields between
		   them scrolling -- so the save action never requires scrolling down to
		   reach, however long the form gets (more photos, a long description).
		   Camera/scanner/delete-confirm keep the simpler default .modal-content
		   behavior above (they're short and don't need a pinned footer). */
		.modal-content--form {
			display: flex;
			flex-direction: column;
			padding: 20px 0 0;
			overflow: hidden;
		}
		.modal-content--form .modal-title-row {
			flex-shrink: 0;
			padding: 0 20px;
		}
		.modal-form {
			display: flex;
			flex-direction: column;
			flex-grow: 1;
			min-height: 0;
		}
		.modal-scroll-body {
			flex-grow: 1;
			overflow-y: auto;
			padding: 0 20px;
		}
		.modal-content--form .modal-actions {
			flex-shrink: 0;
			margin-top: 0;
			padding: 14px 20px calc(16px + env(safe-area-inset-bottom));
			border-top: 1px solid var(--md-sys-color-outline-variant);
		}
		.modal-title-row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			margin-bottom: 16px;
		}
		.modal-title-row .modal-header {
			margin-bottom: 0;
		}
		.modal-header {
			font-size: 1.375rem;
			font-weight: 600;
			margin-bottom: 16px;
		}
		.form-row {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 12px;
			margin-bottom: 18px;
		}
		.form-row .form-field {
			margin-bottom: 0;
		}
		.form-field {
			margin-bottom: 18px;
		}
		.form-field label,
		.form-field-label {
			display: block;
			font-size: 0.8125rem;
			font-weight: 600;
			color: var(--md-sys-color-on-surface-variant);
			margin-bottom: 6px;
		}
		.input-container {
			position: relative;
			display: flex;
			align-items: center;
			gap: 4px;
			background-color: var(--md-sys-color-surface-variant);
			border: 1.5px solid transparent;
			border-radius: 12px;
			padding-right: 4px;
			transition: border-color 150ms ease;
		}
		.input-container:focus-within {
			border-color: var(--md-sys-color-primary);
		}
		.input-container input {
			background: none !important;
			border: none !important;
		}
		.form-field input[type='text'],
		.form-field textarea,
		.form-field select {
			background-color: var(--md-sys-color-surface-variant);
			border: 1.5px solid transparent;
			border-radius: 12px;
			padding: 12px 14px;
			font-family: inherit;
			font-size: 1rem;
			color: var(--md-sys-color-on-surface);
			width: 100%;
			box-sizing: border-box;
			transition:
				border-color 150ms ease,
				background-color 150ms ease;
		}
		.form-field input[type='text']:focus,
		.form-field textarea:focus,
		.form-field select:focus {
			outline: none;
			border-color: var(--md-sys-color-primary);
			background-color: var(--md-sys-color-surface);
		}
		.form-field input[readonly] {
			font-family: 'Roboto Mono', monospace;
			color: var(--md-sys-color-on-surface-variant);
			background-color: var(--md-sys-color-surface);
			border-style: dashed;
			border-color: var(--md-sys-color-outline-variant);
		}
		.form-field select {
			appearance: none;
			-webkit-appearance: none;
			background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23625b71' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
			background-repeat: no-repeat;
			background-position: right 12px center;
			background-size: 20px;
			padding-right: 38px;
		}
		.form-field textarea {
			resize: vertical;
		}
		.switch-field {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 8px 2px 18px;
		}
		.switch-label {
			font-size: 0.9375rem;
			color: var(--md-sys-color-on-surface);
		}
		.switch {
			position: relative;
			display: inline-block;
			flex-shrink: 0;
			width: 44px;
			height: 26px;
			cursor: pointer;
		}
		.switch input {
			position: absolute;
			inset: 0;
			opacity: 0;
			margin: 0;
			cursor: pointer;
		}
		.switch-track {
			position: absolute;
			inset: 0;
			border-radius: 13px;
			background-color: var(--md-sys-color-outline-variant);
			transition: background-color 150ms ease;
		}
		.switch-track::before {
			content: '';
			position: absolute;
			top: 3px;
			left: 3px;
			width: 20px;
			height: 20px;
			border-radius: 50%;
			background-color: #fff;
			box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
			transition: transform 150ms ease;
		}
		.switch input:checked + .switch-track {
			background-color: var(--md-sys-color-primary);
		}
		.switch input:checked + .switch-track::before {
			transform: translateX(18px);
		}
		.switch input:focus-visible + .switch-track {
			outline: 2px solid var(--md-sys-color-primary);
			outline-offset: 2px;
		}
		.modal-actions {
			display: flex;
			justify-content: flex-end;
			gap: 8px;
			margin-top: 8px;
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
			width: 100%;
			padding: 8px 16px;
			border: none;
			background: none;
			font: inherit;
			text-align: left;
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
					<div
						class="fixed inset-0 z-10"
						role="presentation"
						onclick={() => (showMenu = false)}
					></div>
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
			<div class="filter-row">
				<div class="dropdown">
					<button
						class="filter-trigger {activeCategoryFilters.length > 0 ? 'active' : ''}"
						onclick={() => (showFilterMenu = !showFilterMenu)}
					>
						<i class="material-icons">filter_list</i>
						<span>Categories</span>
						{#if activeCategoryFilters.length > 0}
							<span class="filter-trigger-count">{activeCategoryFilters.length}</span>
						{/if}
					</button>
					{#if showFilterMenu}
						<div class="dropdown-menu filter-menu" transition:fly={{ y: -8, duration: 150 }}>
							<button class="dropdown-item filter-menu-item" onclick={clearCategoryFilters}>
								<span class="filter-menu-check {activeCategoryFilters.length === 0 ? 'checked' : ''}">
									{#if activeCategoryFilters.length === 0}
										<i class="material-icons">check</i>
									{/if}
								</span>
								<span class="filter-menu-label">All</span>
								<span class="filter-menu-count">{items.length}</span>
							</button>
							<div class="filter-menu-divider"></div>
							{#each categoryFilters as group (group.category)}
								<button
									class="dropdown-item filter-menu-item"
									onclick={() => toggleCategoryFilter(group.category)}
								>
									<span
										class="filter-menu-check {activeCategoryFilters.includes(group.category)
											? 'checked'
											: ''}"
										style="--filter-color: {group.color}"
									>
										{#if activeCategoryFilters.includes(group.category)}
											<i class="material-icons">check</i>
										{/if}
									</span>
									<span class="filter-menu-label">{group.category}</span>
									<span class="filter-menu-count">{group.items.length}</span>
								</button>
							{/each}
						</div>
						<div
						class="fixed inset-0 z-10"
						role="presentation"
						onclick={() => (showFilterMenu = false)}
					></div>
					{/if}
				</div>

				<div class="dropdown">
					<button class="filter-trigger" onclick={() => (showSortMenu = !showSortMenu)}>
						<i class="material-icons">swap_vert</i>
						<span>Sort</span>
					</button>
					{#if showSortMenu}
						<div class="dropdown-menu sort-menu" transition:fly={{ y: -8, duration: 150 }}>
							{#each sortOptions as option (option.value)}
								<button
									class="dropdown-item filter-menu-item"
									onclick={() => selectSortOption(option.value)}
								>
									<span class="filter-menu-radio {sortOption === option.value ? 'checked' : ''}"
									></span>
									<span class="filter-menu-label">{option.label}</span>
								</button>
							{/each}
						</div>
						<div
						class="fixed inset-0 z-10"
						role="presentation"
						onclick={() => (showSortMenu = false)}
					></div>
					{/if}
				</div>
			</div>

			{#if filteredItems.length === 0}
				<div class="empty-state">
					<i class="material-icons empty-state-icon">filter_alt_off</i>
					<p class="empty-state-title">No items match these filters</p>
					<p class="empty-state-hint">Try selecting different categories.</p>
				</div>
			{:else}
				<div class="items-list">
					{#each filteredItems as item (item.id)}
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
									<span
										class="item-card-category-dot"
										style="background-color: {categoryColor(item.category || 'Uncategorized')}"
									></span>
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
			{/if}
		{/if}
	</main>

	{#if viewingItem}
		<div
			class="detail-backdrop"
			style="background-color: rgba(0, 0, 0, {Math.max(0, 0.5 - sheetDragY / 400)});"
			transition:fade={{ duration: 150 }}
			onclick={closeDetail}
		>
			<div
				bind:this={detailBackdrop}
				class="detail-sheet"
				role="dialog"
				aria-label="{viewingItem.name} details"
				tabindex="-1"
				onkeydown={(e) => {
					if (e.key === 'Escape') closeDetail();
				}}
				onclick={(e) => e.stopPropagation()}
				transition:fly={{ y: 400, duration: 220 }}
			>
				<div
					class="detail-sheet-inner"
					style="transform: translateY({sheetDragY}px); transition: {sheetDragging
						? 'none'
						: 'transform 200ms ease'};"
				>
					<div
						class="detail-sheet-handle"
						onpointerdown={onSheetDragStart}
						onpointermove={onSheetDragMove}
						onpointerup={onSheetDragEnd}
						onpointercancel={onSheetDragEnd}
					></div>
					<div
						class="detail-header"
						onpointerdown={onSheetDragStart}
						onpointermove={onSheetDragMove}
						onpointerup={onSheetDragEnd}
						onpointercancel={onSheetDragEnd}
					>
						<button class="btn-icon" onclick={closeDetail} aria-label="Back to list">
							<i class="material-icons">arrow_back</i>
						</button>
						<h2>{viewingItem.name}</h2>
						<button
							class="btn-icon"
							onclick={() => viewingItem && editFromDetail(viewingItem)}
							aria-label="Edit Item"
						>
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
					<button class="detail-hero" onclick={() => openLightbox(0)} aria-label="View photo">
						<img
							class="detail-hero-image"
							src={photoSrc(viewingItem.photos, viewingItem.photoUrls, 0)}
							alt={viewingItem.name}
						/>
					</button>
				{/if}

				<p class="detail-section-title">Details</p>
				<div class="detail-grid">
					<div class="detail-grid-cell">
						<p class="detail-label">SKU</p>
						<p class="detail-value sku-value">{viewingItem.sku || 'No SKU'}</p>
					</div>
					<div class="detail-grid-cell">
						<p class="detail-label">Category</p>
						<p class="detail-value category-value">
							<span
								class="detail-category-dot"
								style="background-color: {categoryColor(viewingItem.category || 'Uncategorized')}"
							></span>
							{viewingItem.category || 'Uncategorized'}
						</p>
					</div>
					<div class="detail-grid-cell">
						<p class="detail-label">Status</p>
						<span class="status-chip {viewingItem.is_active ? 'active' : 'inactive'}"
							>{viewingItem.is_active ? 'Active' : 'Inactive'}</span
						>
					</div>
					<div class="detail-grid-cell">
						<p class="detail-label">Sync</p>
						<span class="status-chip {viewingItem.syncStatus ?? 'pending'}"
							>{viewingItem.syncStatus ?? 'pending'}</span
						>
						{#if viewingItem.syncStatus === 'pending' || viewingItem.syncStatus === 'error'}
							<button
								class="btn btn-text detail-sync-btn"
								onclick={() => viewingItem && syncItem(viewingItem)}
							>
								Sync now
							</button>
						{/if}
					</div>
					{#if viewingItem.barcode}
						<div class="detail-grid-cell">
							<p class="detail-label">Barcode</p>
							<p class="detail-value mono">{viewingItem.barcode}</p>
						</div>
					{/if}
				</div>

				{#if viewingItem.description}
					<div class="detail-description">
						<p class="detail-label">Description</p>
						<p class="detail-value-description">{viewingItem.description}</p>
					</div>
				{/if}

				{#if viewingItem.photos && viewingItem.photos.length > 0}
					<div class="detail-photos">
						<p class="detail-section-title">Photos</p>
						<div class="photo-gallery">
							{#each viewingItem.photos as photo, i}
								<div
									class="thumbnail"
									role="button"
									tabindex="0"
									onclick={() => openLightbox(i)}
									onkeydown={(e) => {
										if (e.key === 'Enter' || e.key === ' ') openLightbox(i);
									}}
								>
									<img
										src={photoSrc(viewingItem.photos, viewingItem.photoUrls, i)}
										alt="{viewingItem.name} preview {i + 1}"
									/>
									<button
										class="btn-icon"
										style="position:absolute; bottom:0; right:0; background:rgba(0,0,0,0.5);"
										onclick={(e) => {
											e.stopPropagation();
											if (viewingItem) {
												downloadPhoto(
													photoSrc(viewingItem.photos, viewingItem.photoUrls, i),
													viewingItem.sku,
													i
												);
											}
										}}
									>
										<i class="material-icons" style="color:white; font-size:16px;">download</i>
									</button>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>
			</div>
		</div>
	</div>
	{/if}

	{#if lightboxIndex !== null && viewingItem}
		<div
			bind:this={lightboxBackdrop}
			class="lightbox"
			role="dialog"
			aria-label="Photo viewer"
			tabindex="-1"
			onclick={closeLightbox}
			onkeydown={(e) => {
				if (e.key === 'Escape') closeLightbox();
				else if (e.key === 'ArrowRight') nextPhoto();
				else if (e.key === 'ArrowLeft') prevPhoto();
			}}
			transition:fade={{ duration: 150 }}
		>
			<div class="lightbox-topbar">
				<span class="lightbox-count">{lightboxIndex + 1} / {viewingItem.photos.length}</span>
				<div class="lightbox-actions">
					<button
						class="btn-icon lightbox-btn"
						aria-label="Download photo"
						onclick={(e) => {
							e.stopPropagation();
							if (viewingItem && lightboxIndex !== null) {
								downloadPhoto(
									photoSrc(viewingItem.photos, viewingItem.photoUrls, lightboxIndex),
									viewingItem.sku,
									lightboxIndex
								);
							}
						}}
					>
						<i class="material-icons">download</i>
					</button>
					<button class="btn-icon lightbox-btn" onclick={closeLightbox} aria-label="Close">
						<i class="material-icons">close</i>
					</button>
				</div>
			</div>

			<div
				class="lightbox-image-wrap"
				style="transform: translateY({lightboxDragY}px); opacity: {Math.max(
					0.3,
					1 - lightboxDragY / 400
				)}; transition: {lightboxDragging ? 'none' : 'transform 200ms ease, opacity 200ms ease'};"
				onclick={(e) => e.stopPropagation()}
				onpointerdown={onLightboxPointerDown}
				onpointermove={onLightboxPointerMove}
				onpointerup={onLightboxPointerUp}
			>
				<img
					class="lightbox-image"
					src={photoSrc(viewingItem.photos, viewingItem.photoUrls, lightboxIndex)}
					alt="{viewingItem.name} preview {lightboxIndex + 1}"
				/>
			</div>

			{#if viewingItem.photos.length > 1}
				<button
					class="lightbox-nav lightbox-nav-prev"
					onclick={(e) => {
						e.stopPropagation();
						prevPhoto();
					}}
					aria-label="Previous photo"
				>
					<i class="material-icons">chevron_left</i>
				</button>
				<button
					class="lightbox-nav lightbox-nav-next"
					onclick={(e) => {
						e.stopPropagation();
						nextPhoto();
					}}
					aria-label="Next photo"
				>
					<i class="material-icons">chevron_right</i>
				</button>
			{/if}
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
			<div class="modal-content {!showCamera && !showScanner ? 'modal-content--form' : ''}">
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
					<div class="modal-title-row">
						<h2 class="modal-header" in:fly={{ y: 16, duration: 200 }}>
							{formMode === 'create' ? 'Add New Item' : 'Edit Item'}
						</h2>
						<button type="button" class="btn-icon" onclick={handleCancel} aria-label="Close">
							<i class="material-icons">close</i>
						</button>
					</div>
					<form onsubmit={handleSubmit} class="modal-form">
						<div class="modal-scroll-body">
							<div
								class="detail-hero"
								style={formData.photos.length
									? ''
									: `background-color: ${categoryColor(formData.category || 'Uncategorized')}22;`}
							>
								<div class="dropdown form-hero-dropdown">
									<button
										type="button"
										class="form-hero-trigger"
										onclick={() => (showPhotoSourceMenu = !showPhotoSourceMenu)}
										aria-label={formData.photos.length ? 'Change photo' : 'Add a photo'}
									>
										{#if formData.photos.length > 0}
											<img
												class="detail-hero-image"
												src={photoSrc(formData.photos, formData.photoUrls, 0)}
												alt={formData.name || 'Item preview'}
											/>
										{:else}
											<div
												class="detail-hero-placeholder form-hero-placeholder"
												style="color: {categoryColor(formData.category || 'Uncategorized')};"
											>
												<i class="material-icons">add_a_photo</i>
												<span>No photo yet — tap to add</span>
											</div>
										{/if}
									</button>
									{#if showPhotoSourceMenu}
										<div
											class="dropdown-menu form-hero-menu"
											transition:fly={{ y: -8, duration: 150 }}
										>
											<button
												type="button"
												class="dropdown-item"
												onclick={() => {
													showPhotoSourceMenu = false;
													startCamera();
												}}
											>
												<i class="material-icons">photo_camera</i>
												<span>Take Photo</span>
											</button>
											<label for="photo-upload" class="dropdown-item">
												<i class="material-icons">photo_library</i>
												<span>Choose from Gallery</span>
											</label>
										</div>
										<div
											class="fixed inset-0 z-10"
											role="presentation"
											onclick={() => (showPhotoSourceMenu = false)}
										></div>
									{/if}
								</div>
							</div>

							<p class="detail-section-title">Details</p>
							<div class="form-row">
								<div class="form-field">
									<label for="category" class="form-label-with-dot">
										<span
											class="detail-category-dot"
											style="background-color: {categoryColor(
												formData.category || 'Uncategorized'
											)}"
										></span>
										Category
									</label>
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
								<label for="barcode">Barcode</label>
								<div class="input-container">
									<input type="text" id="barcode" bind:value={formData.barcode} />
									<button
										type="button"
										onclick={startBarcodeScanner}
										class="btn-icon"
										aria-label="Scan Barcode"
										><i class="material-icons">qr_code_scanner</i></button
									>
								</div>
							</div>

							{#if formData.photos.length > 0}
								<p class="detail-section-title">Photos</p>
								<div class="form-field">
									<div class="photo-gallery photo-gallery-compact">
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
								</div>
							{/if}
							<input
								type="file"
								id="photo-upload"
								accept="image/*"
								onchange={handleFileSelect}
								style="display: none;"
								multiple
							/>

							<p class="detail-section-title">Status</p>
							<div class="switch-field">
								<label for="is_active" class="switch-label">Item is Active</label>
								<label class="switch">
									<input type="checkbox" id="is_active" bind:checked={formData.is_active} />
									<span class="switch-track"></span>
								</label>
							</div>
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
