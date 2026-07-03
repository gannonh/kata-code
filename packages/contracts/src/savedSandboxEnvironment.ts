/**
 * Saved per-repo sandbox environment contracts.
 *
 * The Phase 2 saved-environment editor authors a per-repo environment config
 * persisted in `ServerSettings.savedSandboxEnvironments`, keyed by
 * `RepositoryCanonicalKey` (derived from `RepositoryIdentity.canonicalKey`).
 * It carries the install/start/terminals a user edits, a stored
 * `networkAccess` preference (no enforcement engine in Phase 2), and secrets
 * via `ProviderInstanceEnvironment` so the existing `ServerSecretStore`
 * redaction path applies unchanged.
 *
 * Why this lives in `packages/contracts` (not `packages/sandbox-contracts`)
 * -----------------------------------------------------------------------
 * `packages/contracts/src/settings.ts` references these schemas for the
 * `savedSandboxEnvironments` field. Defining them in `packages/sandbox-contracts`
 * would force `packages/contracts` to depend on `packages/sandbox-contracts`,
 * which depends back on `packages/contracts` — a cycle. `packages/contracts`
 * is a dependency leaf (only `effect`), and keeping it that way is a locked
 * Phase 1 decision. `packages/sandbox-contracts` re-exports these so every
 * later phase keeps a single sandbox import surface
 * (`@kata-sh/code-sandbox-contracts`).
 *
 * `RepositoryIdentity.canonicalKey` (`packages/contracts/src/environment.ts`)
 * is a `TrimmedNonEmptyString`. `RepositoryCanonicalKey` brands the same
 * `TrimmedNonEmptyString` with a distinct brand string so the saved-env map
 * cannot be keyed by an arbitrary string, and so it is distinct from other
 * branded slugs (`SandboxProviderInstanceId`, `ProviderInstanceId`).
 *
 * `EnvironmentTerminal` lives in `packages/sandbox-contracts`, which contracts
 * cannot import (cycle). The terminal shape is inlined here as
 * `SavedEnvironmentTerminal`, structurally matching `EnvironmentTerminal`, so
 * `packages/contracts` stays a dependency leaf.
 *
 * @module savedSandboxEnvironment
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceEnvironment } from "./providerInstance.ts";

/**
 * Branded key for the `savedSandboxEnvironments` map. Distinct brand string
 * from `SandboxProviderInstanceId`/`ProviderInstanceId` so the map cannot be
 * keyed by an arbitrary string or confused with the instance-id maps. Derived
 * from `RepositoryIdentity.canonicalKey` (a `TrimmedNonEmptyString`).
 */
export const RepositoryCanonicalKey = TrimmedNonEmptyString.pipe(
  Schema.brand("RepositoryCanonicalKey"),
);
export type RepositoryCanonicalKey = typeof RepositoryCanonicalKey.Type;

/**
 * A named long-lived process a user configures for a saved environment.
 * Structurally matches `EnvironmentTerminal` in `packages/sandbox-contracts`;
 * inlined here so `packages/contracts` stays a dependency leaf (see module docs).
 */
export const SavedEnvironmentTerminal = Schema.Struct({
  name: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
});
export type SavedEnvironmentTerminal = typeof SavedEnvironmentTerminal.Type;

/**
 * Saved per-repo environment authored by the Phase 2 saved-environment editor.
 * Secrets never live in the repo `.kata/environment.json`; the `environment`
 * field reuses `ProviderInstanceEnvironment` so the existing redaction path
 * applies. `networkAccess` is a stored preference only (no enforcement engine
 * in Phase 2).
 */
export const SavedSandboxEnvironment = Schema.Struct({
  install: Schema.optionalKey(TrimmedNonEmptyString),
  start: Schema.optionalKey(TrimmedNonEmptyString),
  terminals: Schema.optionalKey(Schema.Array(SavedEnvironmentTerminal)),
  networkAccess: Schema.optionalKey(TrimmedNonEmptyString),
  environment: Schema.optionalKey(ProviderInstanceEnvironment),
});
export type SavedSandboxEnvironment = typeof SavedSandboxEnvironment.Type;

/**
 * Map shape for `ServerSettings.savedSandboxEnvironments`. Keyed by
 * `RepositoryCanonicalKey`, values are saved environments the loader resolves
 * against the repo file and provider default.
 */
export const SavedSandboxEnvironmentMap = Schema.Record(
  RepositoryCanonicalKey,
  SavedSandboxEnvironment,
);
export type SavedSandboxEnvironmentMap = typeof SavedSandboxEnvironmentMap.Type;
