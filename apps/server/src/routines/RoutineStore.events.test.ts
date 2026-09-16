import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RoutineConnectionId,
  RoutineId,
  RuntimeMode,
  type RoutineConnection,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { summarizeGitHubEvent } from "./GitHubRoutineEvents.ts";
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

it.layer(storeLayer)("RoutineStore GitHub events", (it) => {
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
