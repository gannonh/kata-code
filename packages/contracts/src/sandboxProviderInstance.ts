/**
 * Sandbox provider-instance contracts.
 *
 * The deploy-model analogue of {@link providerInstance}. A deployment target
 * (an isolated container locally, or a bring-your-own cloud sandbox later) is
 * configured as an entry in `ServerSettings.sandboxProviderInstances`, keyed by
 * a user-defined `SandboxProviderInstanceId`, carrying a `SandboxProviderDriverKind`
 * slug that selects which `SandboxProviderDriver` package handles it, plus an
 * opaque driver-specific `config` payload each driver owns.
 *
 * Why this lives in `packages/contracts` (not `packages/sandbox-contracts`)
 * -----------------------------------------------------------------------
 * `packages/contracts/src/settings.ts` references these schemas for the
 * `sandboxProviderInstances` field. Defining them in `packages/sandbox-contracts`
 * would force `packages/contracts` to depend on `packages/sandbox-contracts`,
 * which depends back on `packages/contracts` — a cycle. `packages/contracts` is
 * a dependency leaf (only `effect`), and keeping it that way is a locked Phase 1
 * decision. `packages/sandbox-contracts` re-exports these so every later phase
 * keeps a single sandbox import surface (`@kata-sh/code-sandbox-contracts`).
 *
 * Forward/backward compatibility invariant
 * ----------------------------------------
 * `SandboxProviderDriverKind` is an **open** branded slug, not a closed literal
 * union, for the same reasons as `ProviderDriverKind`: the server hosts forks,
 * ships in PRs that add drivers, and users roll between branches. Any of those
 * paths can leave `ServerSettings` referencing a driver the running build does
 * not know about. Parsing those payloads must always succeed; the runtime
 * registry (`SandboxProviderRegistry`) marks the instance "unavailable" rather
 * than crashing. Driver availability is a runtime concern, not a contract-layer
 * concern.
 *
 * `SandboxProvider*` uses **distinct brand strings** from `Provider*`
 * (`"SandboxProviderDriverKind"`, `"SandboxProviderInstanceId"`) so the two
 * type systems cannot be confused even though they share slug rules.
 *
 * @module sandboxProviderInstance
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceEnvironment } from "./providerInstance.ts";

const SANDBOX_SLUG_MAX_CHARS = 64;
/**
 * Slug pattern shared by sandbox driver kinds and instance ids — identical to
 * the provider-instance slug rules: letters, digits, dashes, underscores, first
 * char a letter (JS-identifier friendly as object keys / log fields).
 */
const SANDBOX_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

const sandboxSlugSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(SANDBOX_SLUG_MAX_CHARS),
  Schema.isPattern(SANDBOX_SLUG_PATTERN),
);

/**
 * `SandboxProviderDriverKind` — open branded slug naming a sandbox driver
 * implementation (`docker`, a future `cloudflare`, …).
 *
 * Constraints (validated at the schema layer):
 *   - starts with a letter
 *   - only letters, digits, `-`, `_` after the first char
 *   - 1..64 characters
 *
 * Not validated here: that the driver is one the running build can load. That
 * check belongs to `SandboxProviderRegistry`, which downgrades unknown drivers
 * gracefully (see module docs).
 */
export const SandboxProviderDriverKind = sandboxSlugSchema.pipe(
  Schema.brand("SandboxProviderDriverKind"),
);
export type SandboxProviderDriverKind = typeof SandboxProviderDriverKind.Type;

const isSandboxProviderDriverKindValue = Schema.is(SandboxProviderDriverKind);
export const isSandboxProviderDriverKind = (value: unknown): value is SandboxProviderDriverKind =>
  isSandboxProviderDriverKindValue(value);

/**
 * `SandboxProviderInstanceId` — user-defined routing key for a configured
 * sandbox deployment target. Same slug rules as `SandboxProviderDriverKind`;
 * branded separately so the type system cannot confuse driver kind and
 * instance id, nor confuse them with the provider-instance equivalents.
 */
export const SandboxProviderInstanceId = sandboxSlugSchema.pipe(
  Schema.brand("SandboxProviderInstanceId"),
);
export type SandboxProviderInstanceId = typeof SandboxProviderInstanceId.Type;

/**
 * Envelope shape for a sandbox deployment target in `ServerSettings.sandboxProviderInstances`.
 *
 * Mirrors `ProviderInstanceConfig`: `driver` is any well-formed slug (see module
 * docs); the driver-specific config payload is `Schema.Unknown` so each driver
 * owns its own decoder and unknown-driver envelopes round-trip verbatim across
 * version changes. `environment` reuses the **same** `ProviderInstanceEnvironment`
 * shape (in-package import) so the existing `ServerSecretStore` redaction path
 * applies unchanged once a later phase generalizes it to also walk the sandbox
 * map — no second redaction contract.
 */
export const SandboxProviderInstanceConfig = Schema.Struct({
  driver: SandboxProviderDriverKind,
  displayName: Schema.optional(TrimmedNonEmptyString),
  environment: Schema.optionalKey(ProviderInstanceEnvironment),
  enabled: Schema.optionalKey(Schema.Boolean),
  config: Schema.optionalKey(Schema.Unknown),
});
export type SandboxProviderInstanceConfig = typeof SandboxProviderInstanceConfig.Type;

/**
 * Map shape for `ServerSettings.sandboxProviderInstances`. Keyed by
 * `SandboxProviderInstanceId`, values are envelopes the registry feeds to
 * drivers.
 */
export const SandboxProviderInstanceConfigMap = Schema.Record(
  SandboxProviderInstanceId,
  SandboxProviderInstanceConfig,
);
export type SandboxProviderInstanceConfigMap = typeof SandboxProviderInstanceConfigMap.Type;

/**
 * Construct the canonical `SandboxProviderInstanceId` used as a back-compat
 * default for a built-in driver — mirrors `defaultInstanceIdForDriver` but for
 * the sandbox axis. Named distinctly so the two helpers coexist.
 */
export const defaultInstanceIdForSandboxDriver = (
  driver: SandboxProviderDriverKind,
): SandboxProviderInstanceId => SandboxProviderInstanceId.make(driver);
