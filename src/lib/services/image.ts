// Client-side image compression for captured/uploaded photos. Keeps synced
// items well under Convex's 1MiB document limit (before file storage, a single
// uncompressed camera photo could exceed it on its own) and shrinks local
// IndexedDB usage for photos still pending upload.

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.75;

/** Pure scaling math (no DOM), kept separate so it's unit-testable. */
export function scaledDimensions(
	width: number,
	height: number,
	maxDimension: number
): { width: number; height: number } {
	const scale = Math.min(1, maxDimension / Math.max(width, height));
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Downscale + re-encode an image data URL as JPEG. Browser-only (Image/canvas). */
export function compressImage(
	dataUrl: string,
	maxDimension = MAX_DIMENSION,
	quality = JPEG_QUALITY
): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const { width, height } = scaledDimensions(img.naturalWidth, img.naturalHeight, maxDimension);
			const canvas = document.createElement('canvas');
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext('2d');
			if (!ctx) return reject(new Error('Canvas 2D context unavailable'));
			ctx.drawImage(img, 0, 0, width, height);
			resolve(canvas.toDataURL('image/jpeg', quality));
		};
		img.onerror = () => reject(new Error('Failed to load image for compression'));
		img.src = dataUrl;
	});
}
