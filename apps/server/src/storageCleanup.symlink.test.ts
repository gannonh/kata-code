// Kata (KAT-3453): storage cleanup compares canonical paths, so a symlinked base
// directory, worktree, artifact, or alias for a live checkout cannot turn into
// a removal of the wrong path or a removal of work that is still in use.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  OrchestrationV2ProviderSessionJson,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderSessionId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationV2ThreadShell,
} from "@kata-sh/code-contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as ServerConfig from "./config.ts";
import * as GitManager from "./git/GitManager.ts";
import { CodexProviderCapabilitiesV2 } from "./orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "./orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "./orchestration-v2/ProjectStore.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as Settings from "./serverSettings.ts";
import * as StorageCleanup from "./storageCleanup.ts";
import * as TerminalManager from "./terminal/Manager.ts";
import * as GitVcsDriver from "./vcs/GitVcsDriver.ts";

const NOW = "2026-08-25T00:00:00.000Z";
const OLD = "2026-08-01T00:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-storage");
const LINKED_PROJECT_ID = ProjectId.make("project-linked");
const THREAD_ID = ThreadId.make("storage-thread");

const encodeSession = Schema.encodeSync(Schema.fromJsonString(OrchestrationV2ProviderSessionJson));

type Case =
  | "plain"
  | "symlinked-base"
  | "symlinked-worktree"
  | "symlinked-files"
  | "symlinked-shared-alias"
  | "symlinked-terminal-alias"
  | "symlinked-project-alias"
  | "symlinked-session-alias";

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: THREAD_ID, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: DateTime.makeUnsafe(OLD),
    createdAt: DateTime.makeUnsafe(OLD),
    updatedAt: DateTime.makeUnsafe(OLD),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

function project(id: ProjectId, workspaceRoot: string): OrchestrationProjectShell {
  return {
    id,
    title: "Project",
    workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: OLD,
    updatedAt: OLD,
  };
}

// The home directory itself is a symlink, as on machines whose home lives on
// another volume. Every `symlinked-*` case runs under it.
const symlinkedBaseDirConfig = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "kata-storage-cleanup-" });
    yield* fs.makeDirectory(path.join(tempDir, "volume"));
    yield* fs.symlink(path.join(tempDir, "volume"), path.join(tempDir, "home"));
    return ServerConfig.layerTest(process.cwd(), path.join(tempDir, "home", ".katacode"));
  }),
);

const runCase = (protection: Case) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(NOW));
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sql = yield* SqlClient.SqlClient;
    const config = yield* ServerConfig.ServerConfig;
    const worktreePath = path.join(config.worktreesDir, "feature");
    const outside = yield* fs.makeTempDirectoryScoped({ prefix: "kata-storage-outside-" });
    if (protection === "symlinked-worktree") {
      yield* fs.writeFileString(path.join(outside, ".git"), "gitdir: /test/admin");
      yield* fs.makeDirectory(config.worktreesDir, { recursive: true });
      yield* fs.symlink(outside, worktreePath);
    } else {
      yield* fs.makeDirectory(worktreePath, { recursive: true });
      yield* fs.writeFileString(path.join(worktreePath, ".git"), "gitdir: /test/admin");
    }
    const realWorktreePath = yield* fs.realPath(worktreePath);

    yield* fs.makeDirectory(config.browserArtifactsDir, { recursive: true });
    yield* fs.makeDirectory(config.logsDir, { recursive: true });
    const oldImage = path.join(config.browserArtifactsDir, "old.png");
    const oldLog = path.join(config.logsDir, "server.log.1");
    const activeLog = path.join(config.logsDir, "server.log");
    const old = DateTime.toDateUtc(DateTime.makeUnsafe(OLD));
    for (const file of [oldImage, oldLog, activeLog]) {
      const target =
        protection === "symlinked-files" && file !== activeLog
          ? path.join(outside, path.basename(file))
          : file;
      yield* fs.writeFileString(target, "keep or remove");
      yield* fs.utimes(target, old, old);
      if (target !== file) yield* fs.symlink(target, file);
    }

    if (protection === "symlinked-session-alias") {
      const session = {
        id: ProviderSessionId.make("session-alias"),
        driver: ProviderDriverKind.make("codex"),
        providerInstanceId: ProviderInstanceId.make("codex"),
        status: "ready" as const,
        cwd: path.join(realWorktreePath, "src"),
        model: null,
        capabilities: CodexProviderCapabilitiesV2,
        createdAt: DateTime.makeUnsafe(NOW),
        updatedAt: DateTime.makeUnsafe(NOW),
        lastError: null,
      };
      yield* sql`
        INSERT INTO orchestration_v2_projection_provider_sessions (
          provider_session_id, thread_id, provider, status, model, updated_at, payload_json
        ) VALUES (
          ${session.id}, NULL, 'codex', 'ready', NULL, ${NOW}, ${encodeSession(session)}
        )
      `;
    }

    const thread = shell({ branch: "feature", worktreePath });
    const projects = [project(PROJECT_ID, config.baseDir)];
    if (protection === "symlinked-project-alias") {
      projects.push(project(LINKED_PROJECT_ID, path.join(realWorktreePath, "nested")));
    }
    const archived =
      protection === "symlinked-shared-alias"
        ? [
            shell({
              id: ThreadId.make("archived-sharing-thread"),
              branch: "feature",
              worktreePath: realWorktreePath,
              archivedAt: DateTime.makeUnsafe(NOW),
            }),
          ]
        : [];

    const snapshotRead = yield* Deferred.make<void>();
    const removals: string[] = [];
    const settings = yield* Settings.ServerSettingsService.pipe(
      Effect.provide(
        Settings.layerTest({
          storageCleanup: {
            worktreeAfterDays: 8,
            worktreeOnDelete: false,
            worktreeOnMerge: false,
            worktreeUnchanged: false,
            browserArtifactsAfterDays: 8,
            logsAfterDays: 8,
          },
        }),
      ),
    );
    const cleanup = yield* StorageCleanup.make.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(Settings.ServerSettingsService, settings),
          Layer.mock(ProjectStore.ProjectStoreV2)({
            listShells: () => Effect.succeed(projects),
          }),
          Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getShellSnapshot: (options) =>
              Deferred.succeed(snapshotRead, undefined).pipe(
                Effect.as({
                  schemaVersion: 1,
                  snapshotSequence: 1,
                  threads: options?.location === "archive" ? [] : [thread],
                  archivedThreads: options?.location === "archive" ? archived : [],
                }),
              ),
          }),
          Layer.mock(GitManager.GitManager)({ invalidateStatus: () => Effect.void }),
          Layer.mock(GitVcsDriver.GitVcsDriver)({
            statusDetailsLocal: () =>
              Effect.succeed({
                isRepo: true,
                hasOriginRemote: false,
                isDefaultBranch: false,
                branch: "feature",
                upstreamRef: null,
                hasWorkingTreeChanges: false,
                workingTree: { files: [], insertions: 0, deletions: 0 },
                hasUpstream: false,
                aheadCount: 0,
                behindCount: 0,
                aheadOfDefaultCount: 0,
              }),
            resolveCommit: () => Effect.succeed({ commitSha: "a".repeat(40) }),
            execute: () =>
              Effect.succeed({
                exitCode: ChildProcessSpawner.ExitCode(0),
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              }),
            removeWorktree: (input) => {
              removals.push(input.path);
              return fs.remove(input.path, { recursive: true }).pipe(Effect.orDie);
            },
          }),
          Layer.mock(TerminalManager.TerminalManager)({
            subscribeMetadata: (listener) =>
              listener({
                type: "snapshot",
                terminals:
                  protection === "symlinked-terminal-alias"
                    ? [
                        {
                          threadId: "terminal-thread",
                          terminalId: "default",
                          cwd: path.join(realWorktreePath, "src"),
                          worktreePath: null,
                          status: "running",
                          pid: 42,
                          exitCode: null,
                          exitSignal: null,
                          hasRunningSubprocess: false,
                          label: "shell",
                          updatedAt: NOW,
                        },
                      ]
                    : [],
              }).pipe(Effect.as(() => {})),
          }),
        ),
      ),
    );
    yield* cleanup.start();
    yield* Deferred.await(snapshotRead);
    yield* cleanup.drain;

    return {
      worktreeExists: yield* fs.exists(worktreePath),
      removals,
      worktreePath,
      oldImageExists: yield* fs.exists(oldImage),
      oldLogExists: yield* fs.exists(oldLog),
      activeLogExists: yield* fs.exists(activeLog),
    };
  });

const provideCase = (protection: Case) => (effect: ReturnType<typeof runCase>) =>
  effect.pipe(
    Effect.provide(
      Layer.mergeAll(
        protection === "plain"
          ? ServerConfig.layerTest(process.cwd(), { prefix: "kata-storage-cleanup-" })
          : symlinkedBaseDirConfig,
        SqlitePersistenceMemory,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
    Effect.scoped,
  );

describe("storage cleanup with symlinked paths", () => {
  it.effect.each(["plain", "symlinked-base"] as const)(
    "removes an expired worktree and old files (%s)",
    (protection) =>
      Effect.gen(function* () {
        const result = yield* runCase(protection).pipe(provideCase(protection));
        assert.isFalse(result.worktreeExists);
        assert.deepStrictEqual(result.removals, [result.worktreePath]);
        assert.isFalse(result.oldImageExists);
        assert.isFalse(result.oldLogExists);
        assert.isTrue(result.activeLogExists);
      }),
  );

  it.effect("removes the worktree but keeps old files that are symlinks", () =>
    Effect.gen(function* () {
      const result = yield* runCase("symlinked-files").pipe(provideCase("symlinked-files"));
      assert.isFalse(result.worktreeExists);
      assert.deepStrictEqual(result.removals, [result.worktreePath]);
      assert.isTrue(result.oldImageExists);
      assert.isTrue(result.oldLogExists);
    }),
  );

  it.effect.each([
    "symlinked-worktree",
    "symlinked-shared-alias",
    "symlinked-terminal-alias",
    "symlinked-project-alias",
    "symlinked-session-alias",
  ] as const)("retains a worktree reached through its canonical path (%s)", (protection) =>
    Effect.gen(function* () {
      const result = yield* runCase(protection).pipe(provideCase(protection));
      assert.isTrue(result.worktreeExists);
      assert.deepStrictEqual(result.removals, []);
    }),
  );
});
