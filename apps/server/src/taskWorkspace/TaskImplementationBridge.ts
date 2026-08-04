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
  type EnvironmentId,
  type ProviderInstanceId,
  type TaskWorkspace,
  type ThreadId,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as McpProviderSession from "../mcp/McpProviderSession.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import { safeBranchSegment, TaskWorkspaceService } from "./TaskWorkspaceService.ts";

export interface TaskImplementationBridgeScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: string;
}

export interface TaskImplementationInvocation {
  readonly task: TaskWorkspace;
  readonly occurrence: TaskWorkspace["occurrences"][number];
  readonly sessionId: string;
  readonly providerTurnId: string;
}

export interface TaskImplementationBridgeShape {
  readonly resolve: (
    scope: TaskImplementationBridgeScope,
  ) => Effect.Effect<TaskImplementationInvocation, TaskImplementationToolError>;
  readonly context: (
    scope: TaskImplementationBridgeScope,
  ) => Effect.Effect<TaskImplementationContextResult, TaskImplementationToolError>;
  readonly progress: (
    scope: TaskImplementationBridgeScope,
    input: TaskImplementationProgressInput,
  ) => Effect.Effect<TaskImplementationProgressAck, TaskImplementationToolError>;
  readonly checkRun: (
    scope: TaskImplementationBridgeScope,
    input: TaskImplementationCheckRunInput,
  ) => Effect.Effect<TaskImplementationCheckRunAck, TaskImplementationToolError>;
  readonly amendmentPropose: (
    scope: TaskImplementationBridgeScope,
    input: TaskImplementationAmendmentInput,
  ) => Effect.Effect<TaskImplementationAmendmentAck, TaskImplementationToolError>;
  readonly complete: (
    scope: TaskImplementationBridgeScope,
    input: TaskImplementationCompleteInput,
  ) => Effect.Effect<TaskImplementationCompleteAck, TaskImplementationToolError>;
}

export class TaskImplementationBridge extends Context.Service<
  TaskImplementationBridge,
  TaskImplementationBridgeShape
>()("@kata-sh/code-cli/taskWorkspace/TaskImplementationBridge") {}

const make = Effect.gen(function* () {
  const taskWorkspaces = yield* TaskWorkspaceService;
  const sessionDirectory = yield* Effect.serviceOption(ProviderSessionDirectory);
  const error = (code: typeof TaskImplementationToolError.Type.code, message: string) =>
    new TaskImplementationToolError({ code, message });

  const resolve: TaskImplementationBridgeShape["resolve"] = Effect.fn(
    "TaskImplementationBridge.resolve",
  )(function* (scope) {
    const active = McpProviderSession.readMcpProviderSession(scope.threadId);
    if (
      !active ||
      active.environmentId !== scope.environmentId ||
      active.threadId !== scope.threadId ||
      active.providerSessionId !== scope.providerSessionId ||
      active.providerInstanceId !== scope.providerInstanceId
    ) {
      return yield* error(
        "unauthorized",
        "The provider session credential is not active for this invocation.",
      );
    }
    const credential = yield* McpSessionRegistry.resolveActiveMcpCredential(
      active.authorizationHeader,
    );
    if (!credential?.capabilities.has("task-implementation")) {
      return yield* error(
        "unauthorized",
        "The MCP credential does not grant task implementation capability.",
      );
    }
    const snapshot = yield* taskWorkspaces.getSnapshot;
    const task = snapshot.tasks.find(
      (candidate) =>
        candidate.environmentId === scope.environmentId &&
        candidate.occurrences.some((occurrence) => occurrence.threadId === scope.threadId),
    );
    if (!task)
      return yield* error("unauthorized", "No task is registered for this provider thread.");
    yield* taskWorkspaces
      .authorizeTaskStage({
        environmentId: scope.environmentId,
        threadId: scope.threadId,
        providerInstanceId: scope.providerInstanceId,
      })
      .pipe(Effect.mapError((cause) => error("unauthorized", cause.message)));
    const run = task.workflowRuns.at(-1);
    const occurrence = task.occurrences
      .filter((candidate) => candidate.stage === "build")
      .toSorted((a, b) => b.ordinal - a.ordinal)[0];
    if (
      !run ||
      run.currentStage !== "build" ||
      !occurrence ||
      (occurrence.status !== "running" && occurrence.status !== "finalizing")
    )
      return yield* error("not-active", "The task has no active implementation occurrence.");
    if (occurrence.threadId !== scope.threadId || !occurrence.sessionId)
      return yield* error(
        "unauthorized",
        "The provider thread is not the active implementation primary.",
      );
    const session = task.sessions.find((candidate) => candidate.id === occurrence.sessionId);
    if (!session || session.role !== "primary" || session.status !== "active")
      return yield* error("not-active", "The implementation session is no longer active.");
    if (
      task.preferences.modelSelection?.instanceId !== scope.providerInstanceId ||
      session.provider !== scope.providerInstanceId
    )
      return yield* error(
        "unauthorized",
        "The provider instance is not pinned to this implementation.",
      );
    const repository = task.workspace.repositories[0];
    const expectedBranch = `katacode/task-${safeBranchSegment(task.id)}`;
    if (!repository?.worktreePath || repository.branch !== expectedBranch)
      return yield* error("worktree-invalid", "The canonical task worktree is unavailable.");
    if (Option.isNone(sessionDirectory))
      return yield* error("not-active", "The provider session directory is unavailable.");
    const binding = yield* sessionDirectory.value
      .getBinding(scope.threadId)
      .pipe(
        Effect.mapError(() => error("not-active", "The provider session binding is unavailable.")),
      );
    if (Option.isNone(binding) || binding.value.providerInstanceId !== scope.providerInstanceId)
      return yield* error("unauthorized", "The provider binding does not match the task.");
    const payload = binding.value.runtimePayload;
    const providerTurnId =
      payload &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).activeTurnId === "string"
        ? (payload as Record<string, string>).activeTurnId
        : undefined;
    if (!providerTurnId)
      return yield* error("turn-unavailable", "An active provider turn is required.");
    return { task, occurrence, sessionId: occurrence.sessionId, providerTurnId };
  });

  const context: TaskImplementationBridgeShape["context"] = (scope) =>
    resolve(scope).pipe(
      Effect.flatMap((invocation) => taskWorkspaces.implementationContext(invocation.task.id)),
      Effect.mapError((cause) =>
        Schema.is(TaskImplementationToolError)(cause) ? cause : error("invalid", cause.message),
      ),
    );
  const progress: TaskImplementationBridgeShape["progress"] = (scope, input) =>
    resolve(scope).pipe(
      Effect.flatMap((invocation) =>
        taskWorkspaces.implementationProgress({
          taskId: invocation.task.id,
          expectedTaskRevision: invocation.task.taskRevision,
          phaseId: input.phaseId,
          workItemId: input.workItemId,
          status: input.status,
          summary: input.summary,
        }),
      ),
      Effect.mapError((cause) => error("invalid", cause.message)),
    );
  const checkRun: TaskImplementationBridgeShape["checkRun"] = (scope, input) =>
    resolve(scope).pipe(
      Effect.flatMap((invocation) =>
        taskWorkspaces.implementationCheckRun({
          taskId: invocation.task.id,
          expectedTaskRevision: invocation.task.taskRevision,
          checkId: input.checkId,
          operationKey: `implementation-check:${invocation.occurrence.id}:${invocation.providerTurnId}:${input.checkId}`,
        }),
      ),
      Effect.mapError((cause) => error("check-blocked", cause.message)),
    );
  const amendmentPropose: TaskImplementationBridgeShape["amendmentPropose"] = (scope, input) =>
    resolve(scope).pipe(
      Effect.flatMap((invocation) =>
        taskWorkspaces.implementationAmendmentPropose({
          taskId: invocation.task.id,
          expectedTaskRevision: invocation.task.taskRevision,
          ...input,
          operationKey: `implementation-amendment:${invocation.occurrence.id}:${invocation.providerTurnId}:${input.phaseId}:${input.workItemId}`,
        }),
      ),
      Effect.mapError((cause) => error("conflict", cause.message)),
    );
  const complete: TaskImplementationBridgeShape["complete"] = (scope, input) =>
    resolve(scope).pipe(
      Effect.flatMap((invocation) =>
        taskWorkspaces.implementationComplete({
          taskId: invocation.task.id,
          expectedTaskRevision: invocation.task.taskRevision,
          summary: input.summary,
          operationKey: `implementation-complete:${invocation.occurrence.id}:${invocation.providerTurnId}`,
          sessionId: invocation.sessionId,
          providerTurnId: invocation.providerTurnId,
        }),
      ),
      Effect.mapError((cause) => error("conflict", cause.message)),
    );

  return {
    resolve,
    context,
    progress,
    checkRun,
    amendmentPropose,
    complete,
  } satisfies TaskImplementationBridgeShape;
});

export const TaskImplementationBridgeLive = Layer.effect(TaskImplementationBridge, make);
