// SCAT/SCAB source-tagging cutover.
//
// Items created before the cutover instant are tagged "SCAT"; items created
// on/after it are tagged "SCAB". The cutover is a fixed point in time, not a
// recurring rule, so it's a plain constant rather than something derived.
//
// Kept as a pure function of `now` (rather than reading Date.now() directly)
// so it's trivially unit-testable across the boundary without mocking the
// system clock.

export const SOURCE_CUTOVER_ISO = '2026-09-02T00:00:00.000Z';
const SOURCE_CUTOVER_MS = Date.parse(SOURCE_CUTOVER_ISO);

export const SCAT = 'SCAT';
export const SCAB = 'SCAB';

/**
 * Returns the source tag for an item created at `now`.
 * Before the cutover → SCAT. On or after the cutover → SCAB.
 */
export function sourceForCreationTime(now: Date | number = Date.now()): string {
	const nowMs = typeof now === 'number' ? now : now.getTime();
	return nowMs < SOURCE_CUTOVER_MS ? SCAT : SCAB;
}
