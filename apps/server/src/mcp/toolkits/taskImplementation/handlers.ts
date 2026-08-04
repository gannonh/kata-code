import * as Effect from "effect/Effect";
import { TaskImplementationToolError } from "@kata-sh/code-contracts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { TaskImplementationBridge } from "../../../taskWorkspace/TaskImplementationBridge.ts";
import { TaskImplementationToolkit } from "./tools.ts";

const scope = (invocation: McpInvocationContext.McpInvocationScope) => ({
  environmentId: invocation.environmentId,
  threadId: invocation.threadId,
  providerInstanceId: invocation.providerInstanceId,
  providerSessionId: invocation.providerSessionId,
});
const requireCapability = Effect.fn("TaskImplementationToolkit.requireCapability")(function* () {
  const invocation = yield* McpInvocationContext.McpInvocationContext;
  if (!invocation.capabilities.has("task-implementation"))
    return yield* new TaskImplementationToolError({
      code: "unauthorized",
      message: "MCP credential does not grant task implementation capability.",
    });
  return invocation;
});
const handlers = {
  task_implementation_context: () =>
    Effect.gen(function* () {
      const invocation = yield* requireCapability();
      return yield* (yield* TaskImplementationBridge).context(scope(invocation));
    }),
  task_implementation_progress: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireCapability();
      return yield* (yield* TaskImplementationBridge).progress(scope(invocation), input);
    }),
  task_implementation_check_run: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireCapability();
      return yield* (yield* TaskImplementationBridge).checkRun(scope(invocation), input);
    }),
  task_implementation_amendment_propose: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireCapability();
      return yield* (yield* TaskImplementationBridge).amendmentPropose(scope(invocation), input);
    }),
  task_implementation_complete: (input) =>
    Effect.gen(function* () {
      const invocation = yield* requireCapability();
      return yield* (yield* TaskImplementationBridge).complete(scope(invocation), input);
    }),
} satisfies Parameters<typeof TaskImplementationToolkit.toLayer>[0];
export const TaskImplementationToolkitHandlersLive = TaskImplementationToolkit.toLayer(handlers);
