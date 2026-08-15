import {
  TASK_CLI_PLANNING_COMMANDS,
  TASK_CLI_PROTOCOL,
  type TaskCliCheckBeginResult,
  type TaskCliCheckFinalizeStatus,
  type TaskCliErrorCode,
  type TaskCliOperation,
  type TaskCliProgressStatus,
  type TaskStageCompletionAck,
  type TaskStageContextResult,
} from "@kata-sh/code-contracts";

export const taskCliFailureEnvelope = (
  operation: TaskCliOperation,
  code: TaskCliErrorCode,
  message: string,
) =>
  ({
    protocol: TASK_CLI_PROTOCOL,
    ok: false as const,
    operation,
    error: { code, message },
  }) as const;

export const taskCliContextSuccessEnvelope = (context: TaskStageContextResult) =>
  ({
    protocol: TASK_CLI_PROTOCOL,
    ok: true as const,
    operation: "context" as const,
    context,
    commands: TASK_CLI_PLANNING_COMMANDS,
  }) as const;

export const taskCliCompleteSuccessEnvelope = (completion: TaskStageCompletionAck) =>
  ({
    protocol: TASK_CLI_PROTOCOL,
    ok: true as const,
    operation: "complete" as const,
    completion,
  }) as const;

export const taskCliProgressSuccessEnvelope = (input: {
  readonly phaseId: string;
  readonly workItemId: string | null;
  readonly status: TaskCliProgressStatus;
  readonly taskRevision: number;
}) =>
  ({
    protocol: TASK_CLI_PROTOCOL,
    ok: true as const,
    operation: "progress" as const,
    accepted: true as const,
    phaseId: input.phaseId,
    workItemId: input.workItemId,
    status: input.status,
    taskRevision: input.taskRevision,
  }) as const;

export const taskCliCheckBeginSuccessEnvelope = (result: TaskCliCheckBeginResult) =>
  ({
    protocol: TASK_CLI_PROTOCOL,
    ok: true as const,
    operation: "check" as const,
    ...result,
  }) as const;

export const taskCliCheckFinalizeSuccessEnvelope = (input: {
  readonly checkId: string;
  readonly attemptId: string;
  readonly status: TaskCliCheckFinalizeStatus;
  readonly taskRevision: number;
}) =>
  ({
    protocol: TASK_CLI_PROTOCOL,
    ok: true as const,
    operation: "check" as const,
    accepted: true as const,
    checkId: input.checkId,
    attemptId: input.attemptId,
    status: input.status,
    taskRevision: input.taskRevision,
  }) as const;

export const taskCliAmendmentSuccessEnvelope = (input: {
  readonly amendmentId: string;
  readonly taskRevision: number;
}) =>
  ({
    protocol: TASK_CLI_PROTOCOL,
    ok: true as const,
    operation: "amendment" as const,
    accepted: true as const,
    amendmentId: input.amendmentId,
    taskRevision: input.taskRevision,
  }) as const;
