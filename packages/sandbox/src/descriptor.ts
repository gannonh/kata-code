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
  /** Phase 2: driver can copy a tar archive into a running sandbox (`copyInto`). */
  supportsCopyInto: Schema.Boolean,
  /** Driver supports durable stop/start lifecycle (`lifecycle`). */
  supportsLifecycle: Schema.Boolean,
  /**
   * Driver clones a configured GitHub `{ repository, branch }` source into the
   * sandbox workspace on create (`projectSource` capability).
   */
  supportsProjectSource: Schema.Boolean,
  baseImages: Schema.optional(Schema.Array(Schema.String)),
});
export type SandboxProviderDescriptor = typeof SandboxProviderDescriptor.Type;
