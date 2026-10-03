import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  ProviderSessionId,
  RoutineId,
  RoutineRequestId,
  RunId,
  RuntimeRequestId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2StoredEvent,
  type RoutineDraft,
  type RoutineRun,
  type ThreadId,
} from "@kata-sh/code-contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as EventStore from "../orchestration-v2/EventStore.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  CANCELLED_DETAIL,
  FAILED_DETAIL,
  QUEUE_HELD_DETAIL,
  RESTART_CANCELLED_DETAIL,
  ROLLED_BACK_DETAIL,
  RoutineRunObserver,
  RoutineRunObserverLive,
  foldRoutineRunProgress,
  hasPendingApproval,
} from "./RoutineRunObserver.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";

const environmentId = EnvironmentId.make("routine-observer-environment");
const configuration: RoutineDraft = {
  name: "Observed routine",
  instruction: "Summarize yesterday's failures.",
  projectId: ProjectId.make("project:routine-observer"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "approval-required",
  workspace: { kind: "shared", directory: "/repo" },
  trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
};
const at = DateTime.makeUnsafe("2026-10-03T09:00:00.000Z");
const restartCommand = (threadId: ThreadId) =>
  CommandId.make(`command:runtime-reconcile:startup:${threadId}:2026-10-03T09:05:00.000Z`);
const shutdownCommand = (threadId: ThreadId) =>
  CommandId.make(`command:runtime-reconcile:shutdown:${threadId}:2026-10-03T09:04:00.000Z`);

let eventCounter = 0;
const runUpdated = (
  threadId: ThreadId,
  userMessageId: MessageId,
  status: OrchestrationV2Run["status"],
  options: { readonly queueHeld?: boolean } = {},
): OrchestrationV2DomainEvent => {
  eventCounter += 1;
  const runId = RunId.make(`run:${threadId}:${userMessageId}`);
  return {
    id: EventId.make(`event:observer:${eventCounter}`),
    type: "run.updated",
    threadId,
    runId,
    occurredAt: at,
    payload: {
      id: runId,
      threadId,
      ordinal: 1,
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: configuration.modelSelection,
      providerThreadId: null,
      userMessageId,
      rootNodeId: null,
      activeAttemptId: null,
      status,
      ...(options.queueHeld === undefined ? {} : { queueHeld: options.queueHeld }),
      requestedAt: at,
      startedAt: null,
      completedAt: null,
      checkpointId: null,
      contextHandoffId: null,
    },
  };
};
const requestUpdated = (
  threadId: ThreadId,
  id: string,
  kind: OrchestrationV2RuntimeRequest["kind"],
  status: OrchestrationV2RuntimeRequest["status"],
): OrchestrationV2DomainEvent => {
  eventCounter += 1;
  return {
    id: EventId.make(`event:observer:${eventCounter}`),
    type: "runtime-request.updated",
    threadId,
    nodeId: NodeId.make(`node:${id}`),
    occurredAt: at,
    payload: {
      id: RuntimeRequestId.make(id),
      nodeId: NodeId.make(`node:${id}`),
      providerTurnId: null,
      nativeRequestRef: null,
      kind,
      status,
      responseCapability: {
        type: "live",
        providerSessionId: ProviderSessionId.make("session:observer"),
      },
      createdAt: at,
      resolvedAt: status === "pending" ? null : at,
    },
  };
};
const runFailed = (
  threadId: ThreadId,
  userMessageId: MessageId,
  message: string,
): OrchestrationV2DomainEvent => {
  eventCounter += 1;
  const runId = RunId.make(`run:${threadId}:${userMessageId}`);
  return {
    id: EventId.make(`event:observer:${eventCounter}`),
    type: "turn-item.updated",
    threadId,
    runId,
    occurredAt: at,
    payload: {
      id: TurnItemId.make(`turn-item:failure:${eventCounter}`),
      threadId,
      runId,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: eventCounter,
      status: "failed",
      title: "Workspace preparation failed",
      startedAt: at,
      completedAt: at,
      updatedAt: at,
      type: "error",
      failure: { class: "validation_error", message, code: null, retryable: false },
    },
  };
};
const stored = (
  sequence: number,
  event: OrchestrationV2DomainEvent,
  commandId: string | null = "command:effect:provider-turn",
): OrchestrationV2StoredEvent => ({
  sequence,
  commandId: commandId === null ? null : CommandId.make(commandId),
  event,
});

const initial = {
  messageId: MessageId.make("routine-message-a"),
  status: "starting",
  stage: "prompt-accepted",
  detail: null,
} as const satisfies Pick<RoutineRun, "messageId" | "status" | "stage" | "detail">;
const threadA = "routine-a" as ThreadId;

it.each([
  ["preparing", {}, { stage: "prompt-accepted", status: "starting", detail: null }],
  ["starting", {}, { stage: "prompt-accepted", status: "starting", detail: null }],
  ["queued", {}, { stage: "prompt-accepted", status: "starting", detail: null }],
  [
    "queued",
    { queueHeld: true },
    { stage: "prompt-accepted", status: "needs-attention", detail: QUEUE_HELD_DETAIL },
  ],
  ["running", {}, { stage: "provider-bound", status: "running", detail: null }],
  ["waiting", {}, { stage: "provider-bound", status: "running", detail: null }],
  ["completed", {}, { stage: "terminal", status: "succeeded", detail: null }],
  ["failed", {}, { stage: "terminal", status: "failed", detail: FAILED_DETAIL }],
  ["interrupted", {}, { stage: "terminal", status: "interrupted", detail: null }],
  ["rolled_back", {}, { stage: "terminal", status: "interrupted", detail: ROLLED_BACK_DETAIL }],
  ["cancelled", {}, { stage: "terminal", status: "interrupted", detail: CANCELLED_DETAIL }],
] as const)("maps an orchestration run that is %s %o", (status, options, expected) => {
  assert.deepEqual(
    foldRoutineRunProgress(initial, [
      stored(1, runUpdated(threadA, initial.messageId, status, options)),
    ]),
    expected,
  );
});

it.each([
  ["startup", restartCommand(threadA)],
  ["shutdown", shutdownCommand(threadA)],
])("settles a run cancelled by %s reconciliation as needs-attention", (_trigger, commandId) => {
  assert.deepEqual(
    foldRoutineRunProgress(initial, [
      stored(1, runUpdated(threadA, initial.messageId, "running")),
      stored(2, runUpdated(threadA, initial.messageId, "cancelled"), commandId),
    ]),
    { stage: "terminal", status: "needs-attention", detail: RESTART_CANCELLED_DETAIL },
  );
});

it("ignores runs for later messages in the routine thread and keeps a terminal result", () => {
  const manual = MessageId.make("manual-follow-up");
  assert.deepEqual(
    foldRoutineRunProgress(initial, [
      stored(1, runUpdated(threadA, initial.messageId, "completed")),
      stored(2, runUpdated(threadA, manual, "running")),
      stored(3, runUpdated(threadA, initial.messageId, "failed")),
    ]),
    { stage: "terminal", status: "succeeded", detail: null },
  );
  assert.deepEqual(
    foldRoutineRunProgress(initial, [stored(1, runUpdated(threadA, manual, "failed"))]),
    { stage: "prompt-accepted", status: "starting", detail: null },
  );
});

it("reports a pending approval only while its latest state is pending", () => {
  const pending = stored(1, requestUpdated(threadA, "request-1", "permission", "pending"));
  const resolved = stored(2, requestUpdated(threadA, "request-1", "permission", "resolved"));
  const userInput = stored(3, requestUpdated(threadA, "request-2", "user_input", "pending"));
  assert.isTrue(hasPendingApproval([pending]));
  assert.isFalse(hasPendingApproval([pending, resolved]));
  assert.isFalse(hasPendingApproval([userInput]));
});

const makeLayer = () => {
  const database = SqlitePersistenceMemory;
  const store = RoutineStoreLive.pipe(Layer.provide(database));
  const applicationEvents = OrchestrationEventStoreLive.pipe(Layer.provide(database));
  const observer = RoutineRunObserverLive.pipe(
    Layer.provide(Layer.mergeAll(store, applicationEvents)),
  );
  const events = EventStore.layerFromOrchestrationEventStore.pipe(Layer.provide(applicationEvents));
  return Layer.mergeAll(observer, store, events);
};

/** A test run launched through orchestration and handed to the observer. */
const launchedRun = (routineId: string) =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    yield* TestClock.setTime(10_000);
    const routine = yield* store.save(
      environmentId,
      { id: RoutineId.make(routineId), expectedRevision: 0, configuration },
      10_000,
    );
    yield* store.testRun(
      environmentId,
      {
        id: routine.id,
        expectedRevision: routine.revision,
        requestId: RoutineRequestId.make(`${routineId}:request`),
      },
      10_000,
    );
    const claim = yield* store.claim("worker-a", 10_000);
    yield* store.beginLaunch(claim!, 10_001);
    yield* store.markLaunched(claim!, 10_002);
    return { routine, run: claim!.run };
  });

const latestRun = (routineId: RoutineId) =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    const run = (yield* store.history(environmentId, { id: routineId })).runs[0]!;
    return { stage: run.stage, status: run.status, detail: run.detail };
  });

it.effect("settles a run cut off by a server restart as needs-attention and frees the slot", () =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    const observer = yield* RoutineRunObserver;
    const events = yield* EventStore.EventStoreV2;
    const { routine, run } = yield* launchedRun("routine-restart");

    yield* events.append({
      commandId: CommandId.make("command:effect:provider-turn.start"),
      events: [runUpdated(run.threadId, run.messageId, "running")],
    });
    yield* observer.observe;
    assert.deepEqual(yield* latestRun(routine.id), {
      stage: "provider-bound",
      status: "running",
      detail: null,
    });

    // Startup recovery cancels the run under its reconcile command.
    yield* events.append({
      commandId: restartCommand(run.threadId),
      events: [runUpdated(run.threadId, run.messageId, "cancelled")],
    });
    yield* observer.observe;
    assert.deepEqual(yield* latestRun(routine.id), {
      stage: "terminal",
      status: "needs-attention",
      detail: RESTART_CANCELLED_DETAIL,
    });
    assert.deepEqual(yield* store.activeRuns(), []);
    const next = yield* store.testRun(
      environmentId,
      {
        id: routine.id,
        expectedRevision: routine.revision,
        requestId: RoutineRequestId.make("routine-restart:after"),
      },
      20_000,
    );
    assert.equal(next.status, "queued");
  }).pipe(Effect.provide(makeLayer())),
);

it.effect("settles a run stopped from its conversation as interrupted", () =>
  Effect.gen(function* () {
    const observer = yield* RoutineRunObserver;
    const events = yield* EventStore.EventStoreV2;
    const { routine, run } = yield* launchedRun("routine-stopped");
    yield* events.append({
      commandId: CommandId.make("command:run.interrupt:user"),
      events: [
        runUpdated(run.threadId, run.messageId, "running"),
        runUpdated(run.threadId, run.messageId, "cancelled"),
      ],
    });
    yield* observer.observe;
    assert.deepEqual(yield* latestRun(routine.id), {
      stage: "terminal",
      status: "interrupted",
      detail: CANCELLED_DETAIL,
    });
  }).pipe(Effect.provide(makeLayer())),
);

it.effect("tracks an approval wait and then the run's success", () =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    const observer = yield* RoutineRunObserver;
    const events = yield* EventStore.EventStoreV2;
    const { routine, run } = yield* launchedRun("routine-approval");

    yield* events.append({
      events: [
        runUpdated(run.threadId, run.messageId, "running"),
        requestUpdated(run.threadId, "request-approval", "command", "pending"),
      ],
    });
    yield* observer.observe;
    assert.deepEqual(yield* latestRun(routine.id), {
      stage: "provider-bound",
      status: "waiting-for-approval",
      detail: null,
    });

    yield* events.append({
      events: [requestUpdated(run.threadId, "request-approval", "command", "resolved")],
    });
    yield* observer.observe;
    assert.equal((yield* latestRun(routine.id)).status, "running");

    yield* events.append({
      events: [
        runUpdated(run.threadId, run.messageId, "waiting"),
        runUpdated(run.threadId, run.messageId, "completed"),
      ],
    });
    yield* observer.observe;
    assert.deepEqual(yield* latestRun(routine.id), {
      stage: "terminal",
      status: "succeeded",
      detail: null,
    });
    assert.deepEqual(yield* store.launchedRuns(), []);
  }).pipe(Effect.provide(makeLayer())),
);

it.effect("keeps a held queued run active as needs-attention until it runs", () =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    const observer = yield* RoutineRunObserver;
    const events = yield* EventStore.EventStoreV2;
    const { routine, run } = yield* launchedRun("routine-held");
    yield* events.append({
      commandId: restartCommand(run.threadId),
      events: [runUpdated(run.threadId, run.messageId, "queued", { queueHeld: true })],
    });
    yield* observer.observe;
    assert.deepEqual(yield* latestRun(routine.id), {
      stage: "prompt-accepted",
      status: "needs-attention",
      detail: QUEUE_HELD_DETAIL,
    });
    assert.deepEqual(
      (yield* store.activeRuns()).map((active) => active.id),
      [run.id],
    );

    yield* events.append({ events: [runUpdated(run.threadId, run.messageId, "running")] });
    yield* observer.observe;
    assert.equal((yield* latestRun(routine.id)).status, "running");
  }).pipe(Effect.provide(makeLayer())),
);

it.effect("does not let an observer that read an older cursor overwrite newer progress", () =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    const { routine, run } = yield* launchedRun("routine-cursor");
    const [launched] = yield* store.launchedRuns();
    assert.equal(launched?.eventCursor, 0);

    const newer = yield* store.recordOrchestrationProgress(
      {
        runId: run.id,
        fromCursor: 0,
        toCursor: 9,
        progress: { stage: "terminal", status: "succeeded", detail: null },
      },
      11_000,
    );
    const stale = yield* store.recordOrchestrationProgress(
      {
        runId: run.id,
        fromCursor: 0,
        toCursor: 5,
        progress: { stage: "provider-bound", status: "running", detail: null },
      },
      11_001,
    );
    assert.isTrue(newer);
    assert.isFalse(stale);
    assert.deepEqual(yield* latestRun(routine.id), {
      stage: "terminal",
      status: "succeeded",
      detail: null,
    });
  }).pipe(Effect.provide(makeLayer())),
);

it.effect(
  "carries the failure orchestration recorded on a failed run, capped at 4,000 characters",
  () =>
    Effect.gen(function* () {
      const observer = yield* RoutineRunObserver;
      const events = yield* EventStore.EventStoreV2;
      const branchExists = yield* launchedRun("routine-branch-exists");
      yield* events.append({
        commandId: CommandId.make("command:prepared-run.fail"),
        events: [
          runFailed(
            branchExists.run.threadId,
            branchExists.run.messageId,
            "fatal: a branch named 'routine/run-1' already exists",
          ),
          runUpdated(branchExists.run.threadId, branchExists.run.messageId, "failed"),
        ],
      });
      const longSetupFailure = yield* launchedRun("routine-setup-failed");
      yield* events.append({
        events: [
          runFailed(
            longSetupFailure.run.threadId,
            longSetupFailure.run.messageId,
            `Setup script exited with code 2: ${"x".repeat(4_050)}`,
          ),
          runUpdated(longSetupFailure.run.threadId, longSetupFailure.run.messageId, "failed"),
        ],
      });
      const unexplained = yield* launchedRun("routine-unexplained");
      yield* events.append({
        events: [runUpdated(unexplained.run.threadId, unexplained.run.messageId, "failed")],
      });
      yield* observer.observe;

      assert.deepEqual(yield* latestRun(branchExists.routine.id), {
        stage: "terminal",
        status: "failed",
        detail: "fatal: a branch named 'routine/run-1' already exists",
      });
      const setupDetail = (yield* latestRun(longSetupFailure.routine.id)).detail;
      assert.equal(setupDetail?.length, 4_000);
      assert.isTrue(setupDetail?.startsWith("Setup script exited with code 2: xxx"));
      assert.deepEqual(yield* latestRun(unexplained.routine.id), {
        stage: "terminal",
        status: "failed",
        detail: FAILED_DETAIL,
      });
    }).pipe(Effect.provide(makeLayer())),
);
