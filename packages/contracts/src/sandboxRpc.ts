/**
 * Sandbox deployment RPC payloads (the `sandbox.*` methods). Phase 1 surface:
 * list materialized instances, test connection (streaming), start a session
 * (provision + Connect-register), dispose. Composer "Run on" / move is Phase 4.
 *
 * @module sandboxRpc
 */
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RepositoryIdentity } from "./environment.ts";
import { SandboxProviderInstanceId } from "./sandboxProviderInstance.ts";
import { AdvertisedEndpoint } from "./remoteAccess.ts";

/** Why a configured sandbox instance is unavailable (mirrors the registry). */
export const SandboxInstanceUnavailableReason = Schema.Literals([
  "unknown-driver",
  "disabled",
  "invalid-config",
]);
export type SandboxInstanceUnavailableReason = typeof SandboxInstanceUnavailableReason.Type;

export const SandboxRunningSession = Schema.Struct({
  /** The in-sandbox Kata server's environment id. */
  environmentId: TrimmedNonEmptyString,
  endpoint: AdvertisedEndpoint,
});
export type SandboxRunningSession = typeof SandboxRunningSession.Type;

/** A materialized sandbox instance, for UI listing + diagnostics. */
export const SandboxInstanceSummary = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("available"),
    instanceId: SandboxProviderInstanceId,
    driver: TrimmedNonEmptyString,
    displayName: Schema.optional(TrimmedNonEmptyString),
    reachabilityKind: Schema.Literals(["loopback", "public", "private-network"]),
    supportsSnapshot: Schema.Boolean,
    supportsRenewTimeout: Schema.Boolean,
    runningSession: Schema.optional(SandboxRunningSession),
  }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    instanceId: SandboxProviderInstanceId,
    reason: SandboxInstanceUnavailableReason,
    message: TrimmedNonEmptyString,
  }),
]);
export type SandboxInstanceSummary = typeof SandboxInstanceSummary.Type;

export const SandboxListInstancesInput = Schema.Struct({});
export type SandboxListInstancesInput = typeof SandboxListInstancesInput.Type;
export const SandboxListInstancesResult = Schema.Struct({
  instances: Schema.Array(SandboxInstanceSummary),
});
export type SandboxListInstancesResult = typeof SandboxListInstancesResult.Type;

/** Test connection: provision a minimal container, dispose, report. Streaming. */
export const SandboxTestConnectionInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
});
export type SandboxTestConnectionInput = typeof SandboxTestConnectionInput.Type;
export const SandboxTestConnectionProgressEvent = Schema.Union([
  Schema.Struct({
    stage: Schema.Literal("validate"),
    ok: Schema.Boolean,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    stage: Schema.Literal("provision"),
    ok: Schema.Boolean,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    stage: Schema.Literal("dispose"),
    ok: Schema.Boolean,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    stage: Schema.Literal("done"),
    ok: Schema.Boolean,
    detail: Schema.optional(Schema.String),
  }),
]);
export type SandboxTestConnectionProgressEvent = typeof SandboxTestConnectionProgressEvent.Type;

/** Repo selection for Phase 2 setup (host read + saved-env lookup + seed). */
export const SandboxStartSessionRepository = Schema.Struct({
  /** Host path to the repo working tree (where `.kata/environment.json` lives). */
  repoRoot: TrimmedNonEmptyString,
  /** Keys the saved-env lookup via `canonicalKey`. */
  repositoryIdentity: RepositoryIdentity,
});
export type SandboxStartSessionRepository = typeof SandboxStartSessionRepository.Type;

/** Start session: provision + Connect-register; return the endpoint to bind a thread to. */
export const SandboxStartSessionInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  /** Relay Clerk JWT from the desktop/web session; falls back to the CLI token when omitted. */
  connectAuthToken: Schema.optional(TrimmedNonEmptyString),
  /** When present, resolve + seed + run setup for this repo before Connect registration. */
  repository: Schema.optionalKey(SandboxStartSessionRepository),
});
export type SandboxStartSessionInput = typeof SandboxStartSessionInput.Type;
export const SandboxStartSessionResult = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  /** The in-container Kata server's environment id (its own, per-deployment). */
  environmentId: TrimmedNonEmptyString,
  /** Pairing token for the current client to save and use the loopback sandbox environment. */
  pairingToken: TrimmedNonEmptyString,
  /** The loopback endpoint the deploying desktop connects to. */
  endpoint: AdvertisedEndpoint,
});
export type SandboxStartSessionResult = typeof SandboxStartSessionResult.Type;

export const SandboxDisposeSessionInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
});
export type SandboxDisposeSessionInput = typeof SandboxDisposeSessionInput.Type;
export const SandboxDisposeSessionResult = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  disposed: Schema.Boolean,
});
export type SandboxDisposeSessionResult = typeof SandboxDisposeSessionResult.Type;

export class SandboxRpcError extends Schema.TaggedErrorClass<SandboxRpcError>()("SandboxRpcError", {
  reason: Schema.Literals([
    "unknown-driver",
    "disabled",
    "invalid-config",
    "provision-failed",
    "connect-failed",
    "not-running",
    "unreachable",
    "internal",
  ]),
  message: Schema.String,
}) {}
