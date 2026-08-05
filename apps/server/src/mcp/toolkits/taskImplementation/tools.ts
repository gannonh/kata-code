import {
  TaskImplementationAmendmentAck,
  TaskImplementationAmendmentInput,
  TaskImplementationCheckRunAck,
  TaskImplementationCheckRunInput,
  TaskImplementationCompleteAck,
  TaskImplementationCompleteInput,
  TaskImplementationContextResult,
  TaskImplementationProgressAck,
  TaskImplementationProgressInput,
  TaskImplementationToolError,
} from "@kata-sh/code-contracts";
import { Tool, Toolkit } from "effect/unstable/ai";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { TaskImplementationBridge } from "../../../taskWorkspace/TaskImplementationBridge.ts";

const dependencies = [McpInvocationContext.McpInvocationContext, TaskImplementationBridge];
export const TaskImplementationContextTool = Tool.make("task_implementation_context", {
  description: "Load the bounded approved implementation Plan and current server progress.",
  success: TaskImplementationContextResult,
  failure: TaskImplementationToolError,
  dependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);
export const TaskImplementationProgressTool = Tool.make("task_implementation_progress", {
  description: "Record typed implementation progress for a known phase or work item.",
  parameters: TaskImplementationProgressInput,
  success: TaskImplementationProgressAck,
  failure: TaskImplementationToolError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Idempotent, true);
export const TaskImplementationCheckRunTool = Tool.make("task_implementation_check_run", {
  description: "Request an approved automated check in the task worktree.",
  parameters: TaskImplementationCheckRunInput,
  success: TaskImplementationCheckRunAck,
  failure: TaskImplementationToolError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Idempotent, true);
export const TaskImplementationAmendmentTool = Tool.make("task_implementation_amendment_propose", {
  description: "Propose a Plan amendment for human review.",
  parameters: TaskImplementationAmendmentInput,
  success: TaskImplementationAmendmentAck,
  failure: TaskImplementationToolError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Idempotent, true);
export const TaskImplementationCompleteTool = Tool.make("task_implementation_complete", {
  description:
    "Propose completion of the active implementation occurrence. When accepted, stop using tools and return the final response so this provider turn can terminate.",
  parameters: TaskImplementationCompleteInput,
  success: TaskImplementationCompleteAck,
  failure: TaskImplementationToolError,
  dependencies,
})
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Idempotent, true);
export const TaskImplementationToolkit = Toolkit.make(
  TaskImplementationContextTool,
  TaskImplementationProgressTool,
  TaskImplementationCheckRunTool,
  TaskImplementationAmendmentTool,
  TaskImplementationCompleteTool,
);
