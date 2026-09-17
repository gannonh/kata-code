import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RoutineConnectionId,
  RoutineId,
  RoutineOwnerGeneration,
  RuntimeMode,
  type RoutineConnection,
  type RoutineDraft,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { summarizeGitHubEvent } from "./GitHubRoutineEvents.ts";
import { summarizeLinearEvent } from "./LinearRoutineEvents.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";

const environmentId = EnvironmentId.make("routine-events-environment");
const connectionId = RoutineConnectionId.make("connection-events");
const connection: RoutineConnection = {
  id: connectionId,
  environmentId,
  provider: "github",
  repositoryId: 42,
  repositoryName: "acme/widgets",
  repositoryUrl: "https://github.com/acme/widgets",
  defaultBranch: "main",
  hookId: 1001,
  callbackUrl: `https://env.example/api/routines/webhooks/github/${connectionId}`,
  status: "verified",
  lastDelivery: null,
  acceptedCount: 0,
  ignoredCount: 0,
  rejectedCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const configuration = {
  name: "PR reviewer",
  instruction: "Review the pull request.",
  projectId: ProjectId.make("routine-events-project"),
  modelSelection: { instanceId: "codex", model: "gpt-5.4" } as ModelSelection,
  runtimeMode: "approval-required" as RuntimeMode,
  workspace: { kind: "shared" as const, directory: "/tmp/routine-events" },
  trigger: {
    kind: "github" as const,
    connectionId,
    repositoryId: 42,
    event: "pr_opened" as const,
    includeDrafts: false,
  },
};
const prOpened = (number: number, deliveryId: string) => ({
  deliveryId,
  digest: `digest-${deliveryId}`,
  eventName: "pull_request",
  providerResourceId: 42,
  summary: summarizeGitHubEvent("pull_request", {
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
  }),
});
const DAY = 86_400_000;
const storeLayer = Layer.mergeAll(
  RoutineStoreLive.pipe(Layer.provide(SqlitePersistenceMemory)),
  SqlitePersistenceMemory,
);

const linearConnectionId = RoutineConnectionId.make("connection-linear-events");
const linearConnection: RoutineConnection = {
  id: linearConnectionId,
  environmentId,
  provider: "linear",
  workspaceId: "workspace-1",
  workspaceName: "Acme",
  teamIds: ["team-1"],
  allTeams: false,
  metadataAccess: "ok",
  callbackUrl: `https://env.example/api/routines/webhooks/linear/${linearConnectionId}`,
  status: "pending",
  lastDelivery: null,
  acceptedCount: 0,
  ignoredCount: 0,
  rejectedCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const linearConfiguration = (trigger: RoutineDraft["trigger"]): RoutineDraft => ({
  ...configuration,
  name: "Linear triage",
  instruction: "Triage the Linear issue.",
  trigger,
});
const linearPayload = (
  action: "create" | "update",
  data: Record<string, unknown>,
  updatedFrom?: Record<string, unknown>,
) => ({
  action,
  actor: { id: "user-1", type: "user", name: "Alice" },
  data: {
    id: "issue-1",
    identifier: "KAT-101",
    title: "Ship the Linear slice",
    url: "https://linear.app/acme/issue/KAT-101",
    teamId: "team-1",
    projectId: "project-1",
    stateId: "state-todo",
    labelIds: [],
    ...data,
  },
  organizationId: "workspace-1",
  type: "Issue",
  webhookId: "webhook-1",
  webhookTimestamp: 1_800_000_000_000,
  ...(updatedFrom === undefined ? {} : { updatedFrom }),
});
const linearEvent = (deliveryId: string, payload: unknown) => {
  const summarized = summarizeLinearEvent(payload);
  return {
    deliveryId,
    digest: `digest-${deliveryId}`,
    eventName: "Issue",
    providerResourceId: "workspace-1",
    summary: summarized.kind === "event" ? summarized.summary : null,
    ...(summarized.kind === "ignored" ? { ignoredDetail: summarized.detail } : {}),
  };
};

it.layer(storeLayer)("RoutineStore GitHub events", (it) => {
  it.effect("resumes exactly one event run after a crash and reports uncertainty", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-recovery");
      yield* store.saveConnection({ ...connection, id });
      const routine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-event-recovery"),
          expectedRevision: 0,
          configuration: {
            ...configuration,
            trigger: { ...configuration.trigger, connectionId: id },
          },
        },
        1_000,
      );
      const admission = yield* store.admitEvent({
        connectionId: id,
        ...prOpened(21, "delivery-recovery"),
        now: 2_000,
      });
      assert.equal(admission.runs.length, 1);
      const run = admission.runs[0]!;
      const claim = yield* store.claim("owner-after-restart", 3_000);
      assert.equal(claim?.run.id, run.id);
      yield* store.consumeSubmissionForProvider(
        {
          runId: run.id,
          owner: claim!.owner,
          generation: RoutineOwnerGeneration.make(claim!.generation),
          threadId: run.threadId,
          messageId: run.messageId,
          commandId: run.commandId,
        },
        3_001,
      );
      yield* store.recoverConsumed(4_000);
      const history = yield* store.history(environmentId, { id: routine.id });
      assert.equal(history.runs.length, 1);
      assert.equal(history.runs[0]?.status, "needs-attention");
      // GitHub's redelivery of the same event cannot add a second run after restart.
      const replay = yield* store.admitEvent({
        connectionId: id,
        ...prOpened(21, "delivery-recovery"),
        now: 5_000,
      });
      assert.equal(replay.status, "duplicate");
      const afterReplay = yield* store.history(environmentId, { id: routine.id });
      assert.equal(afterReplay.runs.length, 1);
    }),
  );

  it.effect("refuses to replace an existing connection with a reused id", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const original = { ...connection, id: RoutineConnectionId.make("connection-collision") };
      yield* store.saveConnection(original);
      const result = yield* store
        .saveConnection({
          ...original,
          environmentId: EnvironmentId.make("different-environment"),
          repositoryId: 99,
        })
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      assert.deepEqual(yield* store.getConnection(environmentId, original.id), original);
    }),
  );

  it.effect("never selects an event routine as due and rejects unknown connections", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const missing = yield* store
        .save(
          environmentId,
          { id: RoutineId.make("routine-no-connection"), expectedRevision: 0, configuration },
          1_000,
        )
        .pipe(Effect.flip);
      assert.equal(missing.code, "validation");
      yield* store.saveConnection(connection);
      const routine = yield* store.save(
        environmentId,
        { id: RoutineId.make("routine-event-due"), expectedRevision: 0, configuration },
        1_000,
      );
      assert.equal(routine.nextDueAt, "9999-12-31T00:00:00.000Z");
      yield* store.tick("worker-events", Date.parse("9999-12-31T01:00:00.000Z"));
      const history = yield* store.history(environmentId, { id: routine.id });
      assert.deepEqual(history.runs, []);
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        trigger_kind: string;
      }>`SELECT trigger_kind FROM routines WHERE id=${routine.id}`;
      assert.equal(rows[0]?.trigger_kind, "github");
    }),
  );

  it.effect("admits one run per delivery and dedupes redelivery and replayed bodies", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const connectionId = RoutineConnectionId.make("connection-dedupe");
      yield* store.saveConnection({ ...connection, id: connectionId });
      const routine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-event-dedupe"),
          expectedRevision: 0,
          configuration: { ...configuration, trigger: { ...configuration.trigger, connectionId } },
        },
        1_000,
      );
      const first = yield* store.admitEvent({
        connectionId,
        ...prOpened(7, "delivery-1"),
        now: 2_000,
      });
      assert.equal(first.status, "accepted");
      assert.equal(first.runs.length, 1);
      assert.equal(first.runs[0]!.source, "github");
      assert.equal(first.runs[0]!.sourceUrl, "https://github.com/acme/widgets/pull/7");
      assert.include(first.runs[0]!.eventContext ?? "", "untrusted");
      assert.equal(first.runs[0]!.status, "queued");

      // GitHub redelivery reuses the delivery id.
      const redelivered = yield* store.admitEvent({
        connectionId,
        ...prOpened(7, "delivery-1"),
        now: 3_000,
      });
      assert.equal(redelivered.status, "duplicate");
      assert.equal(redelivered.runs.length, 0);
      // A replayed signed body under a fresh delivery header carries the same digest.
      const replayed = yield* store.admitEvent({
        connectionId,
        ...prOpened(7, "delivery-1"),
        deliveryId: "delivery-forged",
        now: 3_500,
      });
      assert.equal(replayed.status, "duplicate");
      assert.equal(replayed.runs.length, 0);

      // A distinct event on the same resource admits exactly one additional record;
      // the active slot rule from scheduled routines still applies.
      const second = yield* store.admitEvent({
        connectionId,
        ...prOpened(7, "delivery-2"),
        now: 4_000,
      });
      assert.equal(second.status, "accepted");
      assert.equal(second.runs.length, 1);
      assert.equal(second.runs[0]!.status, "skipped");
      const history = yield* store.history(environmentId, { id: routine.id });
      assert.equal(history.runs.length, 2);

      const saved = yield* store.getConnection(environmentId, connectionId);
      assert.equal(saved.acceptedCount, 2);
      assert.equal(saved.lastDelivery?.deliveryId, "delivery-2");
      assert.equal(saved.lastDelivery?.status, "accepted");
    }),
  );

  it.effect("ignores non-matching, paused, and unsupported deliveries and counts them", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      yield* store.saveConnection({
        ...connection,
        id: RoutineConnectionId.make("connection-ignore"),
      });
      const ignoreConnectionId = RoutineConnectionId.make("connection-ignore");
      const routine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-event-ignore"),
          expectedRevision: 0,
          configuration: {
            ...configuration,
            trigger: {
              ...configuration.trigger,
              connectionId: ignoreConnectionId,
              branch: "release",
            },
          },
        },
        1_000,
      );
      const wrongBranch = yield* store.admitEvent({
        connectionId: ignoreConnectionId,
        ...prOpened(1, "delivery-ignored"),
        now: 2_000,
      });
      assert.equal(wrongBranch.status, "ignored");
      const unsupported = yield* store.admitEvent({
        connectionId: ignoreConnectionId,
        deliveryId: "delivery-unsupported",
        digest: "digest-unsupported",
        eventName: "push",
        providerResourceId: 42,
        summary: null,
        now: 2_500,
      });
      assert.equal(unsupported.status, "ignored");
      yield* store.change(
        environmentId,
        { id: routine.id, expectedRevision: routine.revision, action: "pause" },
        3_000,
      );
      const paused = yield* store.admitEvent({
        connectionId: ignoreConnectionId,
        ...prOpened(2, "delivery-paused"),
        summary: {
          ...prOpened(2, "delivery-paused").summary!,
          branch: "release",
        },
        now: 4_000,
      });
      assert.equal(paused.status, "ignored");
      yield* store.recordRejectedDelivery(
        ignoreConnectionId,
        { deliveryId: "delivery-bad", event: "pull_request", detail: "Signature mismatch." },
        5_000,
      );
      const saved = yield* store.getConnection(environmentId, ignoreConnectionId);
      assert.equal(saved.ignoredCount, 3);
      assert.equal(saved.rejectedCount, 1);
      assert.equal(saved.lastDelivery?.status, "rejected");
      const history = yield* store.history(environmentId, { id: routine.id });
      assert.deepEqual(history.runs, []);
    }),
  );

  it.effect("rejects deliveries for another repository or a disabled connection", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-reject");
      yield* store.saveConnection({ ...connection, id });
      yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-event-reject"),
          expectedRevision: 0,
          configuration: {
            ...configuration,
            trigger: { ...configuration.trigger, connectionId: id },
          },
        },
        1_000,
      );
      const wrongRepository = yield* store.admitEvent({
        connectionId: id,
        ...prOpened(1, "delivery-wrong-repository"),
        providerResourceId: 99,
        now: 2_000,
      });
      assert.equal(wrongRepository.status, "rejected");
      assert.equal(wrongRepository.runs.length, 0);
      if (wrongRepository.status === "rejected") {
        assert.equal(wrongRepository.reason, "wrong-resource");
        assert.equal(wrongRepository.detail, "Delivery names a different repository.");
      }
      yield* store.updateConnection(id, (current) => ({ ...current, status: "disabled" }));
      const disabled = yield* store.admitEvent({
        connectionId: id,
        ...prOpened(2, "delivery-disabled"),
        now: 3_000,
      });
      assert.equal(disabled.status, "rejected");
      if (disabled.status === "rejected") {
        assert.equal(disabled.reason, "disabled");
        assert.equal(disabled.detail, "Connection is disabled.");
      }
      const saved = yield* store.getConnection(environmentId, id);
      assert.equal(saved.rejectedCount, 2);
      assert.equal(saved.acceptedCount, 0);
      assert.equal(saved.lastDelivery?.status, "rejected");
      const history = yield* store.history(environmentId, {
        id: RoutineId.make("routine-event-reject"),
      });
      assert.deepEqual(history.runs, []);
    }),
  );

  it.effect("prunes delivery digests older than seven days on an accepted delivery", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const pruneConnectionId = RoutineConnectionId.make("connection-prune");
      yield* store.saveConnection({ ...connection, id: pruneConnectionId });
      yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-event-prune"),
          expectedRevision: 0,
          configuration: {
            ...configuration,
            trigger: { ...configuration.trigger, connectionId: pruneConnectionId },
          },
        },
        1_000,
      );
      const old = yield* store.admitEvent({
        connectionId: pruneConnectionId,
        ...prOpened(1, "delivery-old"),
        now: 10_000,
      });
      assert.equal(old.status, "accepted");
      const later = yield* store.admitEvent({
        connectionId: pruneConnectionId,
        ...prOpened(2, "delivery-new"),
        now: 10_000 + 8 * DAY,
      });
      assert.equal(later.status, "accepted");
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        delivery_id: string;
      }>`SELECT delivery_id FROM routine_deliveries WHERE connection_id=${pruneConnectionId} ORDER BY delivery_id`;
      assert.deepEqual(
        rows.map((row) => row.delivery_id),
        ["delivery-new"],
      );
      // The pruned digest is no longer suppressed; the same body admits again.
      const again = yield* store.admitEvent({
        connectionId: pruneConnectionId,
        ...prOpened(1, "delivery-old-again"),
        now: 10_000 + 8 * DAY + 1,
      });
      assert.equal(again.status, "accepted");
    }),
  );

  it.effect("bounds the untrusted delivery headers stored for rejected requests", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-rejected-header");
      yield* store.saveConnection({ ...connection, id });
      const oversized = "x".repeat(4_000);
      yield* store.recordRejectedDelivery(
        id,
        { deliveryId: oversized, event: oversized, detail: "Signature verification failed." },
        2_000,
      );
      const saved = yield* store.getConnection(environmentId, id);
      assert.equal(saved.rejectedCount, 1);
      assert.equal(saved.lastDelivery?.status, "rejected");
      assert.equal(saved.lastDelivery?.deliveryId.length, 128);
      assert.equal(saved.lastDelivery?.event.length, 128);
    }),
  );

  it.effect("expires a digest after seven days without requiring an intervening delivery", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-expired-digest");
      yield* store.saveConnection({ ...connection, id });
      yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-expired-digest"),
          expectedRevision: 0,
          configuration: {
            ...configuration,
            trigger: { ...configuration.trigger, connectionId: id },
          },
        },
        1000,
      );
      yield* store.admitEvent({
        connectionId: id,
        ...prOpened(1, "digest-first"),
        digest: "same-body",
        now: 10000,
      });
      const replay = yield* store.admitEvent({
        connectionId: id,
        ...prOpened(1, "digest-expired"),
        digest: "same-body",
        now: 10000 + 8 * DAY,
      });
      assert.equal(replay.status, "accepted");
      assert.equal(replay.runs.length, 1);
    }),
  );
});

it.layer(storeLayer)("RoutineStore Linear events", (it) => {
  it.effect(
    "admits one Linear run per delivery, verifies the connection, and ignores replays",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const id = RoutineConnectionId.make("connection-linear-create");
        yield* store.saveConnection({ ...linearConnection, id });
        const routine = yield* store.save(
          environmentId,
          {
            id: RoutineId.make("routine-linear-create"),
            expectedRevision: 0,
            configuration: linearConfiguration({
              kind: "linear",
              connectionId: id,
              workspaceId: "workspace-1",
              event: "issue_created",
              teamId: "team-1",
            }),
          },
          1_000,
        );
        const created = linearEvent("linear-delivery-1", linearPayload("create", {}));
        const first = yield* store.admitEvent({ connectionId: id, ...created, now: 2_000 });
        assert.equal(first.status, "accepted");
        assert.equal(first.runs.length, 1);
        assert.equal(first.runs[0]!.source, "linear");
        assert.equal(first.runs[0]!.sourceUrl, "https://linear.app/acme/issue/KAT-101");
        assert.include(first.runs[0]!.eventContext ?? "", "untrusted");
        assert.equal(first.runs[0]!.occurrenceKey, "linear:linear-delivery-1");

        const saved = yield* store.getConnection(environmentId, id);
        assert.equal(saved.status, "verified");
        assert.equal(saved.acceptedCount, 1);

        // Linear redelivery reuses the delivery id and must not admit again.
        const redelivered = yield* store.admitEvent({ connectionId: id, ...created, now: 3_000 });
        assert.equal(redelivered.status, "duplicate");
        assert.equal(redelivered.runs.length, 0);

        // An update whose final state matches but carries no transition evidence is ignored.
        const routineId = routine.id;
        const update = linearEvent(
          "linear-delivery-2",
          linearPayload("update", { stateId: "state-done" }, {}),
        );
        const ignored = yield* store.admitEvent({ connectionId: id, ...update, now: 4_000 });
        assert.equal(ignored.status, "ignored");
        assert.equal(ignored.runs.length, 0);
        const after = yield* store.getConnection(environmentId, id);
        assert.equal(after.lastDelivery?.status, "ignored");
        assert.include(after.lastDelivery?.detail ?? "", "transition");
        assert.equal((yield* store.history(environmentId, { id: routineId })).runs.length, 1);
      }),
  );

  it.effect("matches status transitions and label additions, one run per matching routine", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const id = RoutineConnectionId.make("connection-linear-update");
      yield* store.saveConnection({ ...linearConnection, id });
      yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-linear-status"),
          expectedRevision: 0,
          configuration: linearConfiguration({
            kind: "linear",
            connectionId: id,
            workspaceId: "workspace-1",
            event: "status_changed",
            stateId: "state-done",
            teamId: "team-1",
          }),
        },
        1_000,
      );
      yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-linear-label-bug"),
          expectedRevision: 0,
          configuration: linearConfiguration({
            kind: "linear",
            connectionId: id,
            workspaceId: "workspace-1",
            event: "label_added",
            labelId: "label-bug",
          }),
        },
        1_100,
      );
      yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-linear-label-urgent"),
          expectedRevision: 0,
          configuration: linearConfiguration({
            kind: "linear",
            connectionId: id,
            workspaceId: "workspace-1",
            event: "label_added",
            labelId: "label-urgent",
          }),
        },
        1_200,
      );

      const transition = linearEvent(
        "linear-delivery-transition",
        linearPayload(
          "update",
          { stateId: "state-done", labelIds: ["label-bug", "label-urgent"] },
          { stateId: "state-todo", labelIds: [] },
        ),
      );
      const admitted = yield* store.admitEvent({ connectionId: id, ...transition, now: 2_000 });
      assert.equal(admitted.status, "accepted");
      // One delivery admits at most one run per routine: the status routine and
      // each matching label routine, and never two runs for the same routine.
      assert.equal(admitted.runs.length, 3);
      assert.deepEqual(admitted.runs.map((run) => run.routineId).sort(), [
        "routine-linear-label-bug",
        "routine-linear-label-urgent",
        "routine-linear-status",
      ]);

      const removal = linearEvent(
        "linear-delivery-removal",
        linearPayload("update", { labelIds: [] }, { labelIds: ["label-bug"] }),
      );
      const ignored = yield* store.admitEvent({ connectionId: id, ...removal, now: 3_000 });
      assert.equal(ignored.status, "ignored");
      assert.equal(ignored.runs.length, 0);
    }),
  );

  it.effect(
    "rejects another workspace and a disabled connection, and ignores out-of-scope teams",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const id = RoutineConnectionId.make("connection-linear-scope");
        yield* store.saveConnection({ ...linearConnection, id });
        yield* store.save(
          environmentId,
          {
            id: RoutineId.make("routine-linear-scope"),
            expectedRevision: 0,
            configuration: linearConfiguration({
              kind: "linear",
              connectionId: id,
              workspaceId: "workspace-1",
              event: "issue_created",
            }),
          },
          1_000,
        );
        const wrongWorkspace = yield* store.admitEvent({
          connectionId: id,
          ...linearEvent("linear-delivery-wrong-workspace", linearPayload("create", {})),
          providerResourceId: "workspace-2",
          now: 2_000,
        });
        assert.equal(wrongWorkspace.status, "rejected");
        if (wrongWorkspace.status === "rejected") {
          assert.equal(wrongWorkspace.reason, "wrong-resource");
          assert.include(wrongWorkspace.detail, "workspace");
        }
        // A team-scoped webhook cannot silently expand: another team is ignored.
        const otherTeam = yield* store.admitEvent({
          connectionId: id,
          ...linearEvent(
            "linear-delivery-other-team",
            linearPayload("create", { teamId: "team-2" }),
          ),
          now: 2_500,
        });
        assert.equal(otherTeam.status, "ignored");
        assert.equal(otherTeam.runs.length, 0);
        const afterTeam = yield* store.getConnection(environmentId, id);
        assert.include(afterTeam.lastDelivery?.detail ?? "", "team");
        yield* store.updateConnection(id, (current) => ({ ...current, status: "disabled" }));
        const disabled = yield* store.admitEvent({
          connectionId: id,
          ...linearEvent("linear-delivery-disabled", linearPayload("create", {})),
          now: 3_000,
        });
        assert.equal(disabled.status, "rejected");
        if (disabled.status === "rejected") assert.equal(disabled.reason, "disabled");
      }),
  );
});
