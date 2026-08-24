import { describe, it, expect } from 'vitest';
import { sourceForCreationTime, SOURCE_CUTOVER_ISO, SCAT, SCAB } from './source';

describe('sourceForCreationTime', () => {
	const cutoverMs = Date.parse(SOURCE_CUTOVER_ISO);

	it('tags items created well before the cutover as SCAT', () => {
		const oneYearBefore = new Date(cutoverMs - 365 * 24 * 60 * 60 * 1000);
		expect(sourceForCreationTime(oneYearBefore)).toBe(SCAT);
	});

	it('tags items created well after the cutover as SCAB', () => {
		const oneYearAfter = new Date(cutoverMs + 365 * 24 * 60 * 60 * 1000);
		expect(sourceForCreationTime(oneYearAfter)).toBe(SCAB);
	});

	it('tags items created 1ms before the cutover as SCAT', () => {
		expect(sourceForCreationTime(new Date(cutoverMs - 1))).toBe(SCAT);
	});

	it('tags items created exactly at the cutover instant as SCAB', () => {
		expect(sourceForCreationTime(new Date(cutoverMs))).toBe(SCAB);
	});

	it('tags items created 1ms after the cutover as SCAB', () => {
		expect(sourceForCreationTime(new Date(cutoverMs + 1))).toBe(SCAB);
	});

	it('accepts a raw epoch-ms number as well as a Date', () => {
		expect(sourceForCreationTime(cutoverMs - 1)).toBe(SCAT);
		expect(sourceForCreationTime(cutoverMs)).toBe(SCAB);
	});

	it('cutover is midnight Pacific Daylight Time (UTC-7) on Sept 2 2026, not UTC midnight', () => {
		// 2026-09-02T00:00:00 PDT == 2026-09-02T07:00:00Z
		expect(sourceForCreationTime(new Date('2026-09-02T06:59:59.999Z'))).toBe(SCAT);
		expect(sourceForCreationTime(new Date('2026-09-02T07:00:00.000Z'))).toBe(SCAB);
		// Sanity check: UTC midnight itself is still SCAT (7 hours early in Pacific time)
		expect(sourceForCreationTime(new Date('2026-09-02T00:00:00.000Z'))).toBe(SCAT);
	});
});
