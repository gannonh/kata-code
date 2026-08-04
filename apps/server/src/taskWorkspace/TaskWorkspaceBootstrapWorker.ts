import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import {
  TaskWorkspaceImplementationCheckOutboxPayload,
  type TaskWorkspaceOutboxEntry,
} from "@kata-sh/code-contracts";

import { TaskWorkspaceService } from "./TaskWorkspaceService.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { TaskWorkspaceStore } from "../persistence/Services/TaskWorkspaceStore.ts";
import { TaskWorktreeCommandRunner } from "./TaskWorktreeCommandRunner.ts";

export interface TaskWorkspaceBootstrapWorkerShape {
  /** Start the background outbox worker inside the given scope. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /**
   * Process one outbox batch synchronously. Tests drive the saga through this
   * path instead of waiting on the poll loop.
   */
  readonly drain: () => Effect.Effect<void, never>;
}

export class TaskWorkspaceBootstrapWorker extends Context.Service<
  TaskWorkspaceBootstrapWorker,
  TaskWorkspaceBootstrapWorkerShape
>()("@kata-sh/code-cli/taskWorkspace/TaskWorkspaceBootstrapWorker") {}

const POLL_INTERVAL_MS = 250;
const BATCH_SIZE = 4;

const makeWorker = Effect.gen(function* () {
  const taskWorkspaces = yield* TaskWorkspaceService;
  const store = yield* TaskWorkspaceStore;
  const serverEnvironment = yield* ServerEnvironment;
  const commandRunner = yield* TaskWorktreeCommandRunner;
  const environmentId = yield* serverEnvironment.getEnvironmentId;

  const processImplementationCheck = (
    entry: TaskWorkspaceOutboxEntry,
  ): Effect.Effect<void, never> =>
    Effect.gen(function* () {
      const payload = yield* Schema.decodeUnknownEffect(
        TaskWorkspaceImplementationCheckOutboxPayload,
      )(entry.payload).pipe(Effect.orElseSucceed(() => null));
      if (!payload) return;
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* store
        .upsertOutbox({
          ...entry,
          status: "running",
          attemptCount: entry.attemptCount + 1,
          updatedAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
      const task = yield* taskWorkspaces.getTask(entry.taskId);
      const repository = task?.workspace.repositories[0];
      const segment =
        entry.taskId
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, "-")
          .replace(/^-|-$/gu, "")
          .slice(0, 32) || "task";
      const result = yield* repository?.baseCommitSha
        ? commandRunner
            .run({
              worktreePath: payload.worktreePath,
              expectedBranch: `katacode/task-${segment}`,
              expectedBaseCommitSha: repository.baseCommitSha,
              command: payload.command,
              timeoutMs: payload.timeoutMs,
            })
            .pipe(
              Effect.orElseSucceed(() => ({
                status: "indeterminate" as const,
                output: "Task check execution was indeterminate.",
                exitCode: null,
                timedOut: true,
                startingCommitSha: "unknown",
                startingStatus: "",
                endingStatus: null,
                endingCommitSha: null,
              })),
            )
        : Effect.succeed({
            status: "indeterminate" as const,
            output: "The task base commit is unavailable.",
            exitCode: null,
            timedOut: true,
            startingCommitSha: "unknown",
            startingStatus: "",
            endingStatus: null,
            endingCommitSha: null,
          });
      yield* taskWorkspaces
        .processImplementationCheck({
          taskId: entry.taskId,
          attemptId: payload.attemptId,
          ...result,
        })
        .pipe(Effect.catch(() => Effect.void));
      const status = result.status === "pass" ? ("completed" as const) : ("failed" as const);
      yield* store
        .upsertOutbox({
          ...entry,
          status,
          attemptCount: entry.attemptCount + 1,
          updatedAt: now,
          completedAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
    }).pipe(Effect.catch(() => Effect.void));

  // Failures are recorded on the outbox row by the saga itself; the poll loop
  // must never crash the worker, so batch errors are logged and swallowed.
  const processPending: Effect.Effect<void, never> = Effect.gen(function* () {
    const pending = yield* store
      .readPendingOutbox({ environmentId, limit: BATCH_SIZE })
      .pipe(Effect.mapError(() => "task-outbox-read-failed" as const))
      .pipe(Effect.catch(() => Effect.succeed([])));
    for (const entry of pending) {
      const process =
        entry.target === "bootstrap"
          ? taskWorkspaces.processBootstrap(entry)
          : entry.target === "worktree"
            ? taskWorkspaces.processWorktree(entry)
            : entry.target === "implementation-check"
              ? processImplementationCheck(entry)
              : Effect.void;
      yield* process.pipe(Effect.catch(() => Effect.void));
    }
  });

  const loop = Effect.gen(function* () {
    for (;;) {
      yield* processPending;
      yield* Effect.sleep(`${POLL_INTERVAL_MS} millis`);
    }
  });

  return {
    start: () =>
      Effect.gen(function* () {
        yield* Effect.forkScoped(loop);
      }).pipe(Effect.asVoid),
    drain: () => processPending,
  } satisfies TaskWorkspaceBootstrapWorkerShape;
});

export const TaskWorkspaceBootstrapWorkerLive = Layer.effect(
  TaskWorkspaceBootstrapWorker,
  makeWorker,
);
