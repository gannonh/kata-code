/**
 * Re-exports the settings-referenced sandbox provider-instance contracts from
 * `@kata-sh/code-contracts`.
 *
 * These are defined in `packages/contracts/src/sandboxProviderInstance.ts`
 * because `packages/contracts/src/settings.ts` references them (keeping
 * `packages/contracts` a dependency leaf and avoiding a
 * `contracts` ⇄ `sandbox-contracts` cycle). This module re-exports them so
 * every later phase has a single sandbox import surface
 * (`@kata-sh/code-sandbox-contracts/instance`).
 *
 * @module instance
 */
export * from "@kata-sh/code-contracts/sandboxProviderInstance";
