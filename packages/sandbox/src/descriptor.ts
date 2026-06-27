/**
 * `SandboxProviderDescriptor` — what `SandboxProviderDriver.describe()` returns.
 * Advertises capabilities, reachability kind, and limits. Capability flags are
 * `true` only when **all** of a capability's methods are present (asserted in
 * tests: `supportsSnapshot === createSnapshot && deleteSnapshot &&
 * snapshotExists`).
 *
 * @module descriptor
 */
import * as Schema from "effect/Schema";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";

export const SandboxProviderDescriptor = Schema.Struct({
  kind: SandboxProviderDriverKind,
  reachabilityKind: SandboxReachabilityKind,
  maxLifetimeMs: Schema.optional(Schema.Number),
  supportsSnapshot: Schema.Boolean,
  supportsRenewTimeout: Schema.Boolean,
  baseImages: Schema.optional(Schema.Array(Schema.String)),
});
export type SandboxProviderDescriptor = typeof SandboxProviderDescriptor.Type;
