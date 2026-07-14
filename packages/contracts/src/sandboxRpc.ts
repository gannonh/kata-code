/**
 * Sandbox deployment RPC payloads (the `sandbox.*` methods). Phase 1 surface:
 * list materialized instances, test connection (streaming), start a session
 * (provision + Connect-register), dispose. Composer "Run on" / move is Phase 4.
 *
 * @module sandboxRpc
 */
import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RepositoryIdentity } from "./environment.ts";
import { SandboxProviderInstanceId } from "./sandboxProviderInstance.ts";
import { AdvertisedEndpoint } from "./remoteAccess.ts";

/** A GitHub repository accessible to the host `gh` session, for the sandbox
 *  source picker. Carries no credential material. */
export const SandboxGitHubRepository = Schema.Struct({
  /** Canonical `owner/name`. */
  nameWithOwner: TrimmedNonEmptyString,
  /** Web URL for display. */
  url: TrimmedNonEmptyString,
  /** Repository default branch. */
  defaultBranch: TrimmedNonEmptyString,
  /** `public`, `private`, or Enterprise `internal`; UI-only annotation. */
  visibility: Schema.Literals(["public", "private", "internal"]),
});
export type SandboxGitHubRepository = typeof SandboxGitHubRepository.Type;

/** Search accessible GitHub repositories via the host `gh` session (paged). */
export const SandboxSearchGitHubRepositoriesInput = Schema.Struct({
  /** 1-based page number. */
  page: Schema.optional(PositiveInt),
});
export type SandboxSearchGitHubRepositoriesInput = typeof SandboxSearchGitHubRepositoriesInput.Type;
export const SandboxSearchGitHubRepositoriesResult = Schema.Struct({
  repositories: Schema.Array(SandboxGitHubRepository),
  /** True when another page is available. */
  hasMore: Schema.Boolean,
});
export type SandboxSearchGitHubRepositoriesResult =
  typeof SandboxSearchGitHubRepositoriesResult.Type;

/** List branches of a selected GitHub repository via the host `gh` session. */
export const SandboxListGitHubBranchesInput = Schema.Struct({
  /** Canonical `owner/name`. */
  repository: TrimmedNonEmptyString,
  /** 1-based page number. */
  page: Schema.optional(PositiveInt),
});
export type SandboxListGitHubBranchesInput = typeof SandboxListGitHubBranchesInput.Type;
export const SandboxListGitHubBranchesResult = Schema.Struct({
  branches: Schema.Array(TrimmedNonEmptyString),
  hasMore: Schema.Boolean,
});
export type SandboxListGitHubBranchesResult = typeof SandboxListGitHubBranchesResult.Type;

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
  /** Lifecycle status: `running` or `stopped` (a Vercel timeout in persistent mode reconciles to `stopped`). */
  status: Schema.optional(Schema.Literals(["running", "stopped"])),
  /** Host-side deadline (epoch ms) the keepalive scheduler maintains. */
  deadlineEpochMs: Schema.optional(Schema.Number),
  /** Reconcile warning (e.g. Vercel auth missing on boot); the UI flags the record as unverified. */
  statusDetail: Schema.optional(Schema.String),
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
    /** Driver supports durable stop/start lifecycle (`lifecycle`). */
    supportsLifecycle: Schema.optional(Schema.Boolean),
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
  environmentId: Schema.optionalKey(TrimmedNonEmptyString),
  connectCleanup: Schema.Literals(["not-linked", "unlinked", "pending"]),
});
export type SandboxDisposeSessionResult = typeof SandboxDisposeSessionResult.Type;

/** Renew a running sandbox session's lifetime (Phase 3b). */
export const SandboxRenewSessionInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  /** Extension in ms; defaults to the target's configured `timeoutMs`. */
  extendMs: Schema.optional(Schema.Number),
});
export type SandboxRenewSessionInput = typeof SandboxRenewSessionInput.Type;
export const SandboxRenewSessionResult = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  deadlineEpochMs: Schema.Number,
});
export type SandboxRenewSessionResult = typeof SandboxRenewSessionResult.Type;

/** Stop a running sandbox session (durable lifecycle). The sandbox filesystem
 *  persists (Vercel persistent / Docker container); start resumes it. */
export const SandboxStopSessionInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
});
export type SandboxStopSessionInput = typeof SandboxStopSessionInput.Type;
export const SandboxStopSessionResult = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  stopped: Schema.Boolean,
});
export type SandboxStopSessionResult = typeof SandboxStopSessionResult.Type;

/** Re-issue a pairing token for a running sandbox (identity recovery R2).
 *  Recovery path when the client-side pairing (`addSavedEnvironment`) failed
 *  after a successful start — the sandbox runs but no saved environment
 *  exists. Mints a fresh admin + pairing token chain against the live
 *  container without restarting anything. */
export const SandboxIssuePairingTokenInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
});
export type SandboxIssuePairingTokenInput = typeof SandboxIssuePairingTokenInput.Type;
export const SandboxIssuePairingTokenResult = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  /** The in-sandbox Kata server's environment id. */
  environmentId: TrimmedNonEmptyString,
  pairingToken: TrimmedNonEmptyString,
  endpoint: AdvertisedEndpoint,
});
export type SandboxIssuePairingTokenResult = typeof SandboxIssuePairingTokenResult.Type;

/** Start an interactive provider sign-in flow inside a sandbox (Phase 3b). Streaming. */
export const SandboxProviderLoginStartInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  providerId: TrimmedNonEmptyString,
});
export type SandboxProviderLoginStartInput = typeof SandboxProviderLoginStartInput.Type;

/** A sign-in flow event, tagged by `stage`. */
export const SandboxProviderLoginEvent = Schema.Union([
  Schema.Struct({
    stage: Schema.Literal("started"),
    loginSessionId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    stage: Schema.Literal("url"),
    loginSessionId: TrimmedNonEmptyString,
    url: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    stage: Schema.Literal("awaiting-code"),
    loginSessionId: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    stage: Schema.Literal("invalid-code"),
    loginSessionId: TrimmedNonEmptyString,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    stage: Schema.Literal("success"),
    loginSessionId: TrimmedNonEmptyString,
    credentialStored: Schema.Boolean,
  }),
  Schema.Struct({
    stage: Schema.Literal("error"),
    loginSessionId: TrimmedNonEmptyString,
    message: Schema.String,
  }),
]);
export type SandboxProviderLoginEvent = typeof SandboxProviderLoginEvent.Type;

/** Submit an OAuth code into a running sign-in flow (Phase 3b). */
export const SandboxProviderLoginSubmitCodeInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  loginSessionId: TrimmedNonEmptyString,
  code: TrimmedNonEmptyString,
});
export type SandboxProviderLoginSubmitCodeInput = typeof SandboxProviderLoginSubmitCodeInput.Type;
export const SandboxProviderLoginSubmitCodeResult = Schema.Struct({
  loginSessionId: TrimmedNonEmptyString,
  accepted: Schema.Boolean,
});
export type SandboxProviderLoginSubmitCodeResult = typeof SandboxProviderLoginSubmitCodeResult.Type;

/** Cancel an in-flight provider sign-in (dialog close / stream abort). */
export const SandboxProviderLoginCancelInput = Schema.Struct({
  instanceId: SandboxProviderInstanceId,
  loginSessionId: TrimmedNonEmptyString,
});
export type SandboxProviderLoginCancelInput = typeof SandboxProviderLoginCancelInput.Type;
export const SandboxProviderLoginCancelResult = Schema.Struct({
  loginSessionId: TrimmedNonEmptyString,
  cancelled: Schema.Boolean,
});
export type SandboxProviderLoginCancelResult = typeof SandboxProviderLoginCancelResult.Type;

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
  httpStatus: Schema.optional(Schema.Number),
}) {}
