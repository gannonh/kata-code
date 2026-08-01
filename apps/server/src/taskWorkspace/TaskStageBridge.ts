import { createHash } from "node:crypto";

import {
  TaskStageCompletionAck,
  TaskStageCompletionInput,
  TaskStageContextArtifact,
  TaskStageContextResult,
  TaskStageToolError,
  TaskWorkspaceError,
  type EnvironmentId,
  type TaskStageCompletionInput as TaskStageCompletionInputValue,
  type TaskStageContextResult as TaskStageContextResultValue,
  type TaskWorkspace,
  type TaskWorkspaceArtifactKind,
  type TaskWorkspaceStage,
  type TaskWorkspaceStageOccurrence,
  type ThreadId,
  type ProviderInstanceId,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import { TaskWorkspaceService } from "./TaskWorkspaceService.ts";
import { trustedStageInstructions } from "./taskStageInstructions.ts";

export interface TaskStageBridgeScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerSessionId: string;
}

export interface TaskStageBridgeInvocation {
  readonly task: TaskWorkspace;
  readonly stage: TaskWorkspaceStage;
  readonly occurrence: TaskWorkspaceStageOccurrence;
  readonly sessionId: string;
  readonly providerTurnId: string | undefined;
}

export interface TaskStageBridgeShape {
  readonly resolve: (
    scope: TaskStageBridgeScope,
    options?: { readonly requireActiveTurn?: boolean },
  ) => Effect.Effect<TaskStageBridgeInvocation, TaskStageToolError>;
  readonly context: (
    scope: TaskStageBridgeScope,
  ) => Effect.Effect<TaskStageContextResultValue, TaskStageToolError>;
  readonly complete: (
    scope: TaskStageBridgeScope,
    input: TaskStageCompletionInputValue,
  ) => Effect.Effect<TaskStageCompletionAck, TaskStageToolError>;
  readonly trustedInstructions: (
    scope: TaskStageBridgeScope,
  ) => Effect.Effect<string, TaskStageToolError>;
}

export class TaskStageBridge extends Context.Service<TaskStageBridge, TaskStageBridgeShape>()(
  "@kata-sh/code-cli/taskWorkspace/TaskStageBridge",
) {}

const make = Effect.gen(function* () {
  const taskWorkspaces = yield* TaskWorkspaceService;
  const sessionDirectory = yield* Effect.serviceOption(ProviderSessionDirectory);

  const error = (code: typeof TaskStageToolError.Type.code, message: string): TaskStageToolError =>
    new TaskStageToolError({ code, message });

  const currentStage = (task: TaskWorkspace): TaskWorkspaceStage => {
    const run = task.workflowRuns.at(-1);
    if (!run) {
      throw error("invalid", `Task '${task.id}' has no active workflow run.`);
    }
    return run.currentStage;
  };

  const latestOccurrence = (
    task: TaskWorkspace,
    stage: TaskWorkspaceStage,
  ): TaskWorkspaceStageOccurrence | undefined =>
    task.occurrences
      .filter((candidate) => candidate.stage === stage)
      .toSorted((left, right) => right.ordinal - left.ordinal)[0];

  const runtimeTurnId = (runtimePayload: unknown): string | undefined => {
    if (runtimePayload === null || typeof runtimePayload !== "object") return undefined;
    const value = (runtimePayload as Record<string, unknown>).activeTurnId;
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
  };

  const resolve: TaskStageBridgeShape["resolve"] = Effect.fn("TaskStageBridge.resolve")(
    function* (scope, options) {
      const snapshot = yield* taskWorkspaces.getSnapshot;
      const task = snapshot.tasks.find(
        (candidate) =>
          candidate.environmentId === scope.environmentId &&
          (candidate.bootstrap?.reservedThreadId === scope.threadId ||
            candidate.occurrences.some((occurrence) => occurrence.threadId === scope.threadId)),
      );
      if (!task) {
        return yield* error(
          "unauthorized",
          `No task is registered for environment '${scope.environmentId}'.`,
        );
      }
      yield* taskWorkspaces
        .authorizeTaskStage({
          environmentId: scope.environmentId,
          threadId: scope.threadId,
          providerInstanceId: scope.providerInstanceId,
        })
        .pipe(Effect.mapError((cause) => error("unauthorized", cause.message)));
      yield* taskWorkspaces
        .validatePlanningRoot(task.id)
        .pipe(Effect.mapError((cause) => error("source-drift", cause.message)));
      const stage = currentStage(task);
      const occurrence = latestOccurrence(task, stage);
      const isBootstrapPrimary =
        occurrence?.status === "starting" &&
        task.bootstrap?.status === "running" &&
        task.bootstrap.reservedThreadId === scope.threadId;
      if (
        !occurrence ||
        (!isBootstrapPrimary &&
          occurrence.status !== "running" &&
          occurrence.status !== "finalizing")
      ) {
        return yield* error(
          "not-active",
          `Task '${task.id}' has no active occurrence for stage '${stage}'.`,
        );
      }
      if (!isBootstrapPrimary && occurrence.threadId !== scope.threadId) {
        return yield* error(
          "unauthorized",
          `Thread '${scope.threadId}' is not the active primary conversation for task '${task.id}'.`,
        );
      }
      const sessionId = occurrence.sessionId ?? task.bootstrap?.reservedSessionId;
      if (!sessionId) {
        return yield* error("not-active", "The task primary session is not ready.");
      }
      const session = task.sessions.find((candidate) => candidate.id === sessionId);
      if (
        !isBootstrapPrimary &&
        (!session || session.role !== "primary" || session.status !== "active")
      ) {
        return yield* error(
          "not-active",
          `Session '${sessionId}' is no longer the active task primary.`,
        );
      }
      const modelSelection = task.preferences.modelSelection;
      if (!modelSelection || modelSelection.instanceId !== scope.providerInstanceId) {
        return yield* error(
          "unauthorized",
          `Provider instance '${scope.providerInstanceId}' is not authorized for task '${task.id}'.`,
        );
      }
      if (Option.isNone(sessionDirectory)) {
        return yield* error("not-active", "The provider session directory is unavailable.");
      }
      const binding = yield* sessionDirectory.value
        .getBinding(scope.threadId)
        .pipe(
          Effect.mapError(() =>
            error("not-active", `Provider session '${scope.threadId}' is not ready.`),
          ),
        );
      if (Option.isNone(binding)) {
        return yield* error("not-active", `Provider session '${scope.threadId}' is not ready.`);
      }
      if (binding.value.providerInstanceId !== scope.providerInstanceId) {
        return yield* error(
          "unauthorized",
          `Provider session '${scope.threadId}' belongs to another provider instance.`,
        );
      }
      const providerTurnId = runtimeTurnId(binding.value.runtimePayload);
      if (options?.requireActiveTurn === true && !providerTurnId) {
        return yield* error(
          "turn-unavailable",
          "The active provider turn is unavailable; finish the current turn before completing the stage.",
        );
      }
      return {
        task,
        stage,
        occurrence,
        sessionId,
        providerTurnId,
      } satisfies TaskStageBridgeInvocation;
    },
  );

  const latestArtifact = (task: TaskWorkspace, kind: TaskWorkspaceArtifactKind) => {
    const artifact = task.artifacts.find((candidate) => candidate.kind === kind);
    return artifact?.revisions.find((revision) => revision.revision === artifact.currentRevision);
  };

  const context: TaskStageBridgeShape["context"] = Effect.fn("TaskStageBridge.context")(
    function* (scope) {
      const invocation = yield* resolve(scope);
      const contextKinds: ReadonlySet<TaskWorkspaceArtifactKind> = new Set(
        invocation.stage === "questions"
          ? []
          : invocation.stage === "research"
            ? ["questions"]
            : invocation.stage === "design"
              ? ["questions", "research"]
              : invocation.stage === "plan"
                ? ["questions", "research", "design"]
                : [],
      );
      const manifest = invocation.occurrence.contextManifestId
        ? invocation.task.contextManifests.find(
            (candidate) => candidate.id === invocation.occurrence.contextManifestId,
          )
        : undefined;
      const manifestRefs = new Map(
        manifest?.artifactRefs.map((reference) => [reference.kind, reference.revision]) ?? [],
      );
      let remainingContextChars = (manifest?.budget ?? 12_000) * 4;
      const artifacts = invocation.task.artifacts
        .filter((artifact) => contextKinds.has(artifact.kind))
        .flatMap((artifact) => {
          const manifestRevision = manifestRefs.get(artifact.kind);
          if (manifest !== undefined && manifestRevision === undefined) return [];
          const revision =
            (manifestRevision === undefined
              ? latestArtifact(invocation.task, artifact.kind)
              : artifact.revisions.find((candidate) => candidate.revision === manifestRevision)) ??
            null;
          if (!revision || remainingContextChars <= 0) return [];
          const markdown = revision.markdown.slice(0, remainingContextChars);
          remainingContextChars -= markdown.length;
          return [
            {
              kind: artifact.kind,
              revision: revision.revision,
              title: revision.title,
              markdown,
            } satisfies TaskStageContextArtifact,
          ];
        });
      const feedback = invocation.occurrence.feedback ?? invocation.task.planGate?.feedback ?? null;
      return {
        stage: invocation.stage,
        occurrence: invocation.occurrence.ordinal,
        brief: invocation.task.intake.brief,
        feedback,
        artifacts,
      } satisfies TaskStageContextResult;
    },
  );

  const complete: TaskStageBridgeShape["complete"] = Effect.fn("TaskStageBridge.complete")(
    function* (scope, input) {
      const decodedInput = yield* Schema.decodeUnknownEffect(TaskStageCompletionInput)(input).pipe(
        Effect.mapError(() => error("invalid", "The stage completion payload is malformed.")),
      );
      const invocation = yield* resolve(scope, { requireActiveTurn: true });
      const providerTurnId = invocation.providerTurnId!;
      const payloadDigest = createHash("sha256")
        .update(`${decodedInput.summary}\n${decodedInput.markdown}`)
        .digest("hex");
      const task = yield* taskWorkspaces
        .proposeStageCompletion({
          taskId: invocation.task.id,
          sessionId: invocation.sessionId,
          providerTurnId,
          payloadDigest,
          summary: decodedInput.summary,
          markdown: decodedInput.markdown,
        })
        .pipe(
          Effect.mapError((cause) => {
            const message = Schema.is(TaskWorkspaceError)(cause)
              ? cause.message
              : cause && typeof cause === "object" && "message" in cause
                ? String((cause as { readonly message?: unknown }).message)
                : String(cause);
            const code =
              message.includes("gate") || message.includes("already")
                ? "conflict"
                : message.includes("drift")
                  ? "source-drift"
                  : message.includes("session") || message.includes("occurrence")
                    ? "not-active"
                    : "invalid";
            return error(code, message);
          }),
        );
      const occurrence = latestOccurrence(task, invocation.stage);
      const proposalId = occurrence?.completionProposalId;
      if (!proposalId) {
        return yield* error("invalid", "The completion proposal was not persisted.");
      }
      return {
        accepted: true,
        stage: invocation.stage,
        occurrence: invocation.occurrence.ordinal,
        proposalId,
        providerTurnId,
      } satisfies TaskStageCompletionAck;
    },
  );

  const trustedInstructions: TaskStageBridgeShape["trustedInstructions"] = Effect.fn(
    "TaskStageBridge.trustedInstructions",
  )(function* (scope) {
    const invocation = yield* resolve(scope);
    return trustedStageInstructions(invocation.stage);
  });

  return { resolve, context, complete, trustedInstructions } satisfies TaskStageBridgeShape;
});

export const TaskStageBridgeLive = Layer.effect(TaskStageBridge, make);
