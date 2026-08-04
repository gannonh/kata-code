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

import { TaskWorkspaceService, safeBranchSegment } from "./TaskWorkspaceService.ts";
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
  /**
   * Mark orphaned `running` implementation-check rows and their still-pending
   * or running attempts indeterminate. Runs once before polling; never reruns
   * a command.
   */
  readonly reconcile: () => Effect.Effect<void, never>;
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

      // A settled attempt is terminal. A crash between settling the attempt and
      // writing the terminal outbox row must never re-run the command; the row
      // is simply retired here. A row whose task or attempt is missing is also
      // retired without running anything.
      const settledTask = yield* taskWorkspaces.getTask(entry.taskId);
      const settledAttempt = settledTask?.build.checkAttempts.find(
        (candidate) => candidate.id === payload.attemptId,
      );
      if (
        !settledTask ||
        !settledAttempt ||
        settledAttempt.status === "pass" ||
        settledAttempt.status === "fail" ||
        settledAttempt.status === "indeterminate" ||
        settledAttempt.status === "stale"
      ) {
        yield* store
          .upsertOutbox({
            ...entry,
            status: "completed",
            attemptCount: entry.attemptCount + 1,
            updatedAt: now,
            completedAt: now,
          })
          .pipe(Effect.catch(() => Effect.void));
        return;
      }

      const repository = settledTask.workspace.repositories[0];
      const result = yield* repository?.baseCommitSha
        ? commandRunner
            .run({
              worktreePath: payload.worktreePath,
              expectedBranch: `katacode/task-${safeBranchSegment(entry.taskId)}`,
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
      // Any settled attempt (pass, fail, or indeterminate) is terminal: the row
      // is written `completed` so `readPendingOutbox` never re-queues it. Only a
      // brand-new explicit check-run request creates a new attempt and row.
      yield* store
        .upsertOutbox({
          ...entry,
          status: "completed",
          attemptCount: entry.attemptCount + 1,
          updatedAt: now,
          completedAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
    }).pipe(Effect.catch(() => Effect.void));

  // Startup-only crash reconciliation. A `running` row means a previous worker
  // process died between the pre-spawn write and the terminal write. The attempt
  // is marked indeterminate (only while it is still pending or running) and the
  // row is retired; the command is never re-run.
  const reconcileImplementationChecks: Effect.Effect<void, never> = Effect.gen(function* () {
    const running = yield* store
      .readRunningImplementationChecks({ environmentId, limit: 1_000 })
      .pipe(Effect.mapError(() => "task-outbox-reconcile-read-failed" as const))
      .pipe(Effect.catch(() => Effect.succeed([])));
    for (const entry of running) {
      const payload = yield* Schema.decodeUnknownEffect(
        TaskWorkspaceImplementationCheckOutboxPayload,
      )(entry.payload).pipe(Effect.orElseSucceed(() => null));
      const now = DateTime.formatIso(yield* DateTime.now);
      if (payload) {
        yield* taskWorkspaces
          .processImplementationCheck({
            taskId: entry.taskId,
            attemptId: payload.attemptId,
            status: "indeterminate",
            output: "The check process result could not be reconciled after restart.",
            exitCode: null,
            endingCommitSha: null,
          })
          .pipe(Effect.catch(() => Effect.void));
      }
      yield* store
        .upsertOutbox({
          ...entry,
          status: "completed",
          attemptCount: entry.attemptCount + 1,
          updatedAt: now,
          completedAt: now,
        })
        .pipe(Effect.catch(() => Effect.void));
    }
  });

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
        yield* reconcileImplementationChecks;
        yield* Effect.forkScoped(loop);
      }).pipe(Effect.asVoid),
    drain: () => processPending,
    reconcile: () => reconcileImplementationChecks,
  } satisfies TaskWorkspaceBootstrapWorkerShape;
});

export const TaskWorkspaceBootstrapWorkerLive = Layer.effect(
  TaskWorkspaceBootstrapWorker,
  makeWorker,
);
