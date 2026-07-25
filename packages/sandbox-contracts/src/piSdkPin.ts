/**
 * Exact Pi SDK version shared by the server dependency pins, Vercel bootstrap
 * install, Docker image build args, and update-verification scripts.
 *
 * Owned here (driver-neutral) so scripts and driver packages import one source
 * without cross-package `@ts-ignore` paths into a single driver's module.
 *
 * @module piSdkPin
 */

/** Exact `@earendil-works/pi-*` version string (no range). */
export const PI_SDK_PIN = "0.82.1";
