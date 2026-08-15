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
import {
  TaskStageCompletionAck,
  TaskStageContextResult,
  TaskWorkspaceId,
  TaskWorkspaceStage,
} from "./taskWorkspace.ts";

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
export const TASK_CLI_COMPLETE_PATH = "/api/task-cli/v1/complete" as const;
export const TASK_CLI_PROGRESS_PATH = "/api/task-cli/v1/progress" as const;
export const TASK_CLI_CHECK_BEGIN_PATH = "/api/task-cli/v1/check/begin" as const;
export const TASK_CLI_CHECK_FINALIZE_PATH = "/api/task-cli/v1/check/finalize" as const;
export const TASK_CLI_AMENDMENT_PATH = "/api/task-cli/v1/amendment" as const;
export const TASK_CLI_ENDPOINT_ENVIRONMENT_KEY = "KATACODE_TASK_CLI_ENDPOINT" as const;
export const TASK_CLI_INVOCATION_TOKEN_ENVIRONMENT_KEY = "KATACODE_TASK_INVOCATION_TOKEN" as const;
export const TASK_CLI_EXECUTABLE_ENVIRONMENT_KEY = "KATACODE_TASK_CLI_EXECUTABLE" as const;

export const TASK_CLI_SUMMARY_MAX_CHARS = 4_000;
export const TASK_CLI_ARTIFACT_MAX_CHARS = 100_000;
export const TASK_CLI_CHECK_ID_MAX_CHARS = 256;
export const TASK_CLI_CHECK_OUTPUT_MAX_CHARS = 1_048_576;
export const TASK_CLI_RESPONSE_MAX_CHARS = 32_768;
export const TASK_CLI_CONTEXT_COMMAND = "katacode task context" as const;
export const TASK_CLI_COMPLETE_COMMAND =
  "katacode task complete --summary <text> --artifact-file <file|->" as const;

export const TaskCliPlanningCommands = Schema.Struct({
  context: Schema.Literal(TASK_CLI_CONTEXT_COMMAND),
  complete: Schema.Literal(TASK_CLI_COMPLETE_COMMAND),
});
export type TaskCliPlanningCommands = typeof TaskCliPlanningCommands.Type;

export const TASK_CLI_PLANNING_COMMANDS: TaskCliPlanningCommands = {
  context: TASK_CLI_CONTEXT_COMMAND,
  complete: TASK_CLI_COMPLETE_COMMAND,
};

export const TaskCliOperation = Schema.Literals([
  "context",
  "complete",
  "progress",
  "check",
  "amendment",
]);
export type TaskCliOperation = typeof TaskCliOperation.Type;

export const TaskCliErrorCode = Schema.Literals([
  "invalid_request",
  "unauthorized",
  "not_active",
  "stale_lease",
  "terminal_lease",
  "conflict",
  "invalid_artifact",
  "payload_too_large",
  "check_indeterminate",
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
  commands: TaskCliPlanningCommands,
});
export type TaskCliSuccessEnvelope = typeof TaskCliSuccessEnvelope.Type;

export const TaskCliCompleteSuccessEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(true),
  operation: Schema.Literal("complete"),
  completion: TaskStageCompletionAck,
});
export type TaskCliCompleteSuccessEnvelope = typeof TaskCliCompleteSuccessEnvelope.Type;

export const TaskCliFailureEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(false),
  operation: TaskCliOperation,
  error: TaskCliError,
});
export type TaskCliFailureEnvelope = typeof TaskCliFailureEnvelope.Type;

export const TaskCliContextEnvelope = Schema.Union([
  TaskCliSuccessEnvelope,
  TaskCliFailureEnvelope,
]);
export type TaskCliContextEnvelope = typeof TaskCliContextEnvelope.Type;

export const TaskCliCompleteEnvelope = Schema.Union([
  TaskCliCompleteSuccessEnvelope,
  TaskCliFailureEnvelope,
]);
export type TaskCliCompleteEnvelope = typeof TaskCliCompleteEnvelope.Type;

export const TaskCliCompleteRequest = Schema.Struct({
  summary: Schema.String.check(Schema.isMaxLength(TASK_CLI_SUMMARY_MAX_CHARS)),
  markdown: Schema.String.check(Schema.isMaxLength(TASK_CLI_ARTIFACT_MAX_CHARS)),
});
export type TaskCliCompleteRequest = typeof TaskCliCompleteRequest.Type;

export const TaskCliProgressStatus = Schema.Literals(["running", "completed", "blocked"]);
export type TaskCliProgressStatus = typeof TaskCliProgressStatus.Type;

export const TaskCliProgressRequest = Schema.Struct({
  target: Schema.Literals(["phase", "work-item"]),
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  status: TaskCliProgressStatus,
  summary: Schema.String.check(Schema.isMaxLength(TASK_CLI_SUMMARY_MAX_CHARS)),
});
export type TaskCliProgressRequest = typeof TaskCliProgressRequest.Type;

export const TaskCliProgressSuccessEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(true),
  operation: Schema.Literal("progress"),
  accepted: Schema.Literal(true),
  phaseId: TrimmedNonEmptyString,
  workItemId: Schema.NullOr(TrimmedNonEmptyString),
  status: TaskCliProgressStatus,
  taskRevision: NonNegativeInt,
});
export type TaskCliProgressSuccessEnvelope = typeof TaskCliProgressSuccessEnvelope.Type;

export const TaskCliCheckBeginRequest = Schema.Struct({
  checkId: TrimmedNonEmptyString.check(Schema.isMaxLength(TASK_CLI_CHECK_ID_MAX_CHARS)),
});
export type TaskCliCheckBeginRequest = typeof TaskCliCheckBeginRequest.Type;

export const TaskCliCheckBeginResult = Schema.Struct({
  accepted: Schema.Literal(true),
  attemptId: TrimmedNonEmptyString,
  checkId: TrimmedNonEmptyString,
  attemptNumber: NonNegativeInt,
  command: Schema.String,
  cwd: Schema.String,
  timeoutMs: NonNegativeInt,
  maxOutputBytes: NonNegativeInt,
  finalizerToken: TrimmedNonEmptyString,
  startingCommitSha: TrimmedNonEmptyString,
  startingStatus: Schema.String,
  taskRevision: NonNegativeInt,
});
export type TaskCliCheckBeginResult = typeof TaskCliCheckBeginResult.Type;

export const TaskCliCheckBeginSuccessEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(true),
  operation: Schema.Literal("check"),
  ...TaskCliCheckBeginResult.fields,
});
export type TaskCliCheckBeginSuccessEnvelope = typeof TaskCliCheckBeginSuccessEnvelope.Type;

export const TaskCliCheckFinalizeRequest = Schema.Struct({
  finalizerToken: TrimmedNonEmptyString,
  exitCode: Schema.NullOr(Schema.Int),
  output: Schema.String.check(Schema.isMaxLength(TASK_CLI_CHECK_OUTPUT_MAX_CHARS)),
  timedOut: Schema.Boolean,
  startingCommitSha: TrimmedNonEmptyString,
  endingCommitSha: Schema.NullOr(TrimmedNonEmptyString),
  startingStatus: Schema.String.check(Schema.isMaxLength(TASK_CLI_CHECK_OUTPUT_MAX_CHARS)),
  endingStatus: Schema.NullOr(
    Schema.String.check(Schema.isMaxLength(TASK_CLI_CHECK_OUTPUT_MAX_CHARS)),
  ),
});
export type TaskCliCheckFinalizeRequest = typeof TaskCliCheckFinalizeRequest.Type;

export const TaskCliCheckFinalizeStatus = Schema.Literals(["pass", "fail", "indeterminate"]);
export type TaskCliCheckFinalizeStatus = typeof TaskCliCheckFinalizeStatus.Type;

export const TaskCliCheckFinalizeSuccessEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(true),
  operation: Schema.Literal("check"),
  accepted: Schema.Literal(true),
  checkId: TrimmedNonEmptyString,
  attemptId: TrimmedNonEmptyString,
  status: TaskCliCheckFinalizeStatus,
  taskRevision: NonNegativeInt,
});
export type TaskCliCheckFinalizeSuccessEnvelope = typeof TaskCliCheckFinalizeSuccessEnvelope.Type;

export const TaskCliAmendmentRequest = Schema.Struct({
  phaseId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  workItemId: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  triggeringCheckId: Schema.NullOr(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  expected: Schema.String.check(Schema.isMaxLength(TASK_CLI_SUMMARY_MAX_CHARS)),
  found: Schema.String.check(Schema.isMaxLength(TASK_CLI_SUMMARY_MAX_CHARS)),
  impact: Schema.String.check(Schema.isMaxLength(TASK_CLI_SUMMARY_MAX_CHARS)),
  proposedPlanMarkdown: Schema.String.check(Schema.isMaxLength(TASK_CLI_ARTIFACT_MAX_CHARS)),
});
export type TaskCliAmendmentRequest = typeof TaskCliAmendmentRequest.Type;

export const TaskCliAmendmentSuccessEnvelope = Schema.Struct({
  protocol: Schema.Literal(TASK_CLI_PROTOCOL),
  ok: Schema.Literal(true),
  operation: Schema.Literal("amendment"),
  accepted: Schema.Literal(true),
  amendmentId: TrimmedNonEmptyString,
  taskRevision: NonNegativeInt,
});
export type TaskCliAmendmentSuccessEnvelope = typeof TaskCliAmendmentSuccessEnvelope.Type;

export const TaskCliProgressEnvelope = Schema.Union([
  TaskCliProgressSuccessEnvelope,
  TaskCliFailureEnvelope,
]);
export type TaskCliProgressEnvelope = typeof TaskCliProgressEnvelope.Type;

export const TaskCliCheckBeginEnvelope = Schema.Union([
  TaskCliCheckBeginSuccessEnvelope,
  TaskCliFailureEnvelope,
]);
export type TaskCliCheckBeginEnvelope = typeof TaskCliCheckBeginEnvelope.Type;

export const TaskCliCheckFinalizeEnvelope = Schema.Union([
  TaskCliCheckFinalizeSuccessEnvelope,
  TaskCliFailureEnvelope,
]);
export type TaskCliCheckFinalizeEnvelope = typeof TaskCliCheckFinalizeEnvelope.Type;

export const TaskCliAmendmentEnvelope = Schema.Union([
  TaskCliAmendmentSuccessEnvelope,
  TaskCliFailureEnvelope,
]);
export type TaskCliAmendmentEnvelope = typeof TaskCliAmendmentEnvelope.Type;

/** Documented planning-completion contract. Tests cover every row. */
export const TASK_CLI_PLANNING_COMPLETION_CONTRACT = {
  protocol: TASK_CLI_PROTOCOL,
  path: TASK_CLI_COMPLETE_PATH,
  summaryMaxChars: TASK_CLI_SUMMARY_MAX_CHARS,
  artifactMaxChars: TASK_CLI_ARTIFACT_MAX_CHARS,
  responseMaxChars: TASK_CLI_RESPONSE_MAX_CHARS,
  successExit: 0,
  failureExit: 1,
  successFields: ["accepted", "stage", "occurrence", "proposalId", "providerTurnId"] as const,
  errorCodes: TaskCliErrorCode.literals,
} as const;

/**
 * Versioned command-contract table for the implementation Task CLI surface.
 * Each row is a protocol command with its success schema, request/response
 * bounds, stable error codes, and exit semantics. Contract tests prove every
 * row (see `taskCli.test.ts`).
 */
export const TASK_CLI_IMPLEMENTATION_COMMAND_CONTRACT = {
  protocol: TASK_CLI_PROTOCOL,
  successExit: 0,
  failureExit: 1,
  errorCodes: TaskCliErrorCode.literals,
  commands: [
    {
      command: TASK_CLI_CONTEXT_COMMAND,
      method: "GET",
      path: TASK_CLI_CONTEXT_PATH,
      successSchema: "TaskCliSuccessEnvelope",
      successFields: ["context", "commands"] as const,
      maxRequestChars: 0,
      maxResponseChars: TASK_CLI_RESPONSE_MAX_CHARS,
      successExit: 0,
      failureExit: 1,
      errorCodes: TaskCliErrorCode.literals,
    },
    {
      command: "katacode task progress phase|work-item <id> --status <status> --summary <text>",
      method: "POST",
      path: TASK_CLI_PROGRESS_PATH,
      successSchema: "TaskCliProgressSuccessEnvelope",
      successFields: ["accepted", "phaseId", "workItemId", "status", "taskRevision"] as const,
      maxRequestChars: TASK_CLI_SUMMARY_MAX_CHARS,
      maxResponseChars: TASK_CLI_RESPONSE_MAX_CHARS,
      successExit: 0,
      failureExit: 1,
      errorCodes: TaskCliErrorCode.literals,
    },
    {
      command: "katacode task check run <check-id> (begin)",
      method: "POST",
      path: TASK_CLI_CHECK_BEGIN_PATH,
      successSchema: "TaskCliCheckBeginSuccessEnvelope",
      successFields: [
        "accepted",
        "attemptId",
        "checkId",
        "attemptNumber",
        "command",
        "cwd",
        "timeoutMs",
        "maxOutputBytes",
        "finalizerToken",
        "startingCommitSha",
        "startingStatus",
        "taskRevision",
      ] as const,
      maxRequestChars: TASK_CLI_CHECK_ID_MAX_CHARS,
      maxResponseChars: TASK_CLI_RESPONSE_MAX_CHARS,
      successExit: 0,
      failureExit: 1,
      errorCodes: TaskCliErrorCode.literals,
    },
    {
      command: "katacode task check run <check-id> (finalize)",
      method: "POST",
      path: TASK_CLI_CHECK_FINALIZE_PATH,
      successSchema: "TaskCliCheckFinalizeSuccessEnvelope",
      successFields: ["accepted", "checkId", "attemptId", "status", "taskRevision"] as const,
      maxRequestChars: TASK_CLI_CHECK_OUTPUT_MAX_CHARS,
      maxResponseChars: TASK_CLI_RESPONSE_MAX_CHARS,
      successExit: 0,
      failureExit: 1,
      errorCodes: TaskCliErrorCode.literals,
    },
    {
      command:
        "katacode task amendment propose --phase <id> --work-item <id> --expected <text> --found <text> --impact <text> --input <file|->",
      method: "POST",
      path: TASK_CLI_AMENDMENT_PATH,
      successSchema: "TaskCliAmendmentSuccessEnvelope",
      successFields: ["accepted", "amendmentId", "taskRevision"] as const,
      maxRequestChars: TASK_CLI_ARTIFACT_MAX_CHARS,
      maxResponseChars: TASK_CLI_RESPONSE_MAX_CHARS,
      successExit: 0,
      failureExit: 1,
      errorCodes: TaskCliErrorCode.literals,
    },
    {
      command:
        "katacode task complete --summary <text> --artifact-file <file|-> (build stages omit --artifact-file)",
      method: "POST",
      path: TASK_CLI_COMPLETE_PATH,
      successSchema: "TaskCliCompleteSuccessEnvelope",
      successFields: ["accepted", "stage", "occurrence", "proposalId", "providerTurnId"] as const,
      maxRequestChars: TASK_CLI_SUMMARY_MAX_CHARS,
      maxResponseChars: TASK_CLI_RESPONSE_MAX_CHARS,
      successExit: 0,
      failureExit: 1,
      errorCodes: TaskCliErrorCode.literals,
    },
  ] as const,
} as const;

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
