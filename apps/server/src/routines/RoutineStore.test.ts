import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  MessageId,
  ModelSelection,
  ProjectId,
  RoutineConnectionId,
  RoutineId,
  RoutineOwnerGeneration,
  RoutineRequestId,
  RoutineRun,
  RuntimeMode,
  ThreadId,
  TurnId,
  type RoutineConnection,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { summarizeGitHubEvent } from "./GitHubRoutineEvents.ts";
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
const decodeRun = Schema.decodeUnknownSync(Schema.fromJsonString(RoutineRun));
const githubConfiguration = (connectionId: RoutineConnectionId) => ({
  ...configuration,
  trigger: {
    kind: "github" as const,
    connectionId,
    repositoryId: 42,
    event: "pr_opened" as const,
    includeDrafts: false,
  },
});
const githubConnection = (
  id: RoutineConnectionId,
  connectionEnvironmentId: EnvironmentId,
): RoutineConnection => ({
  id,
  environmentId: connectionEnvironmentId,
  provider: "github",
  repositoryId: 42,
  repositoryName: "acme/widgets",
  repositoryUrl: "https://github.com/acme/widgets",
  defaultBranch: "main",
  hookId: 1001,
  callbackUrl: `https://env.example/api/routines/webhooks/github/${id}`,
  status: "verified",
  lastDelivery: null,
  acceptedCount: 0,
  ignoredCount: 0,
  rejectedCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const prOpened = (number: number) =>
  summarizeGitHubEvent("pull_request", {
    action: "opened",
    repository: { id: 42, full_name: "acme/widgets" },
    sender: { login: "octocat" },
    pull_request: {
      id: 900 + number,
      number,
      title: `PR ${number}`,
      html_url: `https://github.com/acme/widgets/pull/${number}`,
      draft: false,
      base: { ref: "main" },
      labels: [],
    },
  });

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

  it.effect("keeps a handed-off submission when late preparation writes arrive", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const routine = yield* store.save(
        environmentId,
        { id: RoutineId.make("routine-handoff"), expectedRevision: 0, configuration },
        Date.parse("2026-01-01T00:00:00.000Z"),
      );
      const run = yield* store.testRun(
        environmentId,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-handoff"),
        },
        10_000,
      );
      const claim = yield* store.claim("worker-a", 10_000);
      assert.isNotNull(claim);
      yield* store.consumeSubmissionForProvider(
        {
          runId: run.id,
          owner: "worker-a",
          generation: RoutineOwnerGeneration.make(claim!.generation),
          threadId: run.threadId,
          messageId: run.messageId,
          commandId: run.commandId,
        },
        10_001,
      );

      assert.equal(yield* store.renew(claim!, 45_000), "handed-off");
      yield* store.updatePreparation(
        claim!,
        { stage: "prompt-accepted", status: "starting", detail: null },
        10_002,
      );
      yield* store.updatePreparation(
        claim!,
        { stage: "terminal", status: "blocked", detail: "late dispatcher failure" },
        10_003,
      );
      const markSetup = yield* store
        .markSetupComplete(claim!, 10_004)
        .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" }));

      assert.equal(markSetup, "lost-fence");
      const history = yield* store.history(environmentId, { id: routine.id });
      assert.deepEqual(
        history.runs.map(({ stage, status }) => ({ stage, status })),
        [{ stage: "submitting", status: "starting" }],
      );
      assert.isTrue((yield* store.activeRuns()).some((active) => active.id === run.id));
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

  it.effect("applies a permission wait that arrived before bindProviderTurn", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-early-approval-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-early-approval"),
          expectedRevision: 0,
          configuration,
        },
        91_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-early-approval"),
        },
        91_001,
      );
      const claim = yield* store.claim("early-approval-worker", 91_001);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(submission, 91_001);
      const buffered = yield* store.markWaitingForApproval(
        {
          threadId: run.threadId,
          turnId: TurnId.make("early-approval-turn"),
          detail: "Approve the command.",
        },
        91_002,
      );
      assert.isFalse(buffered);
      yield* store.bindProviderTurn(submission, "early-approval-turn", 91_003);
      const waiting = yield* store.history(environment, { id: routine.id });
      assert.equal(waiting.runs[0]?.status, "waiting-for-approval");
      assert.equal(waiting.runs[0]?.stage, "provider-bound");
    }),
  );

  it.effect("does not treat a buffered permission wait as terminal recovery evidence", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-approval-recover-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-approval-recover"),
          expectedRevision: 0,
          configuration,
        },
        91_100,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-approval-recover"),
        },
        91_101,
      );
      const claim = yield* store.claim("approval-recover-worker", 91_101);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(submission, 91_101);
      yield* store.markWaitingForApproval(
        {
          threadId: run.threadId,
          turnId: TurnId.make("approval-recover-turn"),
          detail: "Approve the command.",
        },
        91_102,
      );
      yield* store.recoverConsumed(91_103);
      const recovered = yield* store.history(environment, { id: routine.id });
      assert.equal(recovered.runs[0]?.stage, "submitting");
      assert.notEqual(recovered.runs[0]?.status, "waiting-for-approval");
      assert.notEqual(recovered.runs[0]?.stage, "terminal");
      yield* store.bindProviderTurn(submission, "approval-recover-turn", 91_104);
      const waiting = yield* store.history(environment, { id: routine.id });
      assert.equal(waiting.runs[0]?.status, "waiting-for-approval");
      assert.equal(waiting.runs[0]?.stage, "provider-bound");
    }),
  );

  it.effect("lets only one owner begin session preparation for a generation", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-prepare-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-prepare"),
          expectedRevision: 0,
          configuration,
        },
        92_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-prepare"),
        },
        92_001,
      );
      const claim = yield* store.claim("prepare-worker", 92_001);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      assert.isTrue(yield* store.beginSessionPreparation(submission));
      assert.isFalse(yield* store.beginSessionPreparation(submission));
    }),
  );

  it.effect("interrupts a bound run when its provider session exits", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-session-exit-environment");
      const routine = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-session-exit"),
          expectedRevision: 0,
          configuration,
        },
        93_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-session-exit"),
        },
        93_001,
      );
      const claim = yield* store.claim("session-exit-worker", 93_001);
      assert.isNotNull(claim);
      const submission = {
        runId: run.id,
        owner: claim!.owner,
        generation: RoutineOwnerGeneration.make(claim!.generation),
        threadId: run.threadId,
        messageId: run.messageId,
        commandId: run.commandId,
      };
      yield* store.consumeSubmissionForProvider(submission, 93_001);
      yield* store.bindProviderTurn(submission, "session-exit-turn", 93_002);
      assert.isTrue(
        yield* store.settleOnSessionExit(
          { threadId: run.threadId, detail: "session closed" },
          93_003,
        ),
      );
      const history = yield* store.history(environment, { id: routine.id });
      assert.equal(history.runs[0]?.status, "interrupted");
      assert.equal(history.runs[0]?.stage, "terminal");
      assert.equal(
        (yield* store.activeRuns()).some((active) => active.id === run.id),
        false,
      );
    }),
  );

  it.effect(
    "serves a routine from the database environment that owns it when a copied record names another environment",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const environmentA = EnvironmentId.make("routine-copy-source-environment");
        const environmentB = EnvironmentId.make("routine-copy-target-environment");
        const routine = yield* store.save(
          environmentA,
          {
            id: RoutineId.make("routine-copied-record"),
            expectedRevision: 0,
            configuration,
          },
          100_000,
        );
        yield* sql`UPDATE routines SET environment_id=${environmentB} WHERE id=${routine.id}`;
        const listed = yield* store.list(environmentB);
        assert.equal(listed.length, 1);
        assert.equal(listed[0]?.environmentId, environmentB);
        const missing = yield* store
          .get(environmentA, routine.id)
          .pipe(
            Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" as const }),
          );
        assert.equal(missing, "not-found");
        const served = yield* store.get(environmentB, routine.id);
        assert.equal(served.environmentId, environmentB);
      }),
  );

  it.effect(
    "admits a test run in the environment that serves the routine, not the environment in the copied record",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const environmentA = EnvironmentId.make("routine-copy-source-run-environment");
        const environmentB = EnvironmentId.make("routine-copy-target-run-environment");
        const routine = yield* store.save(
          environmentA,
          {
            id: RoutineId.make("routine-copied-run-record"),
            expectedRevision: 0,
            configuration,
          },
          100_100,
        );
        yield* sql`UPDATE routines SET environment_id=${environmentB} WHERE id=${routine.id}`;
        const run = yield* store.testRun(
          environmentB,
          {
            id: routine.id,
            expectedRevision: routine.revision,
            requestId: RoutineRequestId.make("request-copied-run"),
          },
          100_101,
        );
        assert.equal(run.environmentId, environmentB);
        const served = yield* store.history(environmentB, { id: routine.id });
        assert.equal(served.runs[0]?.id, run.id);
        const missing = yield* store
          .history(environmentA, { id: routine.id })
          .pipe(
            Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" as const }),
          );
        assert.equal(missing, "not-found");
        const stored = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE routine_id=${routine.id}`;
        assert.equal(stored.length, 1);
        assert.equal(decodeRun(stored[0]!.record).environmentId, environmentB);
      }),
  );

  it.effect("rejects a save whose id is already owned by another environment", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environmentA = EnvironmentId.make("routine-id-owner-environment");
      const environmentB = EnvironmentId.make("routine-id-collision-environment");
      const original = yield* store.save(
        environmentA,
        {
          id: RoutineId.make("routine-id-collision"),
          expectedRevision: 0,
          configuration,
        },
        100_200,
      );
      const result = yield* store
        .save(environmentB, { id: original.id, expectedRevision: 0, configuration }, 100_201)
        .pipe(
          Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" as const }),
        );
      assert.equal(result, "conflict");
      const served = yield* store.get(environmentA, original.id);
      assert.equal(served.environmentId, environmentA);
      assert.equal(served.revision, original.revision);
      assert.deepEqual(served.configuration, original.configuration);
    }),
  );

  it.effect(
    "admits a scheduled run under the environment that owns the row when a copied record names another environment",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const environmentA = EnvironmentId.make("routine-copy-source-schedule-environment");
        const environmentB = EnvironmentId.make("routine-copy-target-schedule-environment");
        const routine = yield* store.save(
          environmentA,
          {
            id: RoutineId.make("routine-copied-schedule-record"),
            expectedRevision: 0,
            configuration,
          },
          Date.parse("2026-02-01T08:00:00.000Z"),
        );
        yield* sql`UPDATE routines SET environment_id=${environmentB} WHERE id=${routine.id}`;
        const changes = () =>
          sql<{
            environmentId: EnvironmentId;
            count: number;
          }>`SELECT environment_id AS environmentId, COUNT(*) AS count FROM routine_changes
            WHERE environment_id IN (${environmentA}, ${environmentB}) GROUP BY environment_id`;
        const countFor = (
          rows: ReadonlyArray<{ environmentId: EnvironmentId; count: number }>,
          environmentId: EnvironmentId,
        ) => rows.find((row) => row.environmentId === environmentId)?.count ?? 0;
        const before = yield* changes();
        yield* store.tick("copy-schedule-worker", Date.parse("2026-02-01T12:00:00.000Z"));
        const runs = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE routine_id=${routine.id}`;
        assert.equal(runs.length, 1);
        assert.equal(decodeRun(runs[0]!.record).environmentId, environmentB);
        const after = yield* changes();
        assert.equal(countFor(after, environmentA), countFor(before, environmentA));
        assert.isAbove(countFor(after, environmentB), countFor(before, environmentB));
      }),
  );

  it.effect(
    "admits a webhook run under the environment that owns the routine row when a copied record names another environment",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const environmentA = EnvironmentId.make("routine-copy-source-event-environment");
        const environmentB = EnvironmentId.make("routine-copy-target-event-environment");
        const connectionId = RoutineConnectionId.make("routine-copied-event-connection");
        yield* store.saveConnection(githubConnection(connectionId, environmentA));
        const routine = yield* store.save(
          environmentA,
          {
            id: RoutineId.make("routine-copied-event-record"),
            expectedRevision: 0,
            configuration: githubConfiguration(connectionId),
          },
          100_300,
        );
        yield* sql`UPDATE routines SET environment_id=${environmentB} WHERE id=${routine.id}`;
        yield* sql`UPDATE routine_connections SET environment_id=${environmentB} WHERE id=${connectionId}`;
        // The copied database keeps the source environment in both records; the
        // target environment re-owns its inherited connection.
        yield* store.updateConnection(connectionId, (current) => ({
          ...current,
          environmentId: environmentB,
        }));
        const changes = () =>
          sql<{
            environmentId: EnvironmentId;
            count: number;
          }>`SELECT environment_id AS environmentId, COUNT(*) AS count FROM routine_changes
            WHERE environment_id IN (${environmentA}, ${environmentB}) GROUP BY environment_id`;
        const countFor = (
          rows: ReadonlyArray<{ environmentId: EnvironmentId; count: number }>,
          environmentId: EnvironmentId,
        ) => rows.find((row) => row.environmentId === environmentId)?.count ?? 0;
        const before = yield* changes();
        const admission = yield* store.admitEvent({
          connectionId,
          deliveryId: "delivery-copied-event",
          digest: "digest-copied-event",
          eventName: "pull_request",
          providerResourceId: 42,
          summary: prOpened(21),
          now: 100_400,
        });
        assert.equal(admission.status, "accepted");
        assert.equal(admission.runs.length, 1);
        assert.equal(admission.runs[0]?.environmentId, environmentB);
        const history = yield* store.history(environmentB, { id: routine.id });
        assert.equal(history.runs.length, 1);
        const stored = yield* sql<{
          record: string;
        }>`SELECT record FROM routine_runs WHERE routine_id=${routine.id}`;
        assert.equal(stored.length, 1);
        assert.equal(decodeRun(stored[0]!.record).environmentId, environmentB);
        const after = yield* changes();
        assert.equal(countFor(after, environmentA), countFor(before, environmentA));
        assert.isAbove(countFor(after, environmentB), countFor(before, environmentB));
      }),
  );

  it.effect(
    "does not hand back a stale environment when a copied webhook admission is replayed",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const environmentA = EnvironmentId.make("routine-copy-source-replay-environment");
        const environmentB = EnvironmentId.make("routine-copy-target-replay-environment");
        const connectionId = RoutineConnectionId.make("routine-copied-replay-connection");
        yield* store.saveConnection(githubConnection(connectionId, environmentA));
        const routine = yield* store.save(
          environmentA,
          {
            id: RoutineId.make("routine-copied-replay-record"),
            expectedRevision: 0,
            configuration: githubConfiguration(connectionId),
          },
          100_500,
        );
        const delivery = {
          connectionId,
          deliveryId: "delivery-copied-replay",
          digest: "digest-copied-replay",
          eventName: "pull_request",
          providerResourceId: 42,
          summary: prOpened(22),
          now: 100_501,
        };
        const first = yield* store.admitEvent(delivery);
        assert.equal(first.status, "accepted");
        assert.equal(first.runs.length, 1);
        assert.equal(first.runs[0]?.environmentId, environmentA);
        yield* sql`UPDATE routines SET environment_id=${environmentB} WHERE id=${routine.id}`;
        yield* sql`UPDATE routine_connections SET environment_id=${environmentB} WHERE id=${connectionId}`;
        // The copied database keeps the source environment in both records; the
        // target environment re-owns its inherited connection.
        yield* store.updateConnection(connectionId, (current) => ({
          ...current,
          environmentId: environmentB,
        }));
        // The original delivery falls outside the digest window, so the replay
        // reaches the existing-run branch with a record that still names A.
        const replayed = yield* store.admitEvent({
          ...delivery,
          now: delivery.now + 8 * 86_400_000,
        });
        assert.equal(replayed.status, "accepted");
        assert.equal(replayed.runs.length, 1);
        assert.equal(replayed.runs[0]?.environmentId, environmentB);
      }),
  );

  it.effect("delete removes the library row and keeps history without later scheduled starts", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-delete-ui-environment");
      const saved = yield* store.save(
        environment,
        {
          id: RoutineId.make("routine-delete-ui"),
          expectedRevision: 0,
          configuration,
        },
        Date.parse("2026-01-01T08:00:00.000Z"),
      );
      const run = yield* store.testRun(
        environment,
        {
          id: saved.id,
          expectedRevision: saved.revision,
          requestId: RoutineRequestId.make("request-delete-ui"),
        },
        Date.parse("2026-01-01T08:01:00.000Z"),
      );
      const deleted = yield* store.change(
        environment,
        { id: saved.id, expectedRevision: saved.revision, action: "delete" },
        Date.parse("2026-01-01T08:02:00.000Z"),
      );
      assert.equal(deleted.state, "deleted");
      assert.deepEqual(yield* store.list(environment), []);
      const history = yield* store.history(environment, { id: saved.id });
      assert.equal(history.runs[0]?.id, run.id);
      yield* store.tick("delete-ui-worker", Date.parse("2026-01-02T12:00:00.000Z"));
      const afterTick = yield* store.history(environment, { id: saved.id });
      assert.equal(afterTick.runs.length, 1);
      assert.equal(afterTick.runs[0]?.source, "test");
    }),
  );
});
