import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { TaskWorkspaceService } from "./TaskWorkspaceService.ts";
import { TaskWorkspaceStore } from "../persistence/Services/TaskWorkspaceStore.ts";

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

  // Failures are recorded on the outbox row by the saga itself; the poll loop
  // must never crash the worker, so batch errors are logged and swallowed.
  const processPending: Effect.Effect<void, never> = Effect.gen(function* () {
    const pending = yield* store
      .readPendingOutbox(BATCH_SIZE)
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
        yield* Effect.forkScoped(loop);
      }).pipe(Effect.asVoid),
    drain: () => processPending,
  } satisfies TaskWorkspaceBootstrapWorkerShape;
});

export const TaskWorkspaceBootstrapWorkerLive = Layer.effect(
  TaskWorkspaceBootstrapWorker,
  makeWorker,
);
