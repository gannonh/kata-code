import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  RoutineConnectionId,
  RoutineId,
  RoutineError,
  RoutineRequestId,
  RoutineRun,
  RuntimeMode,
  type RoutineConnection,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
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
  RoutineStoreLive.pipe(Layer.provide(SqlitePersistence.layerMemory)),
  SqlitePersistence.layerMemory,
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
const linearConfiguration = (connectionId: RoutineConnectionId, teamId: string) => ({
  ...configuration,
  trigger: {
    kind: "linear" as const,
    connectionId,
    workspaceId: "workspace-1",
    teamId,
    event: "issue_created" as const,
  },
});
const linearConnection = (
  id: RoutineConnectionId,
  connectionEnvironmentId: EnvironmentId,
  options: { readonly allTeams?: boolean; readonly teamIds?: ReadonlyArray<string> } = {},
): RoutineConnection => ({
  id,
  environmentId: connectionEnvironmentId,
  provider: "linear",
  workspaceId: "workspace-1",
  workspaceName: "Acme",
  teamIds: [...(options.teamIds ?? [])],
  allTeams: options.allTeams ?? true,
  webhookId: "linear-webhook-1",
  metadataAccess: "ok",
  callbackUrl: `https://env.example/api/routines/webhooks/linear/${id}`,
  status: "verified",
  lastDelivery: null,
  acceptedCount: 0,
  ignoredCount: 0,
  rejectedCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const linearMetadata = {
  workspace: { id: "workspace-1", name: "Acme", urlKey: "acme" },
  teams: [
    { id: "team-public", name: "Public", key: "PUB", visibility: "public" as const },
    { id: "team-public-b", name: "Public B", key: "PUBB", visibility: "public" as const },
    { id: "team-private", name: "Private", key: "PRI", visibility: "private" as const },
  ],
  projects: [
    { id: "project-public", name: "Public project", teamIds: ["team-public"] },
    { id: "project-public-b", name: "Public B project", teamIds: ["team-public-b"] },
    { id: "project-private", name: "Private project", teamIds: ["team-private"] },
    {
      id: "project-mixed",
      name: "Mixed project",
      teamIds: ["team-public", "team-private"],
    },
  ],
  states: [
    { id: "state-public", name: "Public state", teamId: "team-public", type: "started" },
    { id: "state-public-b", name: "Public B state", teamId: "team-public-b", type: "started" },
    { id: "state-private", name: "Private state", teamId: "team-private", type: "started" },
  ],
  labels: [
    { id: "label-global", name: "Global label", teamId: null },
    { id: "label-public", name: "Public label", teamId: "team-public" },
    { id: "label-public-b", name: "Public B label", teamId: "team-public-b" },
    { id: "label-private", name: "Private label", teamId: "team-private" },
  ],
};
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
  it.effect("validates Linear resource filters against the connection team scope", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const allPublicConnectionId = RoutineConnectionId.make("linear-all-public-save");
      yield* store.saveConnection(linearConnection(allPublicConnectionId, environmentId));

      const missingMetadata = yield* store
        .save(
          environmentId,
          {
            id: RoutineId.make("routine-linear-missing-public-metadata"),
            expectedRevision: 0,
            configuration: linearConfiguration(allPublicConnectionId, "team-public"),
          },
          1_000,
        )
        .pipe(Effect.flip);
      assert.equal(missingMetadata.code, "validation");
      assert.include(missingMetadata.message, "Refresh Linear workspace metadata");

      const publicRoutine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-linear-public-team"),
          expectedRevision: 0,
          configuration: linearConfiguration(allPublicConnectionId, "team-public"),
        },
        1_001,
        { linearMetadata },
      );
      assert.equal(publicRoutine.configuration.trigger.kind, "linear");

      const privateTeam = yield* store
        .save(
          environmentId,
          {
            id: RoutineId.make("routine-linear-private-team"),
            expectedRevision: 0,
            configuration: linearConfiguration(allPublicConnectionId, "team-private"),
          },
          1_002,
          { linearMetadata },
        )
        .pipe(Effect.flip);
      assert.equal(privateTeam.code, "validation");
      assert.include(privateTeam.message, "connection's scope");

      const scopedConnectionId = RoutineConnectionId.make("linear-scoped-save");
      yield* store.saveConnection(
        linearConnection(scopedConnectionId, environmentId, {
          allTeams: false,
          teamIds: ["team-private"],
        }),
      );
      const scopedRoutine = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-linear-private-scoped"),
          expectedRevision: 0,
          configuration: linearConfiguration(scopedConnectionId, "team-private"),
        },
        1_003,
        { linearMetadata },
      );
      assert.equal(scopedRoutine.configuration.trigger.kind, "linear");
      if (scopedRoutine.configuration.trigger.kind === "linear")
        assert.equal(scopedRoutine.configuration.trigger.teamId, "team-private");

      const privateResourceTriggers = [
        {
          id: "project",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            projectId: "project-private",
            event: "issue_created" as const,
          },
        },
        {
          id: "state",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            event: "status_changed" as const,
            stateId: "state-private",
          },
        },
        {
          id: "label",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            event: "label_added" as const,
            labelId: "label-private",
          },
        },
      ];
      for (const candidate of privateResourceTriggers) {
        const rejected = yield* store
          .save(
            environmentId,
            {
              id: RoutineId.make(`routine-linear-private-${candidate.id}`),
              expectedRevision: 0,
              configuration: { ...configuration, trigger: candidate.trigger },
            },
            1_100,
            { linearMetadata },
          )
          .pipe(Effect.flip);
        assert.equal(rejected.code, "validation");
        assert.include(rejected.message, "connection's scope");
      }

      for (const projectId of ["project-public", "project-mixed"]) {
        const accepted = yield* store.save(
          environmentId,
          {
            id: RoutineId.make(`routine-linear-${projectId}`),
            expectedRevision: 0,
            configuration: {
              ...configuration,
              trigger: {
                kind: "linear",
                connectionId: allPublicConnectionId,
                workspaceId: "workspace-1",
                projectId,
                event: "issue_created",
              },
            },
          },
          1_101,
          { linearMetadata },
        );
        assert.equal(accepted.configuration.trigger.kind, "linear");
      }

      const validResourceTriggers = [
        {
          id: "status",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            event: "status_changed" as const,
            stateId: "state-public",
          },
        },
        {
          id: "global-label",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            event: "label_added" as const,
            labelId: "label-global",
          },
        },
      ];
      for (const candidate of validResourceTriggers) {
        const accepted = yield* store.save(
          environmentId,
          {
            id: RoutineId.make(`routine-linear-public-${candidate.id}`),
            expectedRevision: 0,
            configuration: {
              ...configuration,
              trigger: candidate.trigger,
            },
          },
          1_102,
          { linearMetadata },
        );
        assert.equal(accepted.configuration.trigger.kind, "linear");
      }

      const outsideScopedTeam = yield* store
        .save(
          environmentId,
          {
            id: RoutineId.make("routine-linear-state-outside-scoped-team"),
            expectedRevision: 0,
            configuration: {
              ...configuration,
              trigger: {
                kind: "linear",
                connectionId: scopedConnectionId,
                workspaceId: "workspace-1",
                event: "status_changed",
                stateId: "state-public",
              },
            },
          },
          1_103,
          { linearMetadata },
        )
        .pipe(Effect.flip);
      assert.equal(outsideScopedTeam.code, "validation");

      const insideScopedTeam = yield* store.save(
        environmentId,
        {
          id: RoutineId.make("routine-linear-state-inside-scoped-team"),
          expectedRevision: 0,
          configuration: {
            ...configuration,
            trigger: {
              kind: "linear",
              connectionId: scopedConnectionId,
              workspaceId: "workspace-1",
              event: "status_changed",
              stateId: "state-private",
            },
          },
        },
        1_104,
        { linearMetadata },
      );
      assert.equal(insideScopedTeam.configuration.trigger.kind, "linear");

      const incompatibleTriggers = [
        {
          id: "team-project",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            teamId: "team-public",
            projectId: "project-public-b",
            event: "issue_created" as const,
          },
        },
        {
          id: "project-state",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            projectId: "project-public",
            event: "status_changed" as const,
            stateId: "state-public-b",
          },
        },
        {
          id: "project-label",
          trigger: {
            kind: "linear" as const,
            connectionId: allPublicConnectionId,
            workspaceId: "workspace-1",
            projectId: "project-public",
            event: "label_added" as const,
            labelId: "label-public-b",
          },
        },
      ];
      for (const candidate of incompatibleTriggers) {
        const rejected = yield* store
          .save(
            environmentId,
            {
              id: RoutineId.make(`routine-linear-incompatible-${candidate.id}`),
              expectedRevision: 0,
              configuration: { ...configuration, trigger: candidate.trigger },
            },
            1_105,
            { linearMetadata },
          )
          .pipe(Effect.flip);
        assert.equal(rejected.code, "validation");
      }
    }),
  );

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

  it.effect("does not let a stale owner launch a reclaimed run", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const routine = yield* store.save(
        environmentId,
        { id: RoutineId.make("routine-fence"), expectedRevision: 0, configuration },
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
      assert.equal(first?.run.id, run.id);
      const reclaimed = yield* store.claim("worker-b", 40_001);
      assert.equal(reclaimed?.run.id, run.id);
      const outcome = (effect: Effect.Effect<void, RoutineError>) =>
        effect.pipe(
          Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" as const }),
        );

      assert.equal(yield* outcome(store.beginLaunch(first!, 40_001)), "lost-fence");
      assert.equal(yield* outcome(store.beginLaunch(reclaimed!, 40_001)), "success");
      assert.equal(yield* outcome(store.markLaunched(first!, 40_002)), "lost-fence");
      assert.equal(yield* outcome(store.markLaunched(reclaimed!, 40_002)), "success");
      assert.equal(yield* outcome(store.markLaunched(reclaimed!, 40_003)), "lost-fence");
      assert.equal(yield* store.renew(reclaimed!, 45_000), "handed-off");
      const history = yield* store.history(environmentId, { id: routine.id });
      assert.deepEqual(
        history.runs.map(({ stage, status, conversation }) => ({ stage, status, conversation })),
        [
          {
            stage: "prompt-accepted",
            status: "starting",
            conversation: { kind: "confirmed", threadId: run.threadId },
          },
        ],
      );
      assert.deepEqual(
        (yield* store.launchedRuns()).map(({ run: launched, eventCursor }) => [
          launched.id,
          eventCursor,
        ]),
        [[run.id, 0]],
      );
      // A launched run is not claimable again.
      assert.isNull(yield* store.claim("worker-c", 90_000));
    }),
  );

  it.effect("keeps a launched run when a late dispatcher failure arrives", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-handoff-environment");
      const routine = yield* store.save(
        environment,
        { id: RoutineId.make("routine-handoff"), expectedRevision: 0, configuration },
        Date.parse("2026-01-01T00:00:00.000Z"),
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-handoff"),
        },
        10_000,
      );
      const claim = yield* store.claim("worker-handoff", 10_000);
      yield* store.beginLaunch(claim!, 10_001);
      yield* store.markLaunched(claim!, 10_002);
      yield* store.updatePreparation(
        claim!,
        { stage: "terminal", status: "blocked", detail: "late dispatcher failure" },
        10_003,
      );

      const history = yield* store.history(environment, { id: routine.id });
      assert.deepEqual(
        history.runs.map(({ stage, status, detail }) => ({ stage, status, detail })),
        [{ stage: "prompt-accepted", status: "starting", detail: null }],
      );
      assert.isTrue((yield* store.activeRuns()).some((active) => active.id === run.id));
    }),
  );

  it.effect("completes a recorded launch intent even after the routine is paused", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-launch-intent-environment");
      const routine = yield* store.save(
        environment,
        { id: RoutineId.make("routine-launch-intent"), expectedRevision: 0, configuration },
        12_000,
      );
      const run = yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-launch-intent"),
        },
        12_001,
      );
      const first = yield* store.claim("intent-worker-a", 12_001);
      yield* store.beginLaunch(first!, 12_002);
      // The first launch may already have reached orchestration, so pausing
      // does not cancel the run; a reclaim finishes the idempotent launch.
      const paused = yield* store.change(
        environment,
        { id: routine.id, expectedRevision: routine.revision, action: "pause" },
        12_003,
      );
      const reclaimed = yield* store.claim("intent-worker-b", 42_003);
      assert.equal(reclaimed?.run.id, run.id);
      yield* store.beginLaunch(reclaimed!, 42_004);
      yield* store.markLaunched(reclaimed!, 42_005);
      const history = yield* store.history(environment, { id: routine.id });
      assert.deepEqual(
        history.runs.map(({ stage, status }) => ({ stage, status })),
        [{ stage: "prompt-accepted", status: "starting" }],
      );
      yield* store.recordOrchestrationProgress(
        {
          runId: run.id,
          fromCursor: 0,
          toCursor: 1,
          progress: { stage: "terminal", status: "interrupted", detail: null },
        },
        42_006,
      );
      assert.equal(paused.state, "paused");
    }),
  );

  it.effect("cancels a queued run that has no launch intent when the routine is paused", () =>
    Effect.gen(function* () {
      const store = yield* RoutineStore;
      const environment = EnvironmentId.make("routine-pause-before-launch-environment");
      const routine = yield* store.save(
        environment,
        { id: RoutineId.make("routine-pause-before-launch"), expectedRevision: 0, configuration },
        13_000,
      );
      yield* store.testRun(
        environment,
        {
          id: routine.id,
          expectedRevision: routine.revision,
          requestId: RoutineRequestId.make("request-pause-before-launch"),
        },
        13_001,
      );
      const claim = yield* store.claim("pause-worker", 13_001);
      yield* store.change(
        environment,
        { id: routine.id, expectedRevision: routine.revision, action: "pause" },
        13_002,
      );
      const result = yield* store
        .beginLaunch(claim!, 13_003)
        .pipe(Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" }));
      assert.equal(result, "lost-fence");
      const history = yield* store.history(environment, { id: routine.id });
      assert.deepEqual(
        history.runs.map(({ stage, status, detail }) => ({ stage, status, detail })),
        [{ stage: "terminal", status: "skipped", detail: "Routine paused before submission." }],
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
    "serves a connection from the database environment that owns it when a copied record names another environment",
    () =>
      Effect.gen(function* () {
        const store = yield* RoutineStore;
        const sql = yield* SqlClient.SqlClient;
        const environmentA = EnvironmentId.make("connection-copy-source-environment");
        const environmentB = EnvironmentId.make("connection-copy-target-environment");
        const connectionId = RoutineConnectionId.make("connection-copied-record");
        yield* store.saveConnection(githubConnection(connectionId, environmentA));
        yield* sql`UPDATE routine_connections SET environment_id=${environmentB} WHERE id=${connectionId}`;
        const listed = yield* store.listConnections(environmentB);
        assert.deepEqual(
          listed.map((connection) => [connection.id, connection.environmentId]),
          [[connectionId, environmentB]],
        );
        const missing = yield* store
          .getConnection(environmentA, connectionId)
          .pipe(
            Effect.match({ onFailure: (error) => error.code, onSuccess: () => "success" as const }),
          );
        assert.equal(missing, "not-found");
        assert.equal(
          (yield* store.getConnection(environmentB, connectionId)).environmentId,
          environmentB,
        );
        assert.equal((yield* store.findConnection(connectionId))?.environmentId, environmentB);
        const saved = yield* store.save(
          environmentB,
          {
            id: RoutineId.make("routine-on-copied-connection"),
            expectedRevision: 0,
            configuration: githubConfiguration(connectionId),
          },
          100_050,
        );
        assert.equal(saved.environmentId, environmentB);
        const rejected = yield* store
          .save(
            environmentA,
            {
              id: RoutineId.make("routine-on-foreign-connection"),
              expectedRevision: 0,
              configuration: githubConfiguration(connectionId),
            },
            100_060,
          )
          .pipe(Effect.flip);
        assert.equal(rejected.message, "Connect the GitHub repository before saving.");
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
