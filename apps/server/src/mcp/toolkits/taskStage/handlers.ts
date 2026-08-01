import * as Effect from "effect/Effect";

import { TaskStageToolError } from "@kata-sh/code-contracts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { TaskStageBridge } from "../../../taskWorkspace/TaskStageBridge.ts";
import { TaskStageToolkit } from "./tools.ts";

const scopeFromInvocation = (invocation: McpInvocationContext.McpInvocationScope) => ({
  environmentId: invocation.environmentId,
  threadId: invocation.threadId,
  providerInstanceId: invocation.providerInstanceId,
  providerSessionId: invocation.providerSessionId,
});

const requireTaskStageInvocation = Effect.fn("TaskStageToolkit.requireInvocation")(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("task-stage")) {
    return yield* new TaskStageToolError({
      code: "unauthorized",
      message: "MCP credential does not grant the task-stage capability.",
    });
  }
  return invocation;
});

const handlers = {
  task_stage_context: () =>
    Effect.gen(function* () {
      const invocation = yield* requireTaskStageInvocation();
      const bridge = yield* TaskStageBridge;
      return yield* bridge.context(scopeFromInvocation(invocation));
    }),
  task_stage_complete: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireTaskStageInvocation();
      const bridge = yield* TaskStageBridge;
      return yield* bridge.complete(scopeFromInvocation(invocation), input);
    }),
} satisfies Parameters<typeof TaskStageToolkit.toLayer>[0];

export const TaskStageToolkitHandlersLive = TaskStageToolkit.toLayer(handlers);
