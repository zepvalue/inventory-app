import { describe, it, expect } from 'vitest';
import { scaledDimensions } from './image';

describe('scaledDimensions', () => {
	it('leaves images already within the max dimension untouched', () => {
		expect(scaledDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 });
	});

	it('downscales a landscape image so the long edge hits the max', () => {
		expect(scaledDimensions(3200, 2400, 1600)).toEqual({ width: 1600, height: 1200 });
	});

	it('downscales a portrait image so the long edge hits the max', () => {
		expect(scaledDimensions(2400, 3200, 1600)).toEqual({ width: 1200, height: 1600 });
	});

	it('never upscales a smaller image', () => {
		expect(scaledDimensions(400, 300, 1600)).toEqual({ width: 400, height: 300 });
	});
});
