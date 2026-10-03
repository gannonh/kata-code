import {
  RoutineError,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2StoredEvent,
  type RoutineRun,
} from "@kata-sh/code-contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as EventStore from "../orchestration-v2/EventStore.ts";
import { RoutineStore } from "./RoutineStore.ts";

/**
 * Startup and shutdown runtime reconciliation commit their run cancellations
 * under this command id prefix (ProviderRuntimeRecoveryService). A run cut off
 * that way did not stop by request, so the routine needs attention.
 */
export const RUNTIME_RECONCILE_COMMAND_PREFIX = "command:runtime-reconcile:";

export const RESTART_CANCELLED_DETAIL =
  "The server restarted before this run finished. Open the conversation to check what completed before running the routine again.";
export const QUEUE_HELD_DETAIL =
  "The server restarted while this run was queued. Resume the conversation's queue to continue.";
export const FAILED_DETAIL = "The run failed. Open the conversation for details.";
export const CANCELLED_DETAIL = "The run was cancelled before it finished.";
export const ROLLED_BACK_DETAIL = "The run was rolled back.";

/** Runtime requests that hold a turn for a person's decision. */
const APPROVAL_REQUEST_KINDS: ReadonlySet<OrchestrationV2RuntimeRequest["kind"]> = new Set([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission",
  "dynamic_tool_call",
]);

export type RoutineRunProgress = Pick<RoutineRun, "status" | "stage" | "detail">;

/**
 * Maps one stored `run.updated` event for the routine's initial message to
 * routine progress. Orchestration's `waiting` is post-turn drain (checkpoint
 * capture or background work), not an approval, so it still counts as running.
 */
export const progressFromRunEvent = (
  stored: OrchestrationV2StoredEvent,
): RoutineRunProgress | null => {
  if (stored.event.type !== "run.updated") return null;
  const run = stored.event.payload;
  switch (run.status) {
    case "preparing":
    case "starting":
      return { stage: "prompt-accepted", status: "starting", detail: null };
    case "queued":
      return run.queueHeld === true
        ? { stage: "prompt-accepted", status: "needs-attention", detail: QUEUE_HELD_DETAIL }
        : { stage: "prompt-accepted", status: "starting", detail: null };
    case "running":
    case "waiting":
      return { stage: "provider-bound", status: "running", detail: null };
    case "completed":
      return { stage: "terminal", status: "succeeded", detail: null };
    case "failed":
      return { stage: "terminal", status: "failed", detail: FAILED_DETAIL };
    case "interrupted":
      return { stage: "terminal", status: "interrupted", detail: null };
    case "rolled_back":
      return { stage: "terminal", status: "interrupted", detail: ROLLED_BACK_DETAIL };
    case "cancelled":
      return stored.commandId !== null &&
        stored.commandId.startsWith(RUNTIME_RECONCILE_COMMAND_PREFIX)
        ? { stage: "terminal", status: "needs-attention", detail: RESTART_CANCELLED_DETAIL }
        : { stage: "terminal", status: "interrupted", detail: CANCELLED_DETAIL };
  }
};

/**
 * Folds stored orchestration events for a routine thread into the routine
 * run's progress. Only `run.updated` events whose user message is the
 * routine's initial message count, so a later manual turn in the same thread
 * never settles the run. A terminal state is final.
 */
export const foldRoutineRunProgress = (
  run: Pick<RoutineRun, "messageId" | "status" | "stage" | "detail">,
  runEvents: ReadonlyArray<OrchestrationV2StoredEvent>,
): RoutineRunProgress => {
  let progress: RoutineRunProgress = {
    status: run.status === "waiting-for-approval" ? "running" : run.status,
    stage: run.stage,
    detail: run.status === "waiting-for-approval" ? null : run.detail,
  };
  for (const stored of runEvents) {
    if (progress.stage === "terminal") break;
    if (stored.event.type !== "run.updated") continue;
    if (stored.event.payload.userMessageId !== run.messageId) continue;
    progress = progressFromRunEvent(stored) ?? progress;
  }
  return progress;
};

/** True when the thread's latest runtime-request state leaves an approval pending. */
export const hasPendingApproval = (
  requestEvents: ReadonlyArray<OrchestrationV2StoredEvent>,
): boolean => {
  const latest = new Map<string, OrchestrationV2RuntimeRequest>();
  for (const stored of requestEvents) {
    if (stored.event.type !== "runtime-request.updated") continue;
    latest.set(stored.event.payload.id, stored.event.payload);
  }
  for (const request of latest.values()) {
    if (request.status === "pending" && APPROVAL_REQUEST_KINDS.has(request.kind)) return true;
  }
  return false;
};

export interface RoutineRunObserverShape {
  /**
   * Reads each launched run's orchestration events after its durable cursor
   * and records the outcome. At startup this catch-up is the reconcile: it
   * replays every event the previous process did not observe, including the
   * runtime reconciliation that cancelled runs cut off by the restart.
   */
  readonly observe: Effect.Effect<void, RoutineError>;
}

export class RoutineRunObserver extends Context.Service<
  RoutineRunObserver,
  RoutineRunObserverShape
>()("@kata-sh/code-cli/routines/RoutineRunObserver") {}

const readFailure = (cause: unknown) =>
  new RoutineError({
    code: "persistence",
    message: `Could not read orchestration events: ${String(cause)}`,
  });

const makeRoutineRunObserver = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const events = yield* EventStore.EventStoreV2;

  const collect = (input: Parameters<EventStore.EventStoreV2Shape["read"]>[0]) =>
    Stream.runCollect(events.read(input)).pipe(Effect.mapError(readFailure));

  const observeRun = (run: RoutineRun, eventCursor: number) =>
    Effect.gen(function* () {
      const through = yield* events
        .latestSequence({ threadId: run.threadId })
        .pipe(Effect.mapError(readFailure));
      if (through <= eventCursor) return;
      const runEvents = yield* collect({
        threadId: run.threadId,
        afterSequence: eventCursor,
        throughSequence: through,
        eventType: "run.updated",
      });
      let progress = foldRoutineRunProgress(run, runEvents);
      if (progress.status === "running") {
        const requestEvents = yield* collect({
          threadId: run.threadId,
          throughSequence: through,
          eventType: "runtime-request.updated",
        });
        if (hasPendingApproval(requestEvents)) {
          progress = { ...progress, status: "waiting-for-approval" };
        }
      }
      yield* store.recordOrchestrationProgress(
        { runId: run.id, fromCursor: eventCursor, toCursor: through, progress },
        DateTime.toEpochMillis(yield* DateTime.now),
      );
    });

  const observe: RoutineRunObserverShape["observe"] = Effect.gen(function* () {
    const launched = yield* store.launchedRuns();
    for (const { run, eventCursor } of launched) {
      yield* observeRun(run, eventCursor).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause as Cause.Cause<never>)
            : Effect.logWarning("routine run observation failed", {
                routineRunId: run.id,
                cause: Cause.pretty(cause),
              }),
        ),
      );
    }
  }).pipe(Effect.withSpan("RoutineRunObserver.observe"));

  return { observe } satisfies RoutineRunObserverShape;
});

/** Requires the shared application event store, which the orchestration runtime provides. */
export const RoutineRunObserverLive = Layer.effect(RoutineRunObserver, makeRoutineRunObserver).pipe(
  Layer.provide(EventStore.layerFromOrchestrationEventStore),
);
