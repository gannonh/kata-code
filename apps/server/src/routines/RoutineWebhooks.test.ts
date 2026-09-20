import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RoutineConnectionId,
  RoutineId,
  RuntimeMode,
  type RoutineConnection,
  type RoutineLinearMetadata,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpRouter } from "effect/unstable/http";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { RoutineScheduler } from "./RoutineScheduler.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";
import { linearWebhookSignature } from "./LinearRoutineEvents.ts";
import {
  ROUTINE_WEBHOOK_MAX_BODY_BYTES,
  isRoutineWebhookPath,
  linearWebhookRouteLayer,
  routineConnectionSecretName,
  routineLinearWebhookCallbackPath,
  routineWebhookCallbackPath,
  routineWebhookRouteLayer,
  signGitHubWebhookBody,
} from "./RoutineWebhooks.ts";

const environmentId = EnvironmentId.make("routine-webhook-environment");
const connectionId = RoutineConnectionId.make("connection-webhook");
const secret = new TextEncoder().encode("routine-webhook-secret");
const connection: RoutineConnection = {
  id: connectionId,
  environmentId,
  provider: "github",
  repositoryId: 42,
  repositoryName: "acme/widgets",
  repositoryUrl: "https://github.com/acme/widgets",
  defaultBranch: "main",
  hookId: 1001,
  callbackUrl: `https://env.example${routineWebhookCallbackPath(connectionId)}`,
  status: "pending",
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
  projectId: ProjectId.make("routine-webhook-project"),
  modelSelection: { instanceId: "codex", model: "gpt-5.4" } as ModelSelection,
  runtimeMode: "approval-required" as RuntimeMode,
  workspace: { kind: "shared" as const, directory: "/tmp/routine-webhook" },
  trigger: {
    kind: "github" as const,
    connectionId,
    repositoryId: 42,
    event: "pr_opened" as const,
    includeDrafts: false,
  },
};
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const prOpened = (number: number, repositoryId = 42) =>
  encodeJson({
    action: "opened",
    repository: { id: repositoryId, full_name: "acme/widgets" },
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

const linearConnectionId = RoutineConnectionId.make("connection-linear-webhook");
const linearSecret = new TextEncoder().encode("linear-webhook-secret");
const linearConnection: RoutineConnection = {
  id: linearConnectionId,
  environmentId,
  provider: "linear",
  workspaceId: "workspace-1",
  workspaceName: "Acme",
  teamIds: ["team-1"],
  allTeams: false,
  webhookId: "webhook-1",
  metadataAccess: "ok",
  callbackUrl: `https://env.example${routineLinearWebhookCallbackPath(linearConnectionId)}`,
  status: "pending",
  lastDelivery: null,
  acceptedCount: 0,
  ignoredCount: 0,
  rejectedCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const linearMetadata = {
  workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
  teams: [{ id: "team-1", name: "Kata", key: "KAT", visibility: "public" }],
  projects: [{ id: "project-1", name: "Kata Code", teamIds: ["team-1"] }],
  states: [],
  labels: [],
} satisfies RoutineLinearMetadata;
const LINEAR_TEST_TIME = 1_800_000_000_000;
const linearConfiguration = {
  ...configuration,
  name: "Linear triage",
  instruction: "Triage the Linear issue.",
  trigger: {
    kind: "linear" as const,
    connectionId: linearConnectionId,
    workspaceId: "workspace-1",
    event: "issue_created" as const,
    teamId: "team-1",
  },
};
const linearIssue = (input: {
  readonly deliveryId?: string;
  readonly event?: string;
  readonly signature?: string | null;
  readonly timestamp?: string | null;
  readonly bodyTimestamp?: number;
  readonly organizationId?: string;
  readonly data?: Record<string, unknown>;
  readonly path?: string;
}) =>
  Effect.gen(function* () {
    const body = encodeJson({
      action: "create",
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
        ...input.data,
      },
      organizationId: input.organizationId ?? "workspace-1",
      type: "Issue",
      webhookId: "webhook-1",
      webhookTimestamp: input.bodyTimestamp ?? LINEAR_TEST_TIME,
    });
    const bytes = new TextEncoder().encode(body);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "linear-delivery": input.deliveryId ?? "linear-delivery-1",
      "linear-event": input.event ?? "Issue",
    };
    if (input.signature !== null)
      headers["linear-signature"] = input.signature ?? linearWebhookSignature(linearSecret, bytes);
    if (input.timestamp !== null)
      headers["linear-timestamp"] =
        input.timestamp ?? String(input.bodyTimestamp ?? LINEAR_TEST_TIME);
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(
        input.path ?? routineLinearWebhookCallbackPath(linearConnectionId),
      ).pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyUint8Array(bytes, "application/json"),
      ),
    );
    const json = (yield* response.json) as { ok: boolean; status?: string; runIds?: string[] };
    return { status: response.status, json };
  });

const storeLayer = RoutineStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
const wakeCount = Ref.makeUnsafe(0);
const schedulerLayer = Layer.mock(RoutineScheduler)({
  owner: "routine-webhook-test",
  wake: Ref.update(wakeCount, (count) => count + 1),
});
const appLayer = HttpRouter.serve(Layer.merge(routineWebhookRouteLayer, linearWebhookRouteLayer), {
  disableListenLog: true,
  disableLogger: true,
}).pipe(
  Layer.provideMerge(storeLayer),
  Layer.provideMerge(
    ServerSecretStore.layer.pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-routine-webhook-" })),
    ),
  ),
  Layer.provide(schedulerLayer),
  Layer.provide(NodeServices.layer),
);

const post = (input: {
  readonly body: string | Uint8Array;
  readonly deliveryId?: string;
  readonly event?: string;
  readonly signature?: string | null;
  readonly path?: string;
}) =>
  Effect.gen(function* () {
    const body = typeof input.body === "string" ? new TextEncoder().encode(input.body) : input.body;
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-github-delivery": input.deliveryId ?? "delivery-1",
      "x-github-event": input.event ?? "pull_request",
    };
    if (input.signature !== null) {
      headers["x-hub-signature-256"] = input.signature ?? signGitHubWebhookBody(secret, body);
    }
    const response = yield* HttpClient.execute(
      HttpClientRequest.post(input.path ?? routineWebhookCallbackPath(connectionId)).pipe(
        HttpClientRequest.setHeaders(headers),
        HttpClientRequest.bodyUint8Array(body, "application/json"),
      ),
    );
    const json = (yield* response.json) as { ok: boolean; status?: string; runIds?: string[] };
    return { status: response.status, json };
  });

const seed = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  yield* store.saveConnection(connection);
  yield* secrets.set(routineConnectionSecretName(connectionId), secret);
  return yield* store.save(
    environmentId,
    { id: RoutineId.make("routine-webhook"), expectedRevision: 0, configuration },
    1_000,
  );
});

it.layer(appLayer.pipe(Layer.provideMerge(NodeHttpServer.layerTest)))(
  "routine webhook callback",
  (it) => {
    it.effect("records a signed delivery durably, answers 2xx, and wakes the dispatcher", () =>
      Effect.gen(function* () {
        const routine = yield* seed;
        const store = yield* RoutineStore;
        const ping = yield* post({
          body: encodeJson({ zen: "Keep it logically awesome.", repository: { id: 42 } }),
          event: "ping",
          deliveryId: "ping-1",
        });
        assert.equal(ping.status, 200);
        assert.equal((yield* store.getConnection(environmentId, connectionId)).status, "verified");

        const accepted = yield* post({ body: prOpened(7), deliveryId: "delivery-1" });
        assert.equal(accepted.status, 202);
        assert.equal(accepted.json.status, "accepted");
        assert.equal(accepted.json.runIds?.length, 1);
        assert.equal(yield* Ref.get(wakeCount), 1);
        const history = yield* store.history(environmentId, { id: routine.id });
        assert.equal(history.runs.length, 1);
        assert.equal(history.runs[0]!.source, "github");
        assert.equal(history.runs[0]!.status, "queued");

        // Redelivery and a replayed body under a new delivery id admit nothing.
        const redelivered = yield* post({ body: prOpened(7), deliveryId: "delivery-1" });
        assert.equal(redelivered.status, 200);
        assert.equal(redelivered.json.status, "duplicate");
        const replayed = yield* post({ body: prOpened(7), deliveryId: "delivery-replay" });
        assert.equal(replayed.json.status, "duplicate");
        assert.equal((yield* store.history(environmentId, { id: routine.id })).runs.length, 1);
        assert.equal(yield* Ref.get(wakeCount), 1);
      }),
    );

    it.effect("records a ping durably and deduplicates its signed body", () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const before = yield* store.getConnection(environmentId, connectionId);
        const body = encodeJson({ repository: { id: 42 }, zen: "Durable ping" });
        const response = yield* post({ body, event: "ping", deliveryId: "ping-durable" });
        assert.equal(response.status, 200);
        const rows = yield* sql<{ status: string }>`SELECT status FROM routine_deliveries
          WHERE connection_id=${connectionId} AND delivery_id='ping-durable'`;
        assert.equal(rows[0]?.status, "accepted");
        assert.equal(
          (yield* store.getConnection(environmentId, connectionId)).acceptedCount,
          before.acceptedCount + 1,
        );
        const replay = yield* post({ body, event: "ping", deliveryId: "ping-replay" });
        assert.equal(replay.json.status, "duplicate");
        assert.equal(
          (yield* store.getConnection(environmentId, connectionId)).acceptedCount,
          before.acceptedCount + 1,
        );
      }),
    );

    it.effect("rejects a signed ping for a different repository", () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const before = yield* store.getConnection(environmentId, connectionId);
        const response = yield* post({
          body: encodeJson({ repository: { id: 43 } }),
          event: "ping",
          deliveryId: "ping-wrong-repository",
        });
        assert.equal(response.status, 403);
        const after = yield* store.getConnection(environmentId, connectionId);
        assert.equal(after.rejectedCount, before.rejectedCount + 1);
        assert.equal(after.lastDelivery?.status, "rejected");
      }),
    );

    it.effect(
      "rejects unsigned, tampered, malformed, oversized, and wrong-repository requests",
      () =>
        Effect.gen(function* () {
          const store = yield* RoutineStore;
          const before = (yield* store.getConnection(environmentId, connectionId)).rejectedCount;
          assert.equal(
            (yield* post({ body: prOpened(8), signature: null, deliveryId: "d-unsigned" })).status,
            400,
          );
          assert.equal(
            (yield* post({ body: prOpened(8), signature: "sha256=deadbeef", deliveryId: "d-bad" }))
              .status,
            401,
          );
          const tamperedSignature = signGitHubWebhookBody(
            secret,
            new TextEncoder().encode(prOpened(8)),
          );
          assert.equal(
            (yield* post({
              body: prOpened(9),
              signature: tamperedSignature,
              deliveryId: "d-tampered",
            })).status,
            401,
          );
          assert.equal((yield* post({ body: "{not json", deliveryId: "d-malformed" })).status, 400);
          const oversized = new Uint8Array(ROUTINE_WEBHOOK_MAX_BODY_BYTES + 1).fill(0x20);
          assert.equal((yield* post({ body: oversized, deliveryId: "d-oversized" })).status, 413);
          assert.equal(
            (yield* post({ body: prOpened(8, 43), deliveryId: "d-wrong-repo" })).status,
            403,
          );
          assert.equal(
            (yield* post({
              body: prOpened(8),
              deliveryId: "d-unknown",
              path: routineWebhookCallbackPath("connection-unknown"),
            })).status,
            404,
          );
          const after = yield* store.getConnection(environmentId, connectionId);
          assert.equal(after.rejectedCount, before + 6);
          assert.equal(after.lastDelivery?.status, "rejected");
          const routineHistory = yield* store.history(environmentId, {
            id: RoutineId.make("routine-webhook"),
          });
          assert.equal(routineHistory.runs.length, 1);
        }),
    );

    it.effect("returns 503 instead of acknowledging a ping whose durable receipt fails", () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const before = yield* store.getConnection(environmentId, connectionId);
        yield* sql`CREATE TEMP TRIGGER fail_ping_receipt BEFORE INSERT ON routine_deliveries
          WHEN NEW.delivery_id='ping-write-failure'
          BEGIN SELECT RAISE(FAIL, 'simulated write failure'); END`;
        const response = yield* post({
          body: encodeJson({ repository: { id: 42 }, zen: "Failed durable write" }),
          event: "ping",
          deliveryId: "ping-write-failure",
        }).pipe(Effect.ensuring(sql`DROP TRIGGER fail_ping_receipt`.pipe(Effect.orDie)));
        assert.equal(response.status, 503);
        const rows =
          yield* sql`SELECT delivery_id FROM routine_deliveries WHERE delivery_id='ping-write-failure'`;
        assert.equal(rows.length, 0);
        const after = yield* store.getConnection(environmentId, connectionId);
        assert.equal(after.rejectedCount, before.rejectedCount + 1);
        assert.equal(after.lastDelivery?.status, "rejected");
        assert.equal(after.lastDelivery?.deliveryId, "ping-write-failure");
      }),
    );

    it.effect("admits nothing for a disabled connection even with a valid signature", () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        yield* store.updateConnection(connectionId, (current) => ({
          ...current,
          status: "disabled",
        }));
        const response = yield* post({ body: prOpened(10), deliveryId: "d-disabled" });
        assert.equal(response.status, 403);
        yield* store.updateConnection(connectionId, (current) => ({
          ...current,
          status: "verified",
        }));
      }),
    );

    it.effect("names the readiness-exempt path prefix", () =>
      Effect.sync(() => {
        assert.isTrue(isRoutineWebhookPath(routineWebhookCallbackPath("abc")));
        assert.isFalse(isRoutineWebhookPath("/api/routines"));
        assert.isFalse(isRoutineWebhookPath("/ws"));
      }),
    );
  },
);

it.layer(appLayer.pipe(Layer.provideMerge(NodeHttpServer.layerTest)))(
  "routine Linear webhook callback",
  (it) => {
    const seedLinear = Effect.gen(function* () {
      const store = yield* RoutineStore;
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      const existing = yield* store.findConnection(linearConnectionId);
      if (existing !== null) return;
      yield* store.saveConnection(linearConnection);
      yield* secrets.set(routineConnectionSecretName(linearConnectionId), linearSecret);
      yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-linear-webhook"),
          expectedRevision: 0,
          configuration: linearConfiguration,
        },
        1_000,
        { linearMetadata },
      );
    });

    it.effect("records a signed Linear delivery durably, answers 200, and dedupes replays", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(LINEAR_TEST_TIME);
        yield* seedLinear;
        const store = yield* RoutineStore;
        const routine = yield* store.get(environmentId, RoutineId.make("routine-linear-webhook"));
        const before = yield* Ref.get(wakeCount);
        const accepted = yield* linearIssue({ deliveryId: "linear-delivery-1" });
        assert.equal(accepted.status, 200);
        assert.equal(accepted.json.status, "accepted");
        assert.equal(accepted.json.runIds?.length, 1);
        assert.equal(yield* Ref.get(wakeCount), before + 1);
        const connection = yield* store.getConnection(environmentId, linearConnectionId);
        assert.equal(connection.status, "verified");
        assert.equal(connection.acceptedCount, 1);
        const history = yield* store.history(environmentId, { id: routine.id });
        assert.equal(history.runs.length, 1);
        assert.equal(history.runs[0]!.source, "linear");
        assert.equal(history.runs[0]!.status, "queued");

        // A provider retry reuses the delivery id; a replayed body with a fresh
        // header is suppressed by the signed-content digest.
        const retry = yield* linearIssue({ deliveryId: "linear-delivery-1" });
        assert.equal(retry.status, 200);
        assert.equal(retry.json.status, "duplicate");
        // A missing Linear-Timestamp header is not a mismatch; the signed body
        // timestamp is authoritative. The delivery is outside the connection's
        // team scope, so it is ignored rather than rejected.
        const withoutHeader = yield* linearIssue({
          deliveryId: "linear-delivery-no-header",
          timestamp: null,
          data: { id: "issue-no-header", identifier: "KAT-303", teamId: "team-2" },
        });
        assert.equal(withoutHeader.status, 200);
        assert.equal(withoutHeader.json.status, "ignored");
        const replay = yield* linearIssue({ deliveryId: "linear-delivery-replay" });
        assert.equal(replay.json.status, "duplicate");
        assert.equal((yield* store.history(environmentId, { id: routine.id })).runs.length, 1);
        assert.equal(yield* Ref.get(wakeCount), before + 1);
      }),
    );

    it.effect("rejects forged, stale, mismatched, oversized, and unknown deliveries", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(LINEAR_TEST_TIME);
        yield* seedLinear;
        const store = yield* RoutineStore;
        const before = (yield* store.getConnection(environmentId, linearConnectionId))
          .rejectedCount;
        assert.equal(
          (yield* linearIssue({ signature: null, deliveryId: "linear-unsigned" })).status,
          400,
        );
        assert.equal(
          (yield* linearIssue({ signature: "deadbeef", deliveryId: "linear-forged" })).status,
          401,
        );
        const stale = LINEAR_TEST_TIME - 120_000;
        assert.equal(
          (yield* linearIssue({
            bodyTimestamp: stale,
            timestamp: String(stale),
            deliveryId: "linear-stale",
          })).status,
          401,
        );
        assert.equal(
          (yield* linearIssue({ timestamp: "1", deliveryId: "linear-timestamp-mismatch" })).status,
          400,
        );
        assert.equal(
          (yield* linearIssue({ event: "Comment", deliveryId: "linear-event-mismatch" })).status,
          400,
        );
        assert.equal(
          (yield* linearIssue({
            organizationId: "workspace-2",
            deliveryId: "linear-wrong-workspace",
          })).status,
          403,
        );
        const rawPost = (raw: Uint8Array, deliveryId: string) =>
          HttpClient.execute(
            HttpClientRequest.post(routineLinearWebhookCallbackPath(linearConnectionId)).pipe(
              HttpClientRequest.setHeaders({
                "linear-delivery": deliveryId,
                "linear-event": "Issue",
                "linear-signature": linearWebhookSignature(linearSecret, raw),
              }),
              HttpClientRequest.bodyUint8Array(raw, "application/json"),
            ),
          );
        const malformed = new TextEncoder().encode("{not json");
        assert.equal((yield* rawPost(malformed, "linear-malformed")).status, 400);
        const oversized = new Uint8Array(ROUTINE_WEBHOOK_MAX_BODY_BYTES + 1).fill(0x20);
        assert.equal((yield* rawPost(oversized, "linear-oversized")).status, 413);
        assert.equal(
          (yield* linearIssue({
            deliveryId: "linear-unknown",
            path: routineLinearWebhookCallbackPath("connection-unknown"),
          })).status,
          404,
        );
        const after = yield* store.getConnection(environmentId, linearConnectionId);
        assert.equal(after.rejectedCount, before + 8);
        assert.equal(after.lastDelivery?.status, "rejected");
      }),
    );

    it.effect("admits nothing for a disabled Linear connection even with a valid signature", () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(LINEAR_TEST_TIME);
        yield* seedLinear;
        const store = yield* RoutineStore;
        yield* store.updateConnection(linearConnectionId, (current) => ({
          ...current,
          status: "disabled",
        }));
        const before = yield* store.getConnection(environmentId, linearConnectionId);
        const response = yield* linearIssue({
          deliveryId: "linear-disabled",
          data: { id: "issue-disabled", identifier: "KAT-202" },
        });
        assert.equal(response.status, 403);
        const after = yield* store.getConnection(environmentId, linearConnectionId);
        assert.equal(after.acceptedCount, before.acceptedCount);
        assert.equal(after.rejectedCount, before.rejectedCount + 1);
      }),
    );
  },
);
