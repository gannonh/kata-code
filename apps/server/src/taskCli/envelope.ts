import {
  TASK_CLI_PLANNING_COMMANDS,
  TASK_CLI_PROTOCOL,
  type TaskCliErrorCode,
  type TaskCliOperation,
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
