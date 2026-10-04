import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import { assert, it, vi } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RoutineError,
  RoutineId,
  RoutineRequestId,
  type RoutineDraft,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import { makeProviderRegistryLayer } from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "../orchestration-v2/CommandReceiptStore.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderRuntimeRecovery from "../orchestration-v2/ProviderRuntimeRecoveryService.ts";
import type { ProviderAdapterV2Shape } from "../orchestration-v2/ProviderAdapter.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { makeOrchestratorV2ReplayLayerWithRegistry } from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import { RoutineDispatcher, RoutineDispatcherLive } from "./RoutineDispatcher.ts";
import {
  RESTART_CANCELLED_DETAIL,
  RoutineRunObserver,
  RoutineRunObserverLive,
} from "./RoutineRunObserver.ts";
import { RoutineStore, RoutineStoreLive } from "./RoutineStore.ts";

const environmentId = EnvironmentId.make("routine-dispatcher-environment");
const projectId = ProjectId.make("project:routine-dispatcher");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
} as const;
const project = {
  id: projectId,
  title: "Routine project",
  workspaceRoot: "/repo",
  repositoryIdentity: null,
  faviconPath: null,
  defaultModelSelection: modelSelection,
  defaultThreadEnvMode: null,
  scripts: [],
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
  deletedAt: null,
} as const;
const sharedConfiguration: RoutineDraft = {
  name: "Nightly report",
  instruction: "Read every file and write a long report.",
  projectId,
  modelSelection,
  runtimeMode: "approval-required",
  workspace: { kind: "shared", directory: "/repo" },
  trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
};

const adapter = {
  instanceId: modelSelection.instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("provider execution is disabled in routine dispatcher tests"),
} as ProviderAdapterV2Shape;

interface HarnessOptions {
  /** Wraps the real launch, for example to stop the process right after it. */
  readonly wrapLaunch?: (
    launch: ThreadLaunch.ThreadLaunchService["Service"]["launch"],
  ) => ThreadLaunch.ThreadLaunchService["Service"]["launch"];
}

/** Real orchestration V2 launch over one in-memory database shared with the routine store. */
function makeHarness(options: HarnessOptions = {}) {
  const database = SqlitePersistenceMemory;
  const orchestrator = makeOrchestratorV2ReplayLayerWithRegistry(
    { name: "routine-dispatcher" },
    ProviderAdapterRegistry.makeLayer([adapter]),
    { databaseLayer: database, runEffectWorker: false },
  );
  const threadManagement = ThreadManagement.layer.pipe(Layer.provide(orchestrator));
  const receipts = CommandReceiptStore.layer.pipe(Layer.provide(database));
  const createWorktree = vi.fn<GitWorkflow.GitWorkflowService["Service"]["createWorktree"]>(
    (input) =>
      Effect.succeed({
        worktree: { path: "/repo-worktrees/routine", refName: input.newRefName ?? input.refName },
      } as never),
  );
  const runSetup = vi.fn<
    ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]["runForThread"]
  >(() => Effect.succeed({ status: "no-script" as const }));
  const projects = Layer.succeed(ProjectService.ProjectService, {
    create: () => Effect.die("unused"),
    bootstrap: () => Effect.die("unused"),
    update: () => Effect.die("unused"),
    delete: () => Effect.die("unused"),
    getById: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
    getByWorkspaceRoot: () => Effect.succeed(Option.some(project)),
    snapshot: Effect.die("unused"),
    getShell: () => Effect.die("unused"),
    listShells: () => Effect.die("unused"),
  } as ProjectService.ProjectService["Service"]);
  const git = Layer.mock(GitWorkflow.GitWorkflowService)({
    listRefs: () =>
      Effect.succeed({
        refs: [
          { name: "main", current: true, isDefault: true, worktreePath: null },
          { name: "feature", current: false, isDefault: false, worktreePath: null },
        ],
        isRepo: true,
        hasPrimaryRemote: false,
        nextCursor: null,
        totalCount: 2,
      }),
    createWorktree,
    renameBranch: (input) => Effect.succeed({ branch: input.newBranch }),
    fetchRemote: () => Effect.void,
    remoteExists: () => Effect.succeed(false),
    remoteBranchExists: () => Effect.succeed(false),
    removeWorktree: () => Effect.void,
  });
  const externalServices = Layer.mergeAll(
    WorktreeSetupTracker.layer,
    Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
    Layer.mock(TerminalManager.TerminalManager)({ close: () => Effect.void }),
    projects,
    git,
    Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, { runForThread: runSetup }),
    Layer.mock(TextGeneration.TextGeneration)({}),
    ServerSettings.layerTest(),
    makeProviderRegistryLayer(),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      folderForThread: () => Effect.succeed(Option.none()),
    }),
  );
  const realLaunch = ThreadLaunch.layer.pipe(
    Layer.provide(Layer.mergeAll(externalServices, threadManagement, receipts, IdAllocator.layer)),
  );
  const launch =
    options.wrapLaunch === undefined
      ? realLaunch
      : Layer.effect(
          ThreadLaunch.ThreadLaunchService,
          Effect.gen(function* () {
            const service = yield* ThreadLaunch.ThreadLaunchService;
            return ThreadLaunch.ThreadLaunchService.of({
              launch: options.wrapLaunch!(service.launch),
              retryPreparation: service.retryPreparation,
            });
          }),
        ).pipe(Layer.provide(realLaunch));
  const store = RoutineStoreLive.pipe(Layer.provide(database));
  const dispatcher = RoutineDispatcherLive.pipe(
    Layer.provide(Layer.mergeAll(store, launch, projects, git)),
  );
  const observer = RoutineRunObserverLive.pipe(
    Layer.provide(Layer.mergeAll(store, OrchestrationEventStoreLive.pipe(Layer.provide(database)))),
  );
  // The same startup reconciliation the server runs after a restart.
  const recovery = ProviderRuntimeRecovery.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        orchestrator,
        ProjectionStore.layer.pipe(Layer.provide(database)),
        EffectOutbox.layer.pipe(Layer.provide(database)),
        IdAllocator.layer,
        ServerSettings.layerTest(),
      ),
    ),
  );
  return {
    layer: Layer.mergeAll(dispatcher, store, threadManagement, observer, recovery, database),
    createWorktree,
    runSetup,
  };
}

const admitTestRun = (routineId: string, configuration: RoutineDraft = sharedConfiguration) =>
  Effect.gen(function* () {
    const store = yield* RoutineStore;
    yield* TestClock.setTime(10_000);
    const routine = yield* store.save(
      environmentId,
      { id: RoutineId.make(routineId), expectedRevision: 0, configuration },
      10_000,
    );
    const run = yield* store.testRun(
      environmentId,
      {
        id: routine.id,
        expectedRevision: routine.revision,
        requestId: RoutineRequestId.make(`${routineId}:request`),
      },
      10_000,
    );
    return { routine, run };
  });

it.effect(
  "launches a retried dispatch once: one thread, one message, one run after a crash past the launch",
  () => {
    let launches = 0;
    const harness = makeHarness({
      // The first process stops right after orchestration accepted the launch,
      // before the routine store recorded the handoff.
      wrapLaunch: (launch) => (input) =>
        launch(input).pipe(
          Effect.tap(() => {
            launches += 1;
            return launches === 1 ? Effect.interrupt : Effect.void;
          }),
        ),
    });
    return Effect.gen(function* () {
      const store = yield* RoutineStore;
      const dispatcher = yield* RoutineDispatcher;
      const threads = yield* ThreadManagement.ThreadManagementService;
      const { routine, run } = yield* admitTestRun("routine-retried-dispatch");

      const firstClaim = yield* store.claim("worker-a", 10_000);
      assert.equal(firstClaim?.run.id, run.id);
      const first = yield* dispatcher.dispatchClaim(firstClaim!).pipe(Effect.forkChild);
      const firstExit = yield* Fiber.await(first);
      assert.isTrue(Exit.hasInterrupts(firstExit));
      assert.deepEqual(
        (yield* store.history(environmentId, { id: routine.id })).runs.map(({ stage, status }) => ({
          stage,
          status,
        })),
        [{ stage: "submitting", status: "starting" }],
      );

      // The stale lease expires and another worker retries the same run.
      yield* TestClock.setTime(40_001);
      const retryClaim = yield* store.claim("worker-b", 40_001);
      assert.equal(retryClaim?.run.id, run.id);
      yield* dispatcher.dispatchClaim(retryClaim!);

      assert.equal(launches, 2);
      const projection = yield* threads.getThreadProjection(run.threadId);
      assert.deepEqual(
        projection.messages.map((message) => ({ id: message.id, text: message.text })),
        [{ id: run.messageId, text: sharedConfiguration.instruction }],
      );
      assert.deepEqual(
        projection.runs.map((v2Run) => v2Run.userMessageId),
        [run.messageId],
      );
      assert.equal(projection.thread.title, sharedConfiguration.name);
      assert.isNull(projection.thread.worktreePath);
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
      assert.equal(yield* store.renew(retryClaim!, 40_002), "handed-off");
      assert.isNull(yield* store.claim("worker-c", 80_000));
    }).pipe(Effect.provide(harness.layer));
  },
);

it.effect("launches a worktree routine on its routine branch from the resolved base", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const store = yield* RoutineStore;
    const dispatcher = yield* RoutineDispatcher;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const { run } = yield* admitTestRun("routine-worktree", {
      ...sharedConfiguration,
      // A base branch that no longer exists falls back to the default branch.
      workspace: {
        kind: "worktree",
        baseBranch: "release",
        startFromOrigin: false,
        runSetupScript: true,
      },
    });
    const claim = yield* store.claim("worker-a", 10_000);
    yield* dispatcher.dispatchClaim(claim!);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (harness.createWorktree.mock.calls.length > 0) break;
      yield* Effect.yieldNow;
    }
    assert.deepEqual(
      harness.createWorktree.mock.calls.map(([input]) => ({
        refName: input.refName,
        newRefName: input.newRefName,
        baseRefName: input.baseRefName,
      })),
      [{ refName: "main", newRefName: `routine/${run.id}`, baseRefName: "main" }],
    );
    const shell = yield* threads.getThreadShell(run.threadId);
    assert.equal(shell?.projectId, projectId);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("runs the setup script only for worktree routines that ask for it", () => {
  const requested: Array<boolean | undefined> = [];
  const harness = makeHarness({
    wrapLaunch: (launch) => (input) => {
      requested.push(input.runSetupScript);
      return launch(input);
    },
  });
  return Effect.gen(function* () {
    const store = yield* RoutineStore;
    const dispatcher = yield* RoutineDispatcher;
    yield* admitTestRun("routine-shared-setup", sharedConfiguration);
    yield* dispatcher.dispatchClaim((yield* store.claim("worker-a", 10_000))!);
    yield* admitTestRun("routine-worktree-no-setup", {
      ...sharedConfiguration,
      workspace: {
        kind: "worktree",
        baseBranch: "main",
        startFromOrigin: false,
        runSetupScript: false,
      },
    });
    yield* dispatcher.dispatchClaim((yield* store.claim("worker-a", 10_000))!);
    assert.deepEqual(requested, [false, false]);
  }).pipe(Effect.provide(harness.layer));
});

it.effect("blocks a shared routine whose directory no longer matches the project", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const store = yield* RoutineStore;
    const dispatcher = yield* RoutineDispatcher;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const { routine, run } = yield* admitTestRun("routine-moved-directory", {
      ...sharedConfiguration,
      workspace: { kind: "shared", directory: "/old-repo" },
    });
    yield* dispatcher.drain("worker-a");

    const history = yield* store.history(environmentId, { id: routine.id });
    assert.deepEqual(
      history.runs.map(({ stage, status }) => ({ stage, status })),
      [{ stage: "terminal", status: "blocked" }],
    );
    assert.include(
      history.runs[0]?.detail ?? "",
      "Saved routine directory '/old-repo' no longer matches project '/repo'.",
    );
    assert.isNull(yield* threads.getThreadShell(run.threadId));
  }).pipe(Effect.provide(harness.layer));
});

it.effect("does not launch a run whose routine was paused before the launch", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const store = yield* RoutineStore;
    const dispatcher = yield* RoutineDispatcher;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const { routine, run } = yield* admitTestRun("routine-paused-before-launch");
    const claim = yield* store.claim("worker-a", 10_000);
    yield* store.change(
      environmentId,
      { id: routine.id, expectedRevision: routine.revision, action: "pause" },
      10_001,
    );

    const error = yield* dispatcher.dispatchClaim(claim!).pipe(Effect.flip);
    assert.instanceOf(error, RoutineError);
    assert.include(error.message, "Routine preparation ownership expired or was canceled.");
    assert.isNull(yield* threads.getThreadShell(run.threadId));
    const history = yield* store.history(environmentId, { id: routine.id });
    assert.deepEqual(
      history.runs.map(({ stage, status }) => ({ stage, status })),
      [{ stage: "terminal", status: "skipped" }],
    );
  }).pipe(Effect.provide(harness.layer));
});

it.effect("settles a launched run as needs-attention after startup recovery cancels it", () => {
  const harness = makeHarness();
  return Effect.gen(function* () {
    const store = yield* RoutineStore;
    const dispatcher = yield* RoutineDispatcher;
    const observer = yield* RoutineRunObserver;
    const recovery = yield* ProviderRuntimeRecovery.ProviderRuntimeRecoveryService;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const { routine, run } = yield* admitTestRun("routine-cut-off-by-restart");
    const claim = yield* store.claim("worker-a", 10_000);
    yield* dispatcher.dispatchClaim(claim!);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const projection = yield* threads.getThreadProjection(run.threadId);
      if (projection.runs.some((v2Run) => v2Run.status !== "preparing")) break;
      yield* Effect.yieldNow;
    }
    yield* observer.observe;
    assert.equal(
      (yield* store.history(environmentId, { id: routine.id })).runs[0]?.status,
      "starting",
    );

    yield* recovery.reconcile("startup");
    yield* observer.observe;

    const settled = (yield* store.history(environmentId, { id: routine.id })).runs[0];
    assert.deepEqual(
      { stage: settled?.stage, status: settled?.status, detail: settled?.detail },
      { stage: "terminal", status: "needs-attention", detail: RESTART_CANCELLED_DETAIL },
    );
    assert.deepEqual(yield* store.activeRuns(), []);
  }).pipe(Effect.provide(harness.layer));
});
