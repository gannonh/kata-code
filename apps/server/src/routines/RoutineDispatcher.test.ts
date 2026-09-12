import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  EventId,
  ModelSelection,
  ProjectId,
  RoutineError,
  RoutineId,
  RoutineRequestId,
  RuntimeMode,
  TurnId,
  type RoutineProviderSubmission,
  type RoutineRun,
} from "@kata-sh/code-contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderCommandReactor } from "../orchestration/Services/ProviderCommandReactor.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { ProjectSetupScriptRunner } from "../project/ProjectSetupScriptRunner.ts";
import { RoutineDispatcher, RoutineDispatcherLive } from "./RoutineDispatcher.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";

const environmentId = EnvironmentId.make("routine-dispatcher-environment");
const configuration = {
  name: "Long provider turn",
  instruction: "Read every file and write a long report.",
  projectId: ProjectId.make("routine-dispatcher-project"),
  modelSelection: { instanceId: "cursor", model: "auto" } as ModelSelection,
  runtimeMode: "approval-required" as RuntimeMode,
  workspace: { kind: "shared" as const, directory: "/tmp/routine-dispatcher" },
  trigger: { kind: "daily" as const, time: "09:00", timezone: "UTC" },
};

type ProviderTurn = (
  store: RoutineStore["Service"],
  input: { readonly run: RoutineRun; readonly submission: RoutineProviderSubmission },
) => Effect.Effect<void, RoutineError>;

const dispatcherLayer = (providerTurn: ProviderTurn) => {
  const store = RoutineStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const reactor = Layer.effect(
    ProviderCommandReactor,
    Effect.gen(function* () {
      const routineStore = yield* RoutineStore;
      return {
        start: () => Effect.void,
        drain: Effect.void,
        recoverRoutineSubmission: (input) => providerTurn(routineStore, input).pipe(Effect.orDie),
      };
    }),
  );
  return RoutineDispatcherLive.pipe(
    Layer.provideMerge(reactor),
    Layer.provideMerge(store),
    Layer.provide(Layer.mock(OrchestrationEngineService)({})),
    Layer.provide(Layer.mock(ProjectionSnapshotQuery)({})),
    Layer.provide(Layer.mock(GitWorkflowService)({})),
    Layer.provide(Layer.mock(ProjectSetupScriptRunner)({})),
    Layer.provide(NodeServices.layer),
  );
};

const claimAcceptedPrompt = Effect.gen(function* () {
  const store = yield* RoutineStore;
  yield* TestClock.setTime(10_000);
  const routine = yield* store.save(
    environmentId,
    { id: RoutineId.make("routine-long-turn"), expectedRevision: 0, configuration },
    10_000,
  );
  yield* store.testRun(
    environmentId,
    {
      id: routine.id,
      expectedRevision: routine.revision,
      requestId: RoutineRequestId.make("request-long-turn"),
    },
    10_000,
  );
  const claim = yield* store.claim("worker-a", 10_000);
  assert.isNotNull(claim);
  yield* store.updatePreparation(
    claim!,
    { stage: "prompt-accepted", status: "starting", detail: null },
    10_000,
  );
  return {
    routine,
    claim: { ...claim!, run: { ...claim!.run, stage: "prompt-accepted" as const } },
  };
});

it.effect(
  "keeps a submitted provider turn running past lease renewal so Stop settles the run",
  () =>
    Effect.gen(function* () {
      const stop = yield* Deferred.make<void>();
      const interrupted = yield* Ref.make(false);
      const turnId = TurnId.make("provider-turn-long");
      const providerTurn: ProviderTurn = (store, { submission }) =>
        Effect.gen(function* () {
          yield* store.consumeSubmissionForProvider(submission, yield* Clock.currentTimeMillis);
          yield* Deferred.await(stop);
          const now = yield* Clock.currentTimeMillis;
          yield* store.recordProviderTerminal(
            {
              eventId: EventId.make("provider-turn-long-cancelled"),
              threadId: submission.threadId,
              turnId,
              messageId: submission.messageId,
              status: "interrupted",
              detail: "Stopped by user.",
            },
            now,
          );
          yield* store.bindProviderTurn(submission, turnId, now);
        }).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true)));

      yield* Effect.gen(function* () {
        const store = yield* RoutineStore;
        const dispatcher = yield* RoutineDispatcher;
        const { routine, claim } = yield* claimAcceptedPrompt;
        const dispatch = yield* dispatcher.dispatchClaim(claim).pipe(Effect.forkChild);
        yield* TestClock.adjust("12 seconds");
        yield* Deferred.succeed(stop, undefined);
        const exit = yield* Fiber.await(dispatch);

        assert.isTrue(Exit.isSuccess(exit));
        assert.isFalse(yield* Ref.get(interrupted));
        const history = yield* store.history(environmentId, { id: routine.id });
        assert.deepEqual(
          history.runs.map(({ stage, status, turnId }) => ({ stage, status, turnId })),
          [{ stage: "terminal", status: "interrupted", turnId }],
        );
        assert.deepEqual(yield* store.activeRuns(), []);
      }).pipe(Effect.provide(dispatcherLayer(providerTurn)));
    }),
);

const fenceLosses = {
  "the routine is paused": (
    store: RoutineStore["Service"],
    routine: { id: RoutineId; revision: number },
  ) =>
    store.change(
      environmentId,
      { id: routine.id, expectedRevision: routine.revision, action: "pause" },
      13_000,
    ),
  "another owner reclaims the run": (store: RoutineStore["Service"]) =>
    store.claim("worker-b", 40_001),
};

for (const [scenario, loseFence] of Object.entries(fenceLosses)) {
  it.effect(`stops dispatch before submission when ${scenario}`, () =>
    Effect.gen(function* () {
      const interrupted = yield* Ref.make(false);
      const providerTurn: ProviderTurn = () =>
        Effect.never.pipe(Effect.onInterrupt(() => Ref.set(interrupted, true)));

      yield* Effect.gen(function* () {
        const store = yield* RoutineStore;
        const dispatcher = yield* RoutineDispatcher;
        const { routine, claim } = yield* claimAcceptedPrompt;
        const dispatch = yield* dispatcher.dispatchClaim(claim).pipe(Effect.forkChild);
        yield* TestClock.adjust("3 seconds");
        yield* loseFence(store, routine);
        yield* TestClock.adjust("3 seconds");
        const error = yield* Fiber.join(dispatch).pipe(Effect.flip);

        assert.instanceOf(error, RoutineError);
        assert.include(error.message, "Routine preparation ownership expired or was canceled.");
        assert.isTrue(yield* Ref.get(interrupted));
      }).pipe(Effect.provide(dispatcherLayer(providerTurn)));
    }),
  );
}
