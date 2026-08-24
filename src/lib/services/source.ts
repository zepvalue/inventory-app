// Re-exports the SCAT/SCAB cutover logic from convex/source.ts so the
// frontend (e.g. the home page indicator) and the backend (item creation)
// share one definition of the cutover instant instead of two copies that
// could drift out of sync. convex/source.ts has no Convex-specific
// dependencies, so it's safe to import directly here.
export { sourceForCreationTime, SOURCE_CUTOVER_ISO, SCAT, SCAB } from '../../../convex/source';
