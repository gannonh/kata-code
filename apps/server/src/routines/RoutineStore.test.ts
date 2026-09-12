import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  MessageId,
  ModelSelection,
  ProjectId,
  RoutineId,
  RoutineOwnerGeneration,
  RoutineRequestId,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";

const environmentId = EnvironmentId.make("routine-test-environment");
const projectId = ProjectId.make("routine-test-project");
const modelSelection = { instanceId: "codex", model: "gpt-5.4" } as ModelSelection;
const configuration = {
  name: "Daily test",
  instruction: "Inspect the repository and report the result.",
  projectId,
  modelSelection,
  runtimeMode: "full-access" as RuntimeMode,
  workspace: { kind: "shared" as const, directory: "/tmp/routine-test" },
  trigger: { kind: "daily" as const, time: "09:00", timezone: "UTC" },
};
const storeLayer = Layer.mergeAll(
  RoutineStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
  SqlitePersistenceMemory,
);

it.layer(storeLayer)("RoutineStore", (it) => {
  it.effect("orders history by admission chronology and uses a stable composite cursor", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const routine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-history"),
          expectedRevision: 0,
          configuration,
        },
        Date.parse("2026-01-01T00:00:00.000Z"),
      );
      const first = yield* store.testRun(
        environmentId,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-first"),
        },
        10_000,
      );
      // Release the active slot to admit the next deterministic test run.
      yield* store.change(
        environmentId,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          action: "pause",
        },
        11_000,
      );
      const resumed = yield* store.change(
        environmentId,
        {
          id: routine.id,
          expectedRevision: routine.revision + 1,
          action: "resume",
        },
        12_000,
      );
      const second = yield* store.testRun(
        environmentId,
        {
          id: routine.id,
          expectedRevision: resumed.revision,
          requestId: RoutineRequestId.make("request-second"),
        },
        20_000,
      );
      const page = yield* store.history(environmentId, { id: routine.id, limit: 1 });
      assert.deepEqual(
        page.runs.map((run) => run.id),
        [second.id],
      );
      assert.isString(page.nextCursor);
      const next = yield* store.history(environmentId, {
        id: routine.id,
        before: page.nextCursor ?? undefined,
        limit: 1,
      });
      assert.deepEqual(
        next.runs.map((run) => run.id),
        [first.id],
      );
      assert.isNull(next.nextCursor);
      yield* store.change(
        environmentId,
        {
          id: routine.id,
          expectedRevision: resumed.revision,
          action: "pause",
        },
        21_000,
      );
    }),
  );

  it.effect("does not let a stale owner spend a reclaimed submission generation", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const routine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-fence"),
          expectedRevision: 0,
          configuration,
        },
        Date.parse("2026-01-01T00:00:00.000Z"),
      );
      const run = yield* store.testRun(
        environmentId,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-fence"),
        },
        10_000,
      );
      const first = yield* store.claim("worker-a", 10_000);
      assert.isNotNull(first);
      assert.equal(first!.run.id, run.id);
      const staleSubmission = {
        runId: run.id,
        owner: "worker-a",
        generation: RoutineOwnerGeneration.make(first!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      const reclaimed = yield* store.claim("worker-b", 40_001);
      assert.isNotNull(reclaimed);
      assert.equal(reclaimed!.run.id, run.id);
      const staleResult = yield* store
        .consumeSubmissionForProvider(staleSubmission, 40_001)
        .pipe(
          Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" as const }),
        );
      assert.equal(staleResult, "lost-fence");
      const currentSubmission = {
        runId: run.id,
        owner: "worker-b",
        generation: RoutineOwnerGeneration.make(reclaimed!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(currentSubmission, 40_001);
      const repeatedResult = yield* store
        .consumeSubmissionForProvider(currentSubmission, 40_002)
        .pipe(
          Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" as const }),
        );
      assert.equal(repeatedResult, "lost-fence");
    }),
  );

  it.effect("persists worktree setup completion across a reclaimed preparation lease", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-setup-marker-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-setup-marker"),
          expectedRevision: 0,
          configuration,
        },
        12_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-setup-marker"),
        },
        12_001,
      );
      const first = yield* store.claim("setup-worker-a", 12_001);
      assert.isNotNull(first);
      assert.isFalse(first!.setupComplete);
      yield* store.markSetupComplete(first!, 12_002);

      const reclaimed = yield* store.claim("setup-worker-b", 42_003);
      assert.isNotNull(reclaimed);
      assert.equal(reclaimed!.run.id, run.id);
      assert.isTrue(reclaimed!.setupComplete);
      yield* store.change(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          action: "pause",
        },
        42_004,
      );
    }),
  );

  it.effect("blocks provider setup failures before irreversible submission", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-blocked-before-submission-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-blocked-before-submission"),
          expectedRevision: 0,
          configuration,
        },
        45_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-blocked-before-submission"),
        },
        45_001,
      );
      const claim = yield* store.claim("blocked-before-submission-worker", 45_001);
      assert.isNotNull(claim);
      assert.equal(claim!.run.id, run.id);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      assert.isTrue(
        yield* store.markBlockedBeforeSubmission(
          submission,
          "Provider model is unavailable.",
          45_002,
        ),
      );
      const blocked = yield* store.history(environment, { id: routine.id });
      assert.equal(blocked.runs[0]?.stage, "terminal");
      assert.equal(blocked.runs[0]?.status, "blocked");
      assert.equal(blocked.runs[0]?.detail, "Provider model is unavailable.");
      assert.isFalse((yield* store.activeRuns()).some((active) => active.id === run.id));
      assert.isFalse(yield* store.markBlockedBeforeSubmission(submission, "late", 45_003));
    }),
  );

  it.effect("buffers only the returned provider turn across the adapter-return gap", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const ordinary = yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("ordinary-provider-event"),
          threadId: ThreadId.make("ordinary-provider-thread"),
          turnId: TurnId.make("ordinary-provider-turn"),
          status: "succeeded",
        },
        49_999,
      );
      assert.isFalse(ordinary);
      const routine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-provider-evidence"),
          expectedRevision: 0,
          configuration,
        },
        50_000,
      );
      const run = yield* store.testRun(
        environmentId,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-provider-evidence"),
        },
        50_001,
      );
      const claim = yield* store.claim("provider-evidence-worker", 50_001);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(submission, 50_001);
      yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("provider-event-manual-turn"),
          threadId: run.threadId,
          turnId: TurnId.make("manual-turn"),
          status: "succeeded",
          detail: "must be ignored",
        },
        50_002,
      );
      yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("provider-event-initial-turn"),
          threadId: run.threadId,
          turnId: TurnId.make("initial-turn"),
          status: "succeeded",
        },
        50_003,
      );
      yield* store.bindProviderTurn(submission, "initial-turn", 50_004);
      const history = yield* store.history(environmentId, { id: routine.id });
      assert.equal(history.runs[0]?.stage, "terminal");
      assert.equal(history.runs[0]?.status, "succeeded");
      assert.equal(history.runs[0]?.turnId, "initial-turn");
      const repeated = yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("provider-event-initial-turn-replayed"),
          threadId: run.threadId,
          turnId: TurnId.make("initial-turn"),
          status: "failed",
        },
        50_005,
      );
      assert.isFalse(repeated);
      const afterReplay = yield* store.history(environmentId, { id: routine.id });
      assert.equal(afterReplay.runs[0]?.status, "succeeded");
    }),
  );

  it.effect("marks an irreversibly submitted run for attention after restart", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-recovery-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-recovery"),
          expectedRevision: 0,
          configuration,
        },
        80_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-recovery"),
        },
        80_001,
      );
      const claim = yield* store.claim("recovery-worker", 80_001);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(submission, 80_001);
      yield* store.recoverConsumed(80_002);

      const attention = yield* store.history(environment, { id: routine.id });
      assert.equal(attention.runs[0]?.stage, "submitting");
      assert.equal(attention.runs[0]?.status, "needs-attention");
      assert.equal(
        (yield* store.activeRuns()).some((active) => active.id === run.id),
        true,
      );

      // Evidence that arrived before the adapter response remains durable and
      // is consumed only when the exact initial turn is finally bound.
      yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("recovery-terminal-event"),
          threadId: run.threadId,
          turnId: TurnId.make("recovery-turn"),
          status: "succeeded",
        },
        80_003,
      );
      yield* store.bindProviderTurn(submission, "recovery-turn", 80_004);
      const completed = yield* store.history(environment, { id: routine.id });
      assert.equal(completed.runs[0]?.stage, "terminal");
      assert.equal(completed.runs[0]?.status, "succeeded");
      assert.isNull(completed.runs[0]?.detail);
      assert.equal(
        (yield* store.activeRuns()).some((active) => active.id === run.id),
        false,
      );
    }),
  );

  it.effect("resolves attention only from exact initial-message terminal evidence", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-correlated-recovery-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-correlated-recovery"),
          expectedRevision: 0,
          configuration,
        },
        82_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-correlated-recovery"),
        },
        82_001,
      );
      const claim = yield* store.claim("correlated-recovery-worker", 82_001);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(submission, 82_001);
      yield* store.recoverConsumed(82_020);

      const attention = yield* store.history(environment, { id: routine.id });
      assert.equal(attention.runs[0]?.status, "needs-attention");
      const manual = yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("correlated-recovery-manual-event"),
          threadId: run.threadId,
          turnId: TurnId.make("correlated-recovery-manual-turn"),
          status: "succeeded",
          messageId: MessageId.make("manual-message"),
        },
        82_021,
      );
      assert.isFalse(manual);
      const stillAttention = yield* store.history(environment, { id: routine.id });
      assert.equal(stillAttention.runs[0]?.status, "needs-attention");

      const correlated = yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("correlated-recovery-initial-event"),
          threadId: run.threadId,
          turnId: TurnId.make("correlated-recovery-initial-turn"),
          status: "succeeded",
          messageId: run.messageId,
        },
        82_022,
      );
      assert.isTrue(correlated);
      const completed = yield* store.history(environment, { id: routine.id });
      assert.equal(completed.runs[0]?.status, "succeeded");
      assert.equal(completed.runs[0]?.stage, "terminal");
      assert.equal(completed.runs[0]?.turnId, "correlated-recovery-initial-turn");
      assert.isFalse((yield* store.activeRuns()).some((active) => active.id === run.id));
    }),
  );

  it.effect("reconciles raw terminal evidence through the durable turn projection", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const sql = yield* SqlClient.SqlClient;
      const environment = EnvironmentId.make("routine-projected-recovery-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-projected-recovery"),
          expectedRevision: 0,
          configuration,
        },
        83_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-projected-recovery"),
        },
        83_001,
      );
      const claim = yield* store.claim("projected-recovery-worker", 83_001);
      assert.isNotNull(claim);
      yield* store.consumeSubmissionForProvider(
        {
          runId: run.id,
          owner: claim!.owner,
          generation: RoutineOwnerGeneration.make(claim!.generation),
          threadId: run.threadId,
          messageId: run.messageId,
          commandId: run.commandId,
        },
        83_001,
      );
      const turnId = TurnId.make("projected-recovery-turn");
      yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("projected-recovery-terminal-event"),
          threadId: run.threadId,
          turnId,
          status: "succeeded",
        },
        83_002,
      );
      const timestamp = "2026-01-01T00:00:00.000Z";
      yield* sql`INSERT INTO projection_turns(
        thread_id, turn_id, pending_message_id, state, requested_at, started_at, completed_at, checkpoint_files_json
      ) VALUES (${run.threadId}, ${turnId}, ${run.messageId}, 'completed', ${timestamp}, ${timestamp}, ${timestamp}, '[]')`;
      yield* store.recoverConsumed(83_020);
      const completed = yield* store.history(environment, { id: routine.id });
      assert.equal(completed.runs[0]?.status, "succeeded");
      assert.equal(completed.runs[0]?.turnId, turnId);
      assert.isFalse((yield* store.activeRuns()).some((active) => active.id === run.id));
    }),
  );

  it.effect("does not mistake a live provider submission for a crashed one", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-live-submission-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-live-submission"),
          expectedRevision: 0,
          configuration,
        },
        60_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-live-submission"),
        },
        60_001,
      );
      yield* store.tick("live-provider-worker", 60_000);
      const claim = yield* store.claim("live-provider-worker", 60_001);
      assert.isNotNull(claim);
      yield* store.consumeSubmissionForProvider(
        {
          runId: run.id,
          owner: claim!.owner,
          generation: RoutineOwnerGeneration.make(claim!.generation),
          threadId: run.threadId,
          messageId: run.messageId,
          commandId: run.commandId,
        },
        60_001,
      );

      yield* store.recoverConsumed(60_002);
      const live = yield* store.history(environment, { id: routine.id });
      assert.equal(live.runs[0]?.status, "starting");

      yield* store.recoverConsumed(70_001);
      const recovered = yield* store.history(environment, { id: routine.id });
      assert.equal(recovered.runs[0]?.status, "needs-attention");
    }),
  );

  it.effect("keeps an approval waiting run active until the provider resolves it", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-approval-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-approval"),
          expectedRevision: 0,
          configuration,
        },
        90_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-approval"),
        },
        90_001,
      );
      const claim = yield* store.claim("approval-worker", 90_001);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(submission, 90_001);
      yield* store.bindProviderTurn(submission, "approval-turn", 90_002);
      yield* store.markWaitingForApproval(
        {
          threadId: run.threadId,
          turnId: TurnId.make("approval-turn"),
          detail: "Approve the file changes.",
        },
        90_003,
      );
      const waiting = yield* store.history(environment, { id: routine.id });
      assert.equal(waiting.runs[0]?.status, "waiting-for-approval");
      assert.equal(
        (yield* store.activeRuns()).some((active) => active.id === run.id),
        true,
      );
      yield* store.markProviderApprovalResolved(
        {
          threadId: run.threadId,
          turnId: TurnId.make("approval-turn"),
        },
        90_004,
      );
      const running = yield* store.history(environment, { id: routine.id });
      assert.equal(running.runs[0]?.status, "running");
      yield* store.recordProviderTerminal(
        {
          eventId: EventId.make("approval-terminal-event"),
          threadId: run.threadId,
          turnId: TurnId.make("approval-turn"),
          status: "succeeded",
        },
        90_005,
      );
      const completed = yield* store.history(environment, { id: routine.id });
      assert.equal(completed.runs[0]?.status, "succeeded");
    }),
  );
});
