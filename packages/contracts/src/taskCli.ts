import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  NonNegativeInt,
  ThreadId,
  TurnId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { ProviderSessionEnvironment } from "./providerEnvironment.ts";
import { TaskStageContextResult, TaskWorkspaceId, TaskWorkspaceStage } from "./taskWorkspace.ts";

export { ProviderSessionEnvironment } from "./providerEnvironment.ts";
export {
  PROVIDER_SESSION_ENVIRONMENT_MAX_VARIABLES,
  PROVIDER_SESSION_ENVIRONMENT_MAX_VALUE_CHARS,
  PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_ENTRIES,
  PROVIDER_SESSION_ENVIRONMENT_MAX_PATH_CHARS,
  PROVIDER_SESSION_ENVIRONMENT_ALLOWLIST,
} from "./providerEnvironment.ts";

export const TASK_CLI_PROTOCOL = "task-cli@1" as const;
export const TASK_CLI_CONTEXT_PATH = "/api/task-cli/v1/context" as const;
export const TASK_CLI_ENDPOINT_ENVIRONMENT_KEY = "KATACODE_TASK_CLI_ENDPOINT" as const;
export const TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY = "KATACODE_TASK_INVOCATION_TOKEN" as const;
export const TASK_CLI_EXECUTABLE_ENVIRONMENT_KEY = "KATACODE_TASK_CLI_EXECUTABLE" as const;

export const TaskCliErrorCode = Schema.Literals([
  "invalid_request",
  "unauthorized",
  "not_active",
  "stale_lease",
  "terminal_lease",
  "internal_error",
]);
export type TaskCliErrorCode = typeof TaskCliErrorCode.Type;

export const TaskCliError = Schema.Struct({
  code: TaskCliErrorCode,
  message: Schema.String,
});
export type TaskCliError = typeof TaskCliError.Type;

export const TaskCliSuccessEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(true),
  operation: Schema.Literal("context"),
  context: TaskStageContextResult,
});
export type TaskCliSuccessEnvelope = typeof TaskCliSuccessEnvelope.Type;

export const TaskCliFailureEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(false),
  operation: Schema.Literal("context"),
  error: TaskCliError,
});
export type TaskCliFailureEnvelope = typeof TaskCliFailureEnvelope.Type;

export const TaskCliContextEnvelope = Schema.Union([
  TaskCliSuccessEnvelope,
  TaskCliFailureEnvelope,
]);
export type TaskCliContextEnvelope = typeof TaskCliContextEnvelope.Type;

/** Server-derived identity and turn scope for a single provider invocation. */
export const TaskInvocationScope = Schema.Struct({
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  occurrence: NonNegativeInt,
  stage: TaskWorkspaceStage,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  providerTurnId: TurnId,
});
export type TaskInvocationScope = typeof TaskInvocationScope.Type;

export const TaskInvocationLeaseStatus = Schema.Literals(["active", "revoked"]);
export type TaskInvocationLeaseStatus = typeof TaskInvocationLeaseStatus.Type;

export const TaskInvocationRevocationReason = Schema.Literals([
  "superseded",
  "terminal",
  "failed",
  "stopped",
  "startup_orphan",
  "orphan",
  "manual",
]);
export type TaskInvocationRevocationReason = typeof TaskInvocationRevocationReason.Type;

/** Persisted invocation material; raw tokens are intentionally absent. */
export const TaskInvocationLease = Schema.Struct({
  tokenHash: TrimmedNonEmptyString,
  scope: TaskInvocationScope,
  status: TaskInvocationLeaseStatus,
  issuedAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String),
  revocationReason: Schema.NullOr(TaskInvocationRevocationReason),
});
export type TaskInvocationLease = typeof TaskInvocationLease.Type;
