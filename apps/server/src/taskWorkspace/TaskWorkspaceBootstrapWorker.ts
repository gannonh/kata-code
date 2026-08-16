import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { TaskWorkspaceService } from "./TaskWorkspaceService.ts";
import { ServerEnvironment } from "../environment/Services/ServerEnvironment.ts";
import { TaskWorkspaceStore } from "../persistence/Services/TaskWorkspaceStore.ts";
import { TaskCheckFinalizerService } from "../taskCli/TaskCheckFinalizerService.ts";

export interface TaskWorkspaceBootstrapWorkerShape {
  /** Start the background outbox worker inside the given scope. */
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  /**
   * Process one outbox batch synchronously. Tests drive the saga through this
   * path instead of waiting on the poll loop.
   */
  readonly drain: () => Effect.Effect<void, never>;
  /**
   * Reconcile begun check attempts whose finalizer belongs to a foreign
   * runtime generation. Marks their still-pending attempts indeterminate
   * without ever rerunning a command. Runs once before polling.
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
  const finalizers = yield* TaskCheckFinalizerService;
  const environmentId = yield* serverEnvironment.getEnvironmentId;

  // Startup-only crash reconciliation. A finalizer issued by a prior runtime
  // generation can no longer be consumed, so its attempt can never settle from
  // a client finalize. Settle it indeterminate (only while still pending or
  // running) without rerunning the command.
  const reconcileImplementationChecks: Effect.Effect<void, never> = Effect.gen(function* () {
    const affected = yield* finalizers
      .reconcile({ foreignOwnersOnly: true })
      .pipe(Effect.mapError(() => "task-check-reconcile-read-failed" as const))
      .pipe(Effect.catch(() => Effect.succeed([])));
    for (const entry of affected) {
      yield* taskWorkspaces
        .processImplementationCheck({
          taskId: entry.taskId,
          attemptId: entry.attemptId,
          status: "indeterminate",
          output: "The check result could not be reconciled after restart.",
          exitCode: null,
          endingCommitSha: null,
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
