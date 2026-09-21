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
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { summarizeGitHubEvent } from "./GitHubRoutineEvents.ts";
import { RoutineDispatcher } from "./RoutineDispatcher.ts";
import { RoutineScheduler, RoutineSchedulerLive } from "./RoutineScheduler.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";

const environmentId = EnvironmentId.make("routine-scheduler-environment");
const connectionId = RoutineConnectionId.make("connection-scheduler");
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
  projectId: ProjectId.make("routine-scheduler-project"),
  modelSelection: { instanceId: "codex", model: "gpt-5.4" } as ModelSelection,
  runtimeMode: "approval-required" as RuntimeMode,
  workspace: { kind: "shared" as const, directory: "/tmp/routine-scheduler" },
  trigger: {
    kind: "github" as const,
    connectionId,
    repositoryId: 42,
    event: "pr_opened" as const,
    includeDrafts: false,
  },
};

const storeLayer = RoutineStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
const dispatcherLayer = Layer.effect(
  RoutineDispatcher,
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    return {
      drain: (owner: string) =>
        Effect.gen(function* () {
          const now = yield* DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
          const claim = yield* store.claim(owner, now);
          if (claim === null) return;
          yield* store.updatePreparation(
            claim,
            { stage: "thread-created", status: "starting", detail: null },
            now,
          );
        }),
      dispatchClaim: () => Effect.void,
    };
  }),
);
const layer = RoutineSchedulerLive.pipe(
  Layer.provideMerge(dispatcherLayer),
  Layer.provideMerge(storeLayer),
);

it.live("claims a queued event run after the scheduler starts", () =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    const scheduler = yield* RoutineScheduler;
    const scope = yield* Scope.make("sequential");
    yield* Effect.addFinalizer(() => Scope.close(scope, Exit.void));
    yield* store.saveConnection(connection);
    const routine = yield* store.save(
      environmentId,
      { id: RoutineId.make("routine-scheduler"), expectedRevision: 0, configuration },
      1_000,
    );
    const admitted = yield* store.admitEvent({
      connectionId,
      deliveryId: "delivery-1",
      digest: "digest-delivery-1",
      eventName: "pull_request",
      providerResourceId: 42,
      summary: summarizeGitHubEvent("pull_request", {
        action: "opened",
        repository: { id: 42, full_name: "acme/widgets" },
        sender: { login: "octocat" },
        pull_request: {
          id: 907,
          number: 7,
          title: "PR 7",
          html_url: "https://github.com/acme/widgets/pull/7",
          draft: false,
          base: { ref: "main" },
          labels: [],
        },
      }),
      now: 2_000,
    });
    assert.equal(admitted.status, "accepted");
    assert.equal(admitted.runs[0]?.status, "queued");

    yield* scheduler.start.pipe(Scope.provide(scope));
    yield* scheduler.wake;

    let status = "queued";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const history = yield* store.history(environmentId, { id: routine.id });
      status = history.runs[0]?.status ?? "missing";
      if (status === "starting") break;
      yield* Effect.sleep("20 millis");
    }
    assert.equal(status, "starting");
  }).pipe(Effect.provide(layer)),
);
