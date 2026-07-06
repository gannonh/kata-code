/**
 * Test-only stub `SandboxProvider`. Implements the full required SPI plus a
 * configurable subset of optional capabilities, used to test the registry and
 * the `describe()` capability-presence logic.
 *
 * **NOT in `package.json#exports`** — lives under `src/testing/` and is imported
 * only via a relative path from co-located tests. Keeping it out of `exports`
 * is what actually prevents accidental production registration.
 *
 * @module stubDriver
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";

import {
  type SandboxCopyIntoCapability,
  type SandboxExecResult,
  type SandboxHandle,
  type SandboxProvisionRequest,
  type SandboxReachability,
  type SandboxProvider,
  type SandboxResumeCapability,
  type SandboxSnapshotCapability,
  type SandboxRenewTimeoutCapability,
  SandboxProviderError,
} from "../SandboxProviderDriver.ts";
import type { SandboxProviderDescriptor } from "../descriptor.ts";

/** Config the stub decodes — a minimal struct used to exercise `invalid-config`. */
export const StubSandboxConfig = Schema.Struct({
  image: Schema.optional(Schema.String),
  failValidate: Schema.optional(Schema.Boolean),
});
export type StubSandboxConfig = typeof StubSandboxConfig.Type;

// Hoist compiled schema function to module scope (kata-code/no-inline-schema-compile).
const decodeStubConfig = Schema.decodeUnknownSync(StubSandboxConfig);

export interface StubDriverOptions {
  readonly withSnapshot?: boolean;
  readonly withRenewTimeout?: boolean;
  readonly withCopyInto?: boolean;
  readonly withResume?: boolean;
}

/**
 * Build a stub driver. `withSnapshot`/`withRenewTimeout` toggle the optional
 * capabilities so tests can assert `describe()` flags match method presence
 * across a variant with and without the capability.
 */
export function createStubSandboxProvider(options: StubDriverOptions = {}): SandboxProvider {
  const kind = SandboxProviderDriverKind.make("stub");

  const snapshot: SandboxSnapshotCapability | undefined = options.withSnapshot
    ? {
        createSnapshot: () => Effect.succeed({ snapshotId: "stub-snapshot" }),
        deleteSnapshot: () => Effect.void,
        snapshotExists: () => Effect.succeed(true),
      }
    : undefined;

  const renewTimeout: SandboxRenewTimeoutCapability | undefined = options.withRenewTimeout
    ? { renewTimeout: () => Effect.void }
    : undefined;

  const copyInto: SandboxCopyIntoCapability | undefined = options.withCopyInto
    ? { copyInto: () => Effect.void }
    : undefined;

  const resume: SandboxResumeCapability | undefined = options.withResume
    ? { resume: (handle) => Effect.succeed(handle) }
    : undefined;

  const descriptor: SandboxProviderDescriptor = {
    kind,
    reachabilityKind: SandboxReachabilityKind.make("loopback"),
    supportsSnapshot: options.withSnapshot === true,
    supportsRenewTimeout: options.withRenewTimeout === true,
    supportsCopyInto: options.withCopyInto === true,
    supportsResume: options.withResume === true,
  };

  return {
    kind,
    validate: (config) =>
      Effect.gen(function* () {
        // Decode against StubSandboxConfig so malformed configs trigger the
        // SPI's invalid-config path (the registry surfaces this as an
        // unavailable instance). The stub's `validate` is a no-op otherwise.
        const decoded = yield* Effect.try({
          try: () => decodeStubConfig(config),
          catch: (e) =>
            new SandboxProviderError({
              reason: "invalid-config",
              message: e instanceof Error ? e.message : String(e),
            }),
        });
        if (decoded.failValidate === true) {
          return yield* new SandboxProviderError({
            reason: "unreachable",
            message: "stub validate forced failure",
          });
        }
      }),
    provision: (req: SandboxProvisionRequest) =>
      Effect.succeed<SandboxHandle>({
        driverKind: kind,
        instanceId: req.instanceId,
        handle: { stub: true, image: req.image },
      }),
    exec: (): Effect.Effect<SandboxExecResult, SandboxProviderError> =>
      Effect.succeed({ exitCode: 0, stdout: "stub", stderr: "" }),
    reachability: (_handle, port): Effect.Effect<SandboxReachability, SandboxProviderError> =>
      Effect.succeed({
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        httpBaseUrl: `http://localhost:${port}`,
        wsBaseUrl: `ws://localhost:${port}`,
      }),
    dispose: () => Effect.void,
    describe: () => Effect.succeed(descriptor),
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(renewTimeout !== undefined ? { renewTimeout } : {}),
    ...(copyInto !== undefined ? { copyInto } : {}),
    ...(resume !== undefined ? { resume } : {}),
  };
}
