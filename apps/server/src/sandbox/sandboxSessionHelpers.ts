/**
 * Shared sandbox instance helpers used by SandboxService and reconcile.
 *
 * @module sandboxSessionHelpers
 */
import * as Effect from "effect/Effect";

import type { AdvertisedEndpointProvider } from "@kata-sh/code-contracts";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { SandboxInstanceSummary } from "@kata-sh/code-contracts/sandboxRpc";
import { SandboxProviderRegistry } from "@kata-sh/code-sandbox/registry";
import { DockerSandboxProvider, dockerConfigDecoder } from "@kata-sh/code-sandbox-docker";
import {
  VercelSandboxProvider,
  VERCEL_KIND,
  mergeVercelAuthIntoConfig,
  vercelConfigDecoder,
} from "@kata-sh/code-sandbox-vercel";
import type { SandboxSessionRecord } from "./sandboxSessionStore.ts";

/** A sandbox `AdvertisedEndpointProvider` (manual kind; container-sourced). */
export const SANDBOX_ENDPOINT_PROVIDER: AdvertisedEndpointProvider = {
  id: "sandbox-container",
  label: "Container",
  kind: "manual",
  isAddon: false,
};

/** A Vercel Sandbox `AdvertisedEndpointProvider` (manual kind; public-sourced). */
export const VERCEL_ENDPOINT_PROVIDER: AdvertisedEndpointProvider = {
  id: "sandbox-vercel",
  label: "Vercel Sandbox",
  kind: "manual",
  isAddon: false,
};

export function buildRegistry(): SandboxProviderRegistry {
  const registry = new SandboxProviderRegistry();
  registry.register(DockerSandboxProvider, dockerConfigDecoder);
  registry.register(VercelSandboxProvider, vercelConfigDecoder);
  return registry;
}

type Materialized = ReturnType<SandboxProviderRegistry["materializeOne"]>;

export function toSummary(
  inst: Materialized,
  storeRecord: SandboxSessionRecord | undefined,
): Effect.Effect<SandboxInstanceSummary, never> {
  if (inst.kind === "unavailable") {
    return Effect.succeed({
      kind: "unavailable",
      instanceId: inst.instanceId,
      reason: inst.reason,
      message: inst.message,
    });
  }
  return Effect.gen(function* () {
    const descriptor = yield* inst.driver.describe();
    return {
      kind: "available",
      instanceId: inst.instanceId,
      driver: descriptor.kind as string,
      reachabilityKind: descriptor.reachabilityKind,
      supportsSnapshot: descriptor.supportsSnapshot,
      supportsRenewTimeout: descriptor.supportsRenewTimeout,
      supportsLifecycle: descriptor.supportsLifecycle,
      supportsProjectSource: descriptor.supportsProjectSource,
      ...(storeRecord
        ? {
            runningSession: {
              environmentId: storeRecord.sandboxEnvironmentId as never,
              endpoint: storeRecord.endpoint as never,
              status: storeRecord.status,
              ...(storeRecord.deadlineEpochMs !== undefined
                ? { deadlineEpochMs: storeRecord.deadlineEpochMs }
                : {}),
              ...(storeRecord.statusDetail !== undefined
                ? { statusDetail: storeRecord.statusDetail }
                : {}),
            },
          }
        : {}),
    };
  });
}

/**
 * Merge materialized Vercel auth secrets into the driver config payload before
 * the registry decodes it. The trio flows through the generic `sandbox-env-*`
 * secret path (`materializeSandboxProviderEnvironmentSecrets`); the driver's
 * `validate` receives only the decoded config, so the server injects `auth`
 * here. Non-vercel envelopes pass through unchanged.
 */
export function resolveInstanceEnvelope(
  config: SandboxProviderInstanceConfig,
): SandboxProviderInstanceConfig {
  return (config.driver as string) === (VERCEL_KIND as string)
    ? mergeVercelAuthIntoConfig(config)
    : config;
}

/** Resolve the in-sandbox port the Kata server listens on from the decoded
 *  driver config (duck-typed `port` number). Falls back to 13773. */
export function resolveSandboxPort(config: unknown): number {
  if (
    config !== null &&
    typeof config === "object" &&
    typeof (config as { port?: unknown }).port === "number"
  ) {
    return (config as { port: number }).port;
  }
  return 13773;
}

/** Sanitize a driver handle for persistence: strip the Vercel auth trio
 *  (token/teamId/projectId) so no secrets are written to the store file.
 *  The auth re-resolves from instance config env on load/reconcile. */
export function sanitizeHandleForStore(driverKind: string, handleState: unknown): unknown {
  if (
    driverKind === (VERCEL_KIND as string) &&
    handleState !== null &&
    typeof handleState === "object"
  ) {
    const { auth: _auth, ...rest } = handleState as Record<string, unknown>;
    return rest;
  }
  return handleState;
}

/** Re-inject the Vercel auth trio into a stored (sanitized) handle from the
 *  resolved config. The config carries `auth` after `mergeVercelAuthIntoConfig`;
 *  the driver's lifecycle methods read `state.auth` from the handle. */
export function reinjectVercelAuth(
  driverKind: string,
  storedHandle: unknown,
  config: unknown,
): unknown {
  if (driverKind !== (VERCEL_KIND as string)) return storedHandle;
  const auth =
    config !== null && typeof config === "object" && "auth" in config
      ? (config as { auth?: unknown }).auth
      : undefined;
  if (auth === undefined) return storedHandle;
  return { ...(storedHandle as Record<string, unknown>), auth };
}
