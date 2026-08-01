// @effect-diagnostics nodeBuiltinImport:off - integration test creates a real temporary Git repository.
// @effect-diagnostics preferSchemaOverJson:off - legacy NDJSON fixture is written with JSON.stringify to mirror the historical on-disk format.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { promisify } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskWorkspaceId,
  ThreadId,
  type TaskWorkspace,
  type TaskWorkspaceCommand,
  type TaskWorkspaceStage,
} from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import {
  ServerEnvironment,
  type ServerEnvironmentShape,
} from "../environment/Services/ServerEnvironment.ts";
import { GitWorkflowService, type GitWorkflowServiceShape } from "../git/GitWorkflowService.ts";
import { layerConfig as SqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import { TaskWorkspaceStoreLive } from "../persistence/Layers/TaskWorkspaceStore.ts";
import { TaskWorkspaceStore } from "../persistence/Services/TaskWorkspaceStore.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import {
  TaskWorkspaceSourceError,
  TaskWorkspaceSourceErrorKind,
  TaskWorkspaceSourceResolver,
  type TaskWorkspaceSourceResolution,
} from "./Services/TaskWorkspaceSourceResolver.ts";
import { TaskStageBridge, TaskStageBridgeLive } from "./TaskStageBridge.ts";
import { TaskWorkspaceService, layer as TaskWorkspaceServiceLive } from "./TaskWorkspaceService.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";

const execFileAsync = promisify(execFile);
const now = (second: number) => `2026-07-28T17:00:${String(second).padStart(2, "0")}.000Z`;
const taskId = TaskWorkspaceId.make("slice-1-integration");
const projectId = ProjectId.make("project-1");

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Kata Code Test",
      GIT_AUTHOR_EMAIL: "test@kata.sh",
      GIT_COMMITTER_NAME: "Kata Code Test",
      GIT_COMMITTER_EMAIL: "test@kata.sh",
    },
  });
  return stdout.trim();
}

function command<T extends TaskWorkspaceCommand>(value: T): T {
  return value;
}

function unsupported(operation: string): never {
  throw new Error(`Unexpected Git workflow operation: ${operation}`);
}

function makeGitWorkflow(baseDir: string, createCount: { value: number }): GitWorkflowServiceShape {
  return {
    status: () => Effect.sync(() => unsupported("status")),
    localStatus: () => Effect.sync(() => unsupported("localStatus")),
    remoteStatus: () => Effect.sync(() => unsupported("remoteStatus")),
    invalidateLocalStatus: () => Effect.void,
    invalidateRemoteStatus: () => Effect.void,
    invalidateStatus: () => Effect.void,
    pullCurrentBranch: () => Effect.sync(() => unsupported("pullCurrentBranch")),
    runStackedAction: () => Effect.sync(() => unsupported("runStackedAction")),
    resolvePullRequest: () => Effect.sync(() => unsupported("resolvePullRequest")),
    preparePullRequestThread: () => Effect.sync(() => unsupported("preparePullRequestThread")),
    listRefs: () => Effect.sync(() => unsupported("listRefs")),
    createWorktree: (input) =>
      Effect.tryPromise({
        try: async () => {
          createCount.value += 1;
          const newRefName = input.newRefName ?? "katacode/task-test";
          const worktreePath = input.path ?? NodePath.join(baseDir, "task-worktree");
          await git(input.cwd, ["worktree", "add", "-b", newRefName, worktreePath, input.refName]);
          return {
            worktree: {
              path: worktreePath,
              refName: newRefName,
            },
          };
        },
        catch: (cause) => cause as never,
      }),
    removeWorktree: () => Effect.sync(() => unsupported("removeWorktree")),
    createRef: () => Effect.sync(() => unsupported("createRef")),
    switchRef: () => Effect.sync(() => unsupported("switchRef")),
    renameBranch: () => Effect.sync(() => unsupported("renameBranch")),
  };
}

const dispatchedOrchestration: unknown[] = [];
let failNextOrchestrationDispatch = false;

const makeRuntime = Effect.fn("TaskWorkspaceServiceTest.makeRuntime")(function* (
  repoRoot: string,
  baseDir: string,
  createCount: { value: number },
) {
  const environmentId = EnvironmentId.make("environment-local");
  const environmentLayer = Layer.succeed(ServerEnvironment, {
    getEnvironmentId: Effect.succeed(environmentId),
    getDescriptor: Effect.succeed({
      environmentId,
      label: "test",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.0",
      capabilities: { repositoryIdentity: true },
    }),
  } satisfies ServerEnvironmentShape);
  const gitLayer = Layer.succeed(GitWorkflowService, makeGitWorkflow(baseDir, createCount));
  const sourceResolverLayer = Layer.succeed(TaskWorkspaceSourceResolver, {
    resolve: ({ worktreePolicy }) =>
      Effect.tryPromise({
        try: async () => {
          const headSha = await git(repoRoot, ["rev-parse", "HEAD"]);
          const status = await git(repoRoot, ["status", "--porcelain=v2"]);
          const planningRootFingerprint = createHash("sha256")
            .update(`${headSha}\n${status}`)
            .digest("hex");
          return {
            workspaceRoot: repoRoot,
            baseCommitSha: headSha,
            planningRootFingerprint: worktreePolicy === "now" ? null : planningRootFingerprint,
          };
        },
        catch: (cause) =>
          new TaskWorkspaceSourceError(TaskWorkspaceSourceErrorKind.NotARepository, String(cause)),
      }),
  });
  const orchestrationLayer = Layer.succeed(OrchestrationEngineService, {
    dispatch: (command: unknown) => {
      dispatchedOrchestration.push(command as never);
      if (failNextOrchestrationDispatch) {
        failNextOrchestrationDispatch = false;
        return Effect.fail(new Error("injected orchestration failure") as never);
      }
      return Effect.succeed({ sequence: dispatchedOrchestration.length });
    },
    streamDomainEvents: Stream.empty,
    readEvents: () => {
      const turnStart = [...dispatchedOrchestration]
        .toReversed()
        .find((entry) => (entry as { type?: string }).type === "thread.turn.start") as
        | { readonly threadId: string }
        | undefined;
      return turnStart
        ? Stream.succeed({
            type: "thread.session-set",
            payload: {
              threadId: turnStart.threadId,
              session: { status: "running", activeTurnId: "bootstrap-turn" },
            },
          } as never)
        : Stream.empty;
    },
  } as OrchestrationEngineShape);
  const taskLayer = TaskWorkspaceServiceLive.pipe(
    Layer.provide(gitLayer),
    Layer.provide(environmentLayer),
    Layer.provide(sourceResolverLayer),
    Layer.provide(orchestrationLayer),
    Layer.provide(TaskWorkspaceStoreLive),
    Layer.provide(SqlitePersistenceLive),
    Layer.provide(ServerConfig.layerTest(repoRoot, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(taskLayer, scope);
  return {
    runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(effect, context),
    runPromiseExit: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.exit(Effect.provide(effect, context)),
    runContext: context as unknown as Context.Context<TaskWorkspaceService | TaskWorkspaceStore>,
    dispose: Effect.provide(Scope.close(scope, Exit.void), context),
  };
});

const setupRuntime = Effect.fn("TaskWorkspaceServiceTest.setupRuntime")(function* (prefix: string) {
  const root = yield* Effect.tryPromise(() =>
    NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), prefix)),
  );
  yield* Effect.addFinalizer(() =>
    Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
  );
  const repoRoot = NodePath.join(root, "repo");
  const baseDir = NodePath.join(root, "state");
  yield* Effect.tryPromise(() => NodeFs.mkdir(repoRoot, { recursive: true }));
  yield* Effect.tryPromise(() => git(repoRoot, ["init", "-b", "main"]));
  yield* Effect.tryPromise(() =>
    NodeFs.writeFile(NodePath.join(repoRoot, "README.md"), "# fixture\n", "utf8"),
  );
  yield* Effect.tryPromise(() => git(repoRoot, ["add", "README.md"]));
  yield* Effect.tryPromise(() => git(repoRoot, ["commit", "-m", "chore: seed fixture repository"]));
  const runtime = yield* makeRuntime(repoRoot, baseDir, { value: 0 });
  yield* Effect.addFinalizer(() => runtime.dispose);
  return { runtime, repoRoot, baseDir };
});

describe("TaskWorkspaceService", () => {
  it.effect(
    "runs the Standard slice, rejects invalid gates, deduplicates commands, and replays after restart",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.tryPromise(() =>
          NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-workspace-")),
        );
        yield* Effect.addFinalizer(() =>
          Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
            Effect.orDie,
          ),
        );
        const repoRoot = NodePath.join(root, "repo");
        const baseDir = NodePath.join(root, "state");
        yield* Effect.tryPromise(() => NodeFs.mkdir(repoRoot, { recursive: true }));
        yield* Effect.tryPromise(() => git(repoRoot, ["init", "-b", "main"]));
        yield* Effect.tryPromise(() =>
          NodeFs.writeFile(NodePath.join(repoRoot, "README.md"), "# fixture\n", "utf8"),
        );
        yield* Effect.tryPromise(() => git(repoRoot, ["add", "README.md"]));
        yield* Effect.tryPromise(() =>
          git(repoRoot, ["commit", "-m", "chore: seed fixture repository"]),
        );

        const createCount = { value: 0 };
        const runtime = yield* makeRuntime(repoRoot, baseDir, createCount);
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

        const create = command({
          type: "task.create",
          commandId: CommandId.make("command-create"),
          taskId,
          createdAt: now(1),
          title: "Slice 1 integration",
          projectId,
          workspaceRoot: repoRoot,
          baseRef: "main",
          preset: "standard",
          approvalPolicy: "before-build",
        });
        yield* runtime.runPromise(service.dispatch(create));

        const linked = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("command-link-questions-session"),
              taskId,
              createdAt: now(2),
              stage: "questions",
              threadId: ThreadId.make("thread-questions"),
              role: "primary",
            }),
          ),
        );
        expect(linked.task.sessions).toEqual([
          expect.objectContaining({
            stage: "questions",
            threadId: "thread-questions",
          }),
        ]);

        const questions = command({
          type: "task.artifact.upsert",
          commandId: CommandId.make("command-questions"),
          taskId,
          createdAt: now(3),
          kind: "questions",
          title: "Questions",
          markdown: "# Questions\n\nNo blockers.",
          sourceSessionId: null,
        });
        const firstQuestions = yield* runtime.runPromise(service.dispatch(questions));
        const duplicateQuestions = yield* runtime.runPromise(service.dispatch(questions));
        expect(duplicateQuestions.sequence).toBe(firstQuestions.sequence);
        expect(duplicateQuestions.task.artifacts[0]?.revisions).toHaveLength(1);

        const prematurePlan = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.plan.approve",
              commandId: CommandId.make("command-premature-plan"),
              taskId,
              createdAt: now(4),
            }),
          ),
        );
        expect(prematurePlan._tag).toBe("Failure");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.questions.complete",
              commandId: CommandId.make("command-questions-complete"),
              taskId,
              createdAt: now(5),
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("command-plan"),
              taskId,
              createdAt: now(6),
              kind: "plan",
              title: "Plan",
              markdown: "# Plan\n\nCreate the deterministic fixture.",
              sourceSessionId: null,
            }),
          ),
        );
        const approved = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.plan.approve",
              commandId: CommandId.make("command-plan-approve"),
              taskId,
              createdAt: now(7),
            }),
          ),
        );
        expect(approved.task.workflowRuns.at(-1)?.currentStage).toBe("build");
        expect(approved.task.workspace.repositories[0]?.provisioningStatus).toBe("provisioned");
        expect(createCount.value).toBe(1);

        const duplicateApproval = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.plan.approve",
              commandId: CommandId.make("command-plan-approve"),
              taskId,
              createdAt: now(7),
            }),
          ),
        );
        expect(duplicateApproval.sequence).toBe(approved.sequence);
        expect(createCount.value).toBe(1);

        const prematureSignoff = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.verification.signoff",
              commandId: CommandId.make("command-premature-signoff"),
              taskId,
              createdAt: now(8),
            }),
          ),
        );
        expect(prematureSignoff._tag).toBe("Failure");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.build.work-item.set-status",
              commandId: CommandId.make("command-build-running"),
              taskId,
              createdAt: now(9),
              workItemId: "work-item-1",
              status: "running",
            }),
          ),
        );
        const built = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.fixture.apply",
              commandId: CommandId.make("command-fixture"),
              taskId,
              createdAt: now(10),
            }),
          ),
        );
        const worktreePath = built.task.workspace.repositories[0]?.worktreePath;
        const buildSha = built.task.build.resultingCommitSha;
        expect(worktreePath).toBeTruthy();
        expect(buildSha).toMatch(/^[0-9a-f]{40}$/);
        expect(yield* Effect.tryPromise(() => git(worktreePath!, ["rev-parse", "HEAD"]))).toBe(
          buildSha,
        );
        expect(yield* Effect.tryPromise(() => git(worktreePath!, ["status", "--porcelain"]))).toBe(
          "",
        );
        expect(
          yield* Effect.tryPromise(() =>
            NodeFs.readFile(NodePath.join(worktreePath!, "task-workspace-slice-1.txt"), "utf8"),
          ),
        ).toBe("Kata Code Task Workspaces Slice 1 verified fixture.\n");

        yield* Effect.tryPromise(() =>
          NodeFs.writeFile(NodePath.join(worktreePath!, "stale.txt"), "stale evidence\n", "utf8"),
        );
        yield* Effect.tryPromise(() => git(worktreePath!, ["add", "stale.txt"]));
        yield* Effect.tryPromise(() =>
          git(worktreePath!, ["commit", "-m", "test: move beyond recorded build commit"]),
        );

        const staleVerification = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.verification.run",
              commandId: CommandId.make("command-verify-stale"),
              taskId,
              createdAt: now(11),
              criterionId: "criterion-1",
            }),
          ),
        );
        expect(staleVerification.task.verification.results[0]).toMatchObject({
          status: "fail",
        });
        expect(staleVerification.task.verification.results[0]?.commitSha).not.toBe(buildSha);

        const staleSignoff = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.verification.signoff",
              commandId: CommandId.make("command-stale-signoff"),
              taskId,
              createdAt: now(12),
            }),
          ),
        );
        expect(staleSignoff._tag).toBe("Failure");

        yield* Effect.tryPromise(() => git(worktreePath!, ["reset", "--hard", buildSha!]));
        const verified = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.verification.run",
              commandId: CommandId.make("command-verify"),
              taskId,
              createdAt: now(13),
              criterionId: "criterion-1",
            }),
          ),
        );
        expect(verified.task.verification.results[0]).toMatchObject({
          status: "pass",
          commitSha: buildSha,
        });

        const signedOff = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.verification.signoff",
              commandId: CommandId.make("command-signoff"),
              taskId,
              createdAt: now(14),
            }),
          ),
        );
        expect(signedOff.task.workflowRuns.at(-1)?.currentStage).toBe("verified");
        expect(signedOff.task.delivery.state).toBe("unavailable");
        yield* runtime.dispose;

        const restarted = yield* makeRuntime(repoRoot, baseDir, createCount);
        const restartedService = yield* restarted.runPromise(Effect.service(TaskWorkspaceService));
        const replayed = yield* restarted.runPromise(restartedService.getTask(taskId));
        expect(replayed?.workflowRuns.at(-1)?.currentStage).toBe("verified");
        expect(replayed?.build.resultingCommitSha).toBe(buildSha);
        expect(
          replayed?.artifacts.find((artifact) => artifact.kind === "questions")?.revisions,
        ).toHaveLength(1);
        expect(createCount.value).toBe(1);
        yield* restarted.dispose;
      }).pipe(Effect.scoped),
    30_000,
  );

  const slice2TaskId = TaskWorkspaceId.make("slice-2-integration");

  const createSlice2Task = (createdAt: string, repoRoot: string) =>
    command({
      type: "task.create",
      commandId: CommandId.make("s2-create"),
      taskId: slice2TaskId,
      createdAt,
      title: "Slice 2 integration",
      projectId,
      workspaceRoot: repoRoot,
      baseRef: "main",
      preset: "standard",
      approvalPolicy: "before-build",
    });

  const slice3TaskId = TaskWorkspaceId.make("slice-3-integration");

  it.effect(
    "pins the workflow definition at creation and drives stage rules from it",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot } = yield* setupRuntime("kata-task-s3-workflow-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

        const created = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.create",
              commandId: CommandId.make("s3-create"),
              taskId: slice3TaskId,
              createdAt: now(1),
              title: "Slice 3 workflow engine",
              projectId,
              workspaceRoot: repoRoot,
              baseRef: "main",
              preset: "standard",
              approvalPolicy: "before-build",
            }),
          ),
        );

        // The task pins a resolvable definition version and takes its initial
        // stage and prompt bundle from that definition, not from a constant.
        expect(created.task.versions.workflowDefinition).toBe("standard@0.1.0");
        expect(created.task.versions.prompt).toBe("task-workspace-slice-1@0.1.0");
        expect(created.task.workflowRuns.at(-1)?.definitionVersion).toBe("standard@0.1.0");
        expect(created.task.workflowRuns.at(-1)?.currentStage).toBe("questions");

        // Lazy provisioning: no worktree exists before Build.
        expect(created.task.workspace.repositories[0]?.worktreePath).toBeNull();
        expect(created.task.workspace.repositories[0]?.provisioningStatus).toBe("pending");

        // Artifact-kind gating is a definition lookup: `plan` is not writable at `questions`.
        const wrongKind = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s3-wrong-kind"),
              taskId: slice3TaskId,
              createdAt: now(2),
              kind: "plan",
              title: "Plan",
              markdown: "# Plan",
              sourceSessionId: null,
            }),
          ),
        );
        expect(wrongKind._tag).toBe("Failure");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s3-questions"),
              taskId: slice3TaskId,
              createdAt: now(3),
              kind: "questions",
              title: "Questions",
              markdown: "# Questions\n\nNone.",
              sourceSessionId: null,
            }),
          ),
        );

        const advanced = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.questions.complete",
              commandId: CommandId.make("s3-questions-complete"),
              taskId: slice3TaskId,
              createdAt: now(4),
            }),
          ),
        );
        expect(advanced.task.workflowRuns.at(-1)?.currentStage).toBe("plan");
        // Still no worktree at Plan — provisioning happens at the Build transition.
        expect(advanced.task.workspace.repositories[0]?.worktreePath).toBeNull();

        // Transition legality comes from the table: the same transition is not
        // available a second time because `plan` is no longer its `from` stage.
        const repeated = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.questions.complete",
              commandId: CommandId.make("s3-questions-complete-again"),
              taskId: slice3TaskId,
              createdAt: now(5),
            }),
          ),
        );
        expect(repeated._tag).toBe("Failure");
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "persists block index and lineage and runs Slice 2 sessions/manifests without advancing the workflow",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot } = yield* setupRuntime("kata-task-s2-sessions-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

        yield* runtime.runPromise(service.dispatch(createSlice2Task(now(1), repoRoot)));

        // Primary session links in the questions stage.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-link-primary"),
              taskId: slice2TaskId,
              createdAt: now(2),
              stage: "questions",
              threadId: ThreadId.make("thread-primary"),
              role: "primary",
            }),
          ),
        );

        // Artifact upsert persists a block index with heading paths and content hashes.
        const withBlocks = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s2-questions-r1"),
              taskId: slice2TaskId,
              createdAt: now(3),
              kind: "questions",
              title: "Questions",
              markdown: [
                "---",
                "status: approved",
                "---",
                "<!-- kata:block:intro -->",
                "# Intro",
                "First body.",
                "",
                "<!-- kata:block:steps -->",
                "# Steps",
                "Do the thing.",
                "",
              ].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        const revision1 = withBlocks.task.artifacts[0]?.revisions[0];
        expect(revision1?.blockIndex).toEqual([
          expect.objectContaining({ id: "intro", headingPath: ["Intro"] }),
          expect.objectContaining({ id: "steps", headingPath: ["Steps"] }),
        ]);
        expect(revision1?.blockIndex[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
        expect(revision1?.supersedesRevisionId).toBeNull();

        // Frontmatter `status: approved` does not mutate the workflow.
        expect(withBlocks.task.workflowRuns.at(-1)?.currentStage).toBe("questions");

        // Context manifest for downstream sessions.
        const manifested = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("s2-manifest"),
              taskId: slice2TaskId,
              createdAt: now(4),
              artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["intro"] }],
              notes: "context for alternatives",
              sessionId: "session-1",
            }),
          ),
        );
        expect(manifested.task.contextManifests).toEqual([
          expect.objectContaining({ id: "manifest-1", notes: "context for alternatives" }),
        ]);

        const missingRevisionManifest = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("s2-manifest-missing-revision"),
              taskId: slice2TaskId,
              createdAt: now(4),
              artifactRefs: [{ kind: "questions", revision: 0, blockIds: [] }],
              notes: null,
              sessionId: null,
            }),
          ),
        );
        expect(missingRevisionManifest._tag).toBe("Failure");

        const missingBlockManifest = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("s2-manifest-missing-block"),
              taskId: slice2TaskId,
              createdAt: now(4),
              artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["missing"] }],
              notes: null,
              sessionId: null,
            }),
          ),
        );
        expect(missingBlockManifest._tag).toBe("Failure");

        const missingSessionManifest = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("s2-manifest-missing-session"),
              taskId: slice2TaskId,
              createdAt: now(4),
              artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["intro"] }],
              notes: null,
              sessionId: "session-999",
            }),
          ),
        );
        expect(missingSessionManifest._tag).toBe("Failure");

        // Alternative link without a manifest is rejected.
        const alternativeWithoutManifest = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-alt-no-manifest"),
              taskId: slice2TaskId,
              createdAt: now(5),
              stage: "questions",
              threadId: ThreadId.make("thread-alt"),
              role: "alternative",
            }),
          ),
        );
        expect(alternativeWithoutManifest._tag).toBe("Failure");

        const alternativeWithUnknownManifest = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-alt-unknown-manifest"),
              taskId: slice2TaskId,
              createdAt: now(5),
              stage: "questions",
              threadId: ThreadId.make("thread-alt-unknown"),
              role: "alternative",
              contextManifestId: "manifest-999",
            }),
          ),
        );
        expect(alternativeWithUnknownManifest._tag).toBe("Failure");

        // Alternative link with a manifest succeeds.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-alt-manifest"),
              taskId: slice2TaskId,
              createdAt: now(6),
              stage: "questions",
              threadId: ThreadId.make("thread-alt"),
              role: "alternative",
              contextManifestId: "manifest-1",
            }),
          ),
        );

        // Ad-hoc link uses stage null and does not advance the workflow.
        const adHoc = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-adhoc"),
              taskId: slice2TaskId,
              createdAt: now(7),
              stage: null,
              threadId: ThreadId.make("thread-adhoc"),
              role: "ad-hoc",
            }),
          ),
        );
        expect(adHoc.task.workflowRuns.at(-1)?.currentStage).toBe("questions");
        expect(
          adHoc.task.sessions.find((session) => session.threadId === "thread-adhoc"),
        ).toMatchObject({ role: "ad-hoc", stage: null });

        const reusedLinkThread = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-link-reused-thread"),
              taskId: slice2TaskId,
              createdAt: now(7),
              stage: "questions",
              threadId: ThreadId.make("thread-primary"),
              role: "debugging",
            }),
          ),
        );
        expect(reusedLinkThread._tag).toBe("Failure");

        // Fork records parent + fork point + manifest.
        const forked = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.fork",
              commandId: CommandId.make("s2-fork"),
              taskId: slice2TaskId,
              createdAt: now(8),
              parentSessionId: "session-1",
              threadId: ThreadId.make("thread-fork"),
              forkPoint: "turn-3",
              role: "reviewer",
              contextManifestId: "manifest-1",
              stage: "questions",
            }),
          ),
        );
        expect(
          forked.task.sessions.find((session) => session.threadId === "thread-fork"),
        ).toMatchObject({
          role: "reviewer",
          parentSessionId: "session-1",
          forkPoint: "turn-3",
          contextManifestId: "manifest-1",
        });

        // Fork against a missing parent fails loudly.
        const missingParentFork = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.session.fork",
              commandId: CommandId.make("s2-fork-missing"),
              taskId: slice2TaskId,
              createdAt: now(9),
              parentSessionId: "session-999",
              threadId: ThreadId.make("thread-fork-missing"),
              forkPoint: "turn-1",
              role: "reviewer",
              contextManifestId: "manifest-1",
              stage: "questions",
            }),
          ),
        );
        expect(missingParentFork._tag).toBe("Failure");

        const missingManifestFork = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.session.fork",
              commandId: CommandId.make("s2-fork-missing-manifest"),
              taskId: slice2TaskId,
              createdAt: now(9),
              parentSessionId: "session-1",
              threadId: ThreadId.make("thread-fork-missing-manifest"),
              forkPoint: "turn-1",
              role: "reviewer",
              contextManifestId: "manifest-999",
              stage: "questions",
            }),
          ),
        );
        expect(missingManifestFork._tag).toBe("Failure");

        const reusedForkThread = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.session.fork",
              commandId: CommandId.make("s2-fork-reused-thread"),
              taskId: slice2TaskId,
              createdAt: now(9),
              parentSessionId: "session-1",
              threadId: ThreadId.make("thread-alt"),
              forkPoint: "turn-2",
              role: "reviewer",
              contextManifestId: "manifest-1",
              stage: "questions",
            }),
          ),
        );
        expect(reusedForkThread._tag).toBe("Failure");

        // Second revision sets lineage back to the first revision.
        const withSecond = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s2-questions-r2"),
              taskId: slice2TaskId,
              createdAt: now(10),
              kind: "questions",
              title: "Questions",
              markdown: ["<!-- kata:block:intro -->", "# Intro", "Second body.", ""].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        const artifact = withSecond.task.artifacts[0];
        expect(artifact?.currentRevision).toBe(2);
        expect(artifact?.revisions[1]?.supersedesRevisionId).toBe("questions-revision-1");

        // Select the older revision as current without deleting newer revisions.
        const selected = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.select-revision",
              commandId: CommandId.make("s2-select"),
              taskId: slice2TaskId,
              createdAt: now(11),
              kind: "questions",
              revision: 1,
            }),
          ),
        );
        expect(selected.task.artifacts[0]?.currentRevision).toBe(1);
        expect(selected.task.artifacts[0]?.revisions).toHaveLength(2);

        // Upsert after selecting an older current must append a unique tip (r3),
        // not collide with the existing r2 lineage entry / revision id.
        const afterSelectUpsert = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s2-questions-r3-after-select"),
              taskId: slice2TaskId,
              createdAt: now(12),
              kind: "questions",
              title: "Questions",
              markdown: ["<!-- kata:block:intro -->", "# Intro", "Third body.", ""].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        const afterSelectArtifact = afterSelectUpsert.task.artifacts[0];
        expect(afterSelectArtifact?.currentRevision).toBe(3);
        expect(afterSelectArtifact?.revisions.map((entry) => entry.revision)).toEqual([1, 2, 3]);
        expect(afterSelectArtifact?.revisions.map((entry) => entry.id)).toEqual([
          "questions-revision-1",
          "questions-revision-2",
          "questions-revision-3",
        ]);
        expect(afterSelectArtifact?.revisions[2]?.supersedesRevisionId).toBe(
          "questions-revision-1",
        );

        // Selecting a non-existent revision fails.
        const badSelect = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.artifact.select-revision",
              commandId: CommandId.make("s2-select-bad"),
              taskId: slice2TaskId,
              createdAt: now(13),
              kind: "questions",
              revision: 99,
            }),
          ),
        );
        expect(badSelect._tag).toBe("Failure");

        const duplicateBlockUpsert = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s2-duplicate-block"),
              taskId: slice2TaskId,
              createdAt: now(13),
              kind: "questions",
              title: "Questions",
              markdown: [
                "<!-- kata:block:intro -->",
                "# Intro",
                "First.",
                "<!-- kata:block:intro -->",
                "# Intro again",
                "Second.",
              ].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        expect(duplicateBlockUpsert._tag).toBe("Failure");
        const afterDuplicateBlock = yield* runtime.runPromise(service.getTask(slice2TaskId));
        expect(afterDuplicateBlock?.artifacts[0]?.currentRevision).toBe(3);
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "tracks comment lifecycle across content, heading, reorder, and removal edits",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot } = yield* setupRuntime("kata-task-s2-comments-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

        yield* runtime.runPromise(service.dispatch(createSlice2Task(now(1), repoRoot)));

        const upsert = (commandId: string, createdAt: string, markdown: string) =>
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make(commandId),
              taskId: slice2TaskId,
              createdAt,
              kind: "questions",
              title: "Questions",
              markdown,
              sourceSessionId: null,
            }),
          );

        // Adjacent markers with a single trailing newline keep each block's
        // hashed region position-stable so reorders preserve identity.
        const rev1 = [
          "<!-- kata:block:intro -->",
          "# Intro",
          "First body.",
          "<!-- kata:block:steps -->",
          "# Steps",
          "Do the thing.",
          "",
        ].join("\n");
        yield* runtime.runPromise(upsert("s2c-r1", now(2), rev1));

        // Create + reply on the intro block.
        const created = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.comment.create",
              commandId: CommandId.make("s2c-comment"),
              taskId: slice2TaskId,
              createdAt: now(3),
              artifactId: "questions-artifact",
              anchorBlockId: "intro",
              baseRevisionId: "questions-revision-1",
              author: { kind: "user", id: "user-1", displayName: "Ada" },
              body: "Clarify the intro.",
            }),
          ),
        );
        expect(created.task.comments).toEqual([
          expect.objectContaining({ id: "comment-1", status: "open", anchorBlockId: "intro" }),
        ]);

        // Duplicate command id does not create another thread.
        const duplicate = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.comment.create",
              commandId: CommandId.make("s2c-comment"),
              taskId: slice2TaskId,
              createdAt: now(3),
              artifactId: "questions-artifact",
              anchorBlockId: "intro",
              baseRevisionId: "questions-revision-1",
              author: { kind: "user", id: "user-1", displayName: "Ada" },
              body: "Clarify the intro.",
            }),
          ),
        );
        expect(duplicate.task.comments).toHaveLength(1);

        // Comment against a missing block fails loudly.
        const missingBlock = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.comment.create",
              commandId: CommandId.make("s2c-missing-block"),
              taskId: slice2TaskId,
              createdAt: now(4),
              artifactId: "questions-artifact",
              anchorBlockId: "does-not-exist",
              baseRevisionId: "questions-revision-1",
              author: { kind: "user", id: "user-1", displayName: "Ada" },
              body: "No anchor.",
            }),
          ),
        );
        expect(missingBlock._tag).toBe("Failure");

        const replied = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.comment.reply",
              commandId: CommandId.make("s2c-reply"),
              taskId: slice2TaskId,
              createdAt: now(5),
              threadId: "comment-1",
              author: { kind: "agent", id: "agent-1", displayName: "Kata" },
              body: "On it.",
            }),
          ),
        );
        expect(replied.task.comments[0]?.messages).toHaveLength(2);

        // Comment on the steps block too.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.comment.create",
              commandId: CommandId.make("s2c-steps"),
              taskId: slice2TaskId,
              createdAt: now(6),
              artifactId: "questions-artifact",
              anchorBlockId: "steps",
              baseRevisionId: "questions-revision-1",
              author: { kind: "user", id: "user-1", displayName: "Ada" },
              body: "Steps look fine.",
            }),
          ),
        );

        // Boundary-only whitespace changes do not invalidate block hashes.
        const withBoundaryWhitespace = `${rev1.replace(
          "<!-- kata:block:steps -->",
          "\n\n<!-- kata:block:steps -->",
        )}\n\n`;
        const afterBoundaryWhitespace = yield* runtime.runPromise(
          upsert("s2c-boundary-whitespace", now(7), withBoundaryWhitespace),
        );
        expect(afterBoundaryWhitespace.task.comments.map((thread) => thread.status)).toEqual([
          "open",
          "open",
        ]);

        // Semantic trailing spaces remain part of the block hash because Markdown
        // renders two spaces before a newline as a hard line break.
        const withHardBreak = rev1.replace(
          "First body.\n<!-- kata:block:steps -->",
          "First body.  \n<!-- kata:block:steps -->",
        );
        const afterHardBreak = yield* runtime.runPromise(
          upsert("s2c-hard-break", now(7), withHardBreak),
        );
        expect(afterHardBreak.task.comments.map((thread) => thread.status)).toEqual([
          "outdated",
          "open",
        ]);

        // Revision 2 changes the intro body only -> intro outdated, steps still open.
        const rev2 = [
          "<!-- kata:block:intro -->",
          "# Intro",
          "Changed body.",
          "<!-- kata:block:steps -->",
          "# Steps",
          "Do the thing.",
          "",
        ].join("\n");
        const afterContentChange = yield* runtime.runPromise(upsert("s2c-r2", now(7), rev2));
        const introThread = afterContentChange.task.comments.find((t) => t.id === "comment-1");
        const stepsThread = afterContentChange.task.comments.find((t) => t.id === "comment-2");
        expect(introThread?.status).toBe("outdated");
        expect(stepsThread?.status).toBe("open");

        // Revision 3 restores the intro body to the base hash -> intro open again.
        const afterRestore = yield* runtime.runPromise(upsert("s2c-r3", now(8), rev1));
        expect(afterRestore.task.comments.find((t) => t.id === "comment-1")?.status).toBe("open");

        // Resolve the steps thread; resolved threads never change afterwards.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.comment.resolve",
              commandId: CommandId.make("s2c-resolve"),
              taskId: slice2TaskId,
              createdAt: now(9),
              threadId: "comment-2",
              resolvedBy: { kind: "user", id: "user-1", displayName: "Ada" },
            }),
          ),
        );

        // Reply to a resolved thread is rejected.
        const replyResolved = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.comment.reply",
              commandId: CommandId.make("s2c-reply-resolved"),
              taskId: slice2TaskId,
              createdAt: now(10),
              threadId: "comment-2",
              author: { kind: "user", id: "user-1", displayName: "Ada" },
              body: "Reopen?",
            }),
          ),
        );
        expect(replyResolved._tag).toBe("Failure");

        // Revision 4 changes only the intro heading text -> intro outdated (region hash changed);
        // the resolved steps thread stays resolved.
        const rev4 = [
          "<!-- kata:block:intro -->",
          "# Introduction",
          "First body.",
          "<!-- kata:block:steps -->",
          "# Steps",
          "Do the thing.",
          "",
        ].join("\n");
        const afterHeading = yield* runtime.runPromise(upsert("s2c-r4", now(11), rev4));
        expect(afterHeading.task.comments.find((t) => t.id === "comment-1")?.status).toBe(
          "outdated",
        );
        expect(afterHeading.task.comments.find((t) => t.id === "comment-2")?.status).toBe(
          "resolved",
        );

        // Revision 5 reorders blocks without changing their contents -> intro restored to open.
        const reorderable = [
          "<!-- kata:block:steps -->",
          "# Steps",
          "Do the thing.",
          "<!-- kata:block:intro -->",
          "# Intro",
          "First body.",
          "",
        ].join("\n");
        const afterReorder = yield* runtime.runPromise(upsert("s2c-r5", now(12), reorderable));
        expect(afterReorder.task.comments.find((t) => t.id === "comment-1")?.status).toBe("open");

        // Revision 6 removes the intro marker -> intro thread becomes orphaned.
        const rev6 = ["<!-- kata:block:steps -->", "# Steps", "Do the thing.", ""].join("\n");
        const afterOrphan = yield* runtime.runPromise(upsert("s2c-r6", now(13), rev6));
        expect(afterOrphan.task.comments.find((t) => t.id === "comment-1")?.status).toBe(
          "orphaned",
        );
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "replays Slice 2 comments, sessions, manifests, and block indexes after restart",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-s2-restart-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

        yield* runtime.runPromise(service.dispatch(createSlice2Task(now(1), repoRoot)));
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s2r-upsert"),
              taskId: slice2TaskId,
              createdAt: now(2),
              kind: "questions",
              title: "Questions",
              markdown: ["<!-- kata:block:intro -->", "# Intro", "Body.", ""].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("s2r-manifest"),
              taskId: slice2TaskId,
              createdAt: now(3),
              artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["intro"] }],
              notes: null,
              sessionId: null,
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2r-link"),
              taskId: slice2TaskId,
              createdAt: now(4),
              stage: "questions",
              threadId: ThreadId.make("thread-restart"),
              role: "alternative",
              contextManifestId: "manifest-1",
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.comment.create",
              commandId: CommandId.make("s2r-comment"),
              taskId: slice2TaskId,
              createdAt: now(5),
              artifactId: "questions-artifact",
              anchorBlockId: "intro",
              baseRevisionId: "questions-revision-1",
              author: { kind: "user", id: "user-1", displayName: "Ada" },
              body: "Please expand.",
            }),
          ),
        );
        yield* runtime.dispose;

        const restarted = yield* makeRuntime(repoRoot, baseDir, { value: 0 });
        const restartedService = yield* restarted.runPromise(Effect.service(TaskWorkspaceService));
        const replayed = yield* restarted.runPromise(restartedService.getTask(slice2TaskId));
        expect(replayed?.contextManifests).toHaveLength(1);
        expect(replayed?.sessions.find((s) => s.threadId === "thread-restart")).toMatchObject({
          role: "alternative",
          contextManifestId: "manifest-1",
          status: "active",
          provider: null,
        });
        expect(replayed?.artifacts[0]?.revisions[0]?.blockIndex[0]).toMatchObject({ id: "intro" });
        expect(replayed?.comments[0]).toMatchObject({
          id: "comment-1",
          status: "open",
          anchorBlockId: "intro",
        });
        expect(replayed?.comments[0]?.messages[0]?.author).toMatchObject({
          kind: "user",
          displayName: "Ada",
        });
        yield* restarted.dispose;
      }).pipe(Effect.scoped),
    30_000,
  );

  const guidedTaskId = TaskWorkspaceId.make("guided-integration");
  const freeformTaskId = TaskWorkspaceId.make("freeform-integration");

  /** A block long enough that a small budget is guaranteed to overflow. */
  const longBlock = (id: string, filler: string) =>
    [`<!-- kata:block:${id} -->`, `# ${id}`, filler.repeat(20), ""].join("\n");

  it.effect(
    "runs the Guided rail through Research and Design, one artifact per stage",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot } = yield* setupRuntime("kata-task-guided-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

        const created = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.create",
              commandId: CommandId.make("guided-create"),
              taskId: guidedTaskId,
              createdAt: now(1),
              title: "Guided integration",
              projectId,
              workspaceRoot: repoRoot,
              baseRef: "main",
              preset: "guided",
              approvalPolicy: "before-build",
            }),
          ),
        );
        expect(created.task.versions.workflowDefinition).toBe("guided@0.1.0");
        expect(created.task.versions.prompt).toBe("task-workspace-guided@0.1.0");
        expect(created.task.workflowRuns.at(-1)).toMatchObject({
          id: "guided-run-1",
          preset: "guided",
          definitionVersion: "guided@0.1.0",
          currentStage: "questions",
        });
        // TW-S3-AC08 for Guided: no worktree before Build.
        expect(created.task.workspace.repositories[0]?.worktreePath).toBeNull();
        expect(created.task.workspace.repositories[0]?.provisioningStatus).toBe("pending");

        // Questions -> Research, not Questions -> Plan: the successor comes from
        // the pinned definition, so the same command lands somewhere different
        // than it does under Standard.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("guided-questions"),
              taskId: guidedTaskId,
              createdAt: now(2),
              kind: "questions",
              title: "Questions",
              markdown: ["<!-- kata:block:scope -->", "# Scope", "What ships?", ""].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        const atResearch = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.questions.complete",
              commandId: CommandId.make("guided-questions-complete"),
              taskId: guidedTaskId,
              createdAt: now(3),
            }),
          ),
        );
        expect(atResearch.task.workflowRuns.at(-1)?.currentStage).toBe("research");

        // Design cannot be completed from Research: transition legality is the table's.
        const skipAhead = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.design.complete",
              commandId: CommandId.make("guided-skip-design"),
              taskId: guidedTaskId,
              createdAt: now(4),
            }),
          ),
        );
        expect(skipAhead._tag).toBe("Failure");

        // Research stage writes a `research` artifact and nothing else.
        const wrongKindAtResearch = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("guided-wrong-kind"),
              taskId: guidedTaskId,
              createdAt: now(5),
              kind: "design",
              title: "Design",
              markdown: "# Design",
              sourceSessionId: null,
            }),
          ),
        );
        expect(wrongKindAtResearch._tag).toBe("Failure");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("guided-research"),
              taskId: guidedTaskId,
              createdAt: now(6),
              kind: "research",
              title: "Research",
              markdown: ["<!-- kata:block:prior-art -->", "# Prior art", "Findings.", ""].join(
                "\n",
              ),
              sourceSessionId: null,
            }),
          ),
        );

        // TW-S3-AC03: the next-stage manifest records the exact blocks carried,
        // a token estimate, and the budget it was measured against.
        const manifested = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("guided-manifest"),
              taskId: guidedTaskId,
              createdAt: now(7),
              artifactRefs: [
                { kind: "questions", revision: 1, blockIds: ["scope"] },
                { kind: "research", revision: 1, blockIds: ["prior-art"] },
              ],
              notes: "carried into design",
              sessionId: null,
            }),
          ),
        );
        const manifest = manifested.task.contextManifests.at(-1);
        expect(manifest?.artifactRefs.flatMap((ref) => ref.blockIds)).toEqual([
          "scope",
          "prior-art",
        ]);
        // Omitting `budget` takes the workflow default rather than leaving the
        // manifest unbudgeted.
        expect(manifest?.budget).toBe(32_000);
        expect(manifest?.tokenEstimate).toBeGreaterThan(0);
        expect(manifest?.tokenEstimate).toBeLessThan(32_000);
        // Well under budget, so nothing was compressed and no summary exists.
        expect(manifest?.compressedBlockCount).toBe(0);
        expect(manifest?.summaryArtifactRef).toBeNull();
        expect(manifested.task.artifacts.some((artifact) => artifact.kind === "summary")).toBe(
          false,
        );

        const atDesign = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.research.complete",
              commandId: CommandId.make("guided-research-complete"),
              taskId: guidedTaskId,
              createdAt: now(8),
            }),
          ),
        );
        expect(atDesign.task.workflowRuns.at(-1)?.currentStage).toBe("design");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("guided-design"),
              taskId: guidedTaskId,
              createdAt: now(9),
              kind: "design",
              title: "Design",
              markdown: ["<!-- kata:block:shape -->", "# Shape", "The approach.", ""].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        const atPlan = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.design.complete",
              commandId: CommandId.make("guided-design-complete"),
              taskId: guidedTaskId,
              createdAt: now(10),
            }),
          ),
        );
        expect(atPlan.task.workflowRuns.at(-1)?.currentStage).toBe("plan");

        // TW-S3-AC02: one artifact per reasoning stage, each with its own lineage.
        expect(atPlan.task.artifacts.map((artifact) => artifact.kind)).toEqual([
          "questions",
          "research",
          "design",
        ]);
        for (const artifact of atPlan.task.artifacts) {
          expect(artifact.revisions).toHaveLength(1);
          expect(artifact.currentRevision).toBe(1);
        }
        // Still nothing provisioned: Guided reaches Plan without a worktree.
        expect(atPlan.task.workspace.repositories[0]?.worktreePath).toBeNull();
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "rejects Guided reasoning commands on a Standard task",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot } = yield* setupRuntime("kata-task-standard-guard-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
        const standardTaskId = TaskWorkspaceId.make("standard-guard");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.create",
              commandId: CommandId.make("sg-create"),
              taskId: standardTaskId,
              createdAt: now(1),
              title: "Standard guard",
              projectId,
              workspaceRoot: repoRoot,
              baseRef: "main",
              preset: "standard",
              approvalPolicy: "before-build",
            }),
          ),
        );

        // Standard's table declares no research/design transition, so the
        // widened command union does not widen Standard's behavior.
        for (const [id, type] of [
          ["sg-research", "task.research.complete"],
          ["sg-design", "task.design.complete"],
        ] as const) {
          const exit = yield* runtime.runPromiseExit(
            service.dispatch(
              command({
                type,
                commandId: CommandId.make(id),
                taskId: standardTaskId,
                createdAt: now(2),
              }),
            ),
          );
          expect(exit._tag).toBe("Failure");
        }

        // Standard declares no explicit entries at all.
        const explicitEntry = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.stage.start",
              commandId: CommandId.make("sg-stage-start"),
              taskId: standardTaskId,
              createdAt: now(3),
              stage: "plan",
            }),
          ),
        );
        expect(explicitEntry._tag).toBe("Failure");
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "summarizes an over-budget context selection and records the compression",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot } = yield* setupRuntime("kata-task-budget-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
        const budgetTaskId = TaskWorkspaceId.make("budget-integration");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.create",
              commandId: CommandId.make("budget-create"),
              taskId: budgetTaskId,
              createdAt: now(1),
              title: "Budget integration",
              projectId,
              workspaceRoot: repoRoot,
              baseRef: "main",
              preset: "guided",
              approvalPolicy: "before-build",
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("budget-questions"),
              taskId: budgetTaskId,
              createdAt: now(2),
              kind: "questions",
              title: "Questions",
              markdown: [
                longBlock("alpha", "alpha detail. "),
                longBlock("beta", "beta detail. "),
              ].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );

        const refs = [{ kind: "questions" as const, revision: 1, blockIds: ["alpha", "beta"] }];

        // Under budget: raw blocks are carried and nothing is compressed.
        const roomy = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("budget-roomy"),
              taskId: budgetTaskId,
              createdAt: now(3),
              artifactRefs: refs,
              notes: null,
              sessionId: null,
              budget: 100_000,
            }),
          ),
        );
        const roomyManifest = roomy.task.contextManifests.at(-1);
        expect(roomyManifest?.budget).toBe(100_000);
        expect(roomyManifest?.compressedBlockCount).toBe(0);
        expect(roomyManifest?.summaryArtifactRef).toBeNull();
        expect(roomy.task.artifacts.some((artifact) => artifact.kind === "summary")).toBe(false);
        const rawEstimate = roomyManifest?.tokenEstimate ?? 0;
        expect(rawEstimate).toBeGreaterThan(50);

        // TW-S3-AC04: over budget produces a `summary` artifact, the manifest
        // references it, and the compression is recorded rather than silent.
        const tight = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("budget-tight"),
              taskId: budgetTaskId,
              createdAt: now(4),
              artifactRefs: refs,
              notes: null,
              sessionId: null,
              budget: 20,
            }),
          ),
        );
        const tightManifest = tight.task.contextManifests.at(-1);
        expect(tightManifest?.budget).toBe(20);
        expect(tightManifest?.tokenEstimate).toBe(rawEstimate);
        expect(tightManifest?.compressedBlockCount).toBe(2);
        expect(tightManifest?.summaryArtifactRef).toMatchObject({ kind: "summary", revision: 1 });

        const summary = tight.task.artifacts.find((artifact) => artifact.kind === "summary");
        expect(summary).toBeTruthy();
        expect(summary?.currentRevision).toBe(1);
        const summaryMarkdown = summary?.revisions.at(-1)?.markdown ?? "";
        // The summary names what it stands in for, so the compression is auditable.
        expect(summaryMarkdown).toContain("Compressed 2 block(s)");
        expect(summaryMarkdown).toContain("alpha");
        expect(summaryMarkdown).toContain("beta");
        // Provenance is preserved: the manifest still records which blocks the
        // summary replaced, so the inspector can show what was lost.
        expect(tightManifest?.artifactRefs.flatMap((ref) => ref.blockIds)).toEqual([
          "alpha",
          "beta",
        ]);

        // A second overflow appends a new summary revision rather than colliding.
        const again = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("budget-tight-again"),
              taskId: budgetTaskId,
              createdAt: now(5),
              artifactRefs: refs,
              notes: null,
              sessionId: null,
              budget: 20,
            }),
          ),
        );
        expect(again.task.contextManifests.at(-1)?.summaryArtifactRef).toMatchObject({
          revision: 2,
        });
        expect(
          again.task.artifacts.find((artifact) => artifact.kind === "summary")?.revisions,
        ).toHaveLength(2);

        // The generated replacement is itself hard-bounded, even when the
        // effective budget is too small for the normal summary header.
        const tiny = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("budget-tiny"),
              taskId: budgetTaskId,
              createdAt: now(6),
              artifactRefs: refs,
              notes: null,
              sessionId: null,
              budget: 1,
            }),
          ),
        );
        const tinySummary =
          tiny.task.artifacts.find((artifact) => artifact.kind === "summary")?.revisions.at(-1)
            ?.markdown ?? "";
        expect(Math.ceil(tinySummary.length / 4)).toBeLessThanOrEqual(1);
        expect(tiny.task.contextManifests.at(-1)?.summaryArtifactRef).toMatchObject({
          revision: 3,
        });

        // An explicit null budget opts out of budgeting entirely.
        const unbudgeted = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("budget-none"),
              taskId: budgetTaskId,
              createdAt: now(6),
              artifactRefs: refs,
              notes: null,
              sessionId: null,
              budget: null,
            }),
          ),
        );
        expect(unbudgeted.task.contextManifests.at(-1)?.budget).toBeNull();
        expect(unbudgeted.task.contextManifests.at(-1)?.compressedBlockCount).toBe(0);

        // `summary` is machine-generated only: it is not any stage's kind, so a
        // direct write of one is refused by the same gate that guards the rail.
        const directSummary = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("budget-direct-summary"),
              taskId: budgetTaskId,
              createdAt: now(7),
              kind: "summary",
              title: "Hand-written summary",
              markdown: "# Nope",
              sourceSessionId: null,
            }),
          ),
        );
        expect(directSummary._tag).toBe("Failure");
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "accumulates a Freeform task with no rail and converges through explicit stage entry",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot } = yield* setupRuntime("kata-task-freeform-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

        const created = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.create",
              commandId: CommandId.make("ff-create"),
              taskId: freeformTaskId,
              createdAt: now(1),
              title: "Freeform integration",
              projectId,
              workspaceRoot: repoRoot,
              baseRef: "main",
              preset: "freeform",
              approvalPolicy: "before-build",
            }),
          ),
        );
        expect(created.task.versions.workflowDefinition).toBe("freeform@0.1.0");
        expect(created.task.workflowRuns.at(-1)).toMatchObject({
          id: "freeform-run-1",
          preset: "freeform",
          currentStage: "questions",
        });
        // TW-S3-AC08 for Freeform.
        expect(created.task.workspace.repositories[0]?.worktreePath).toBeNull();

        // TW-S3-AC05: no automatic advancement. Completing questions is not a
        // transition Freeform declares, so the rail simply is not there.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("ff-questions"),
              taskId: freeformTaskId,
              createdAt: now(2),
              kind: "questions",
              title: "Questions",
              markdown: ["<!-- kata:block:notes -->", "# Notes", "Thinking out loud.", ""].join(
                "\n",
              ),
              sourceSessionId: null,
            }),
          ),
        );
        const noRail = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.questions.complete",
              commandId: CommandId.make("ff-questions-complete"),
              taskId: freeformTaskId,
              createdAt: now(3),
            }),
          ),
        );
        expect(noRail._tag).toBe("Failure");

        // Sessions accumulate without moving the stage.
        const sessioned = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("ff-link"),
              taskId: freeformTaskId,
              createdAt: now(4),
              stage: "questions",
              threadId: ThreadId.make("thread-freeform"),
              role: "primary",
            }),
          ),
        );
        expect(sessioned.task.workflowRuns.at(-1)?.currentStage).toBe("questions");

        // Explicit entry is the only way forward, and only into declared stages.
        const intoBuild = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.stage.start",
              commandId: CommandId.make("ff-into-build"),
              taskId: freeformTaskId,
              createdAt: now(5),
              stage: "build",
            }),
          ),
        );
        expect(intoBuild._tag).toBe("Failure");

        const sameStage = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.stage.start",
              commandId: CommandId.make("ff-same-stage"),
              taskId: freeformTaskId,
              createdAt: now(6),
              stage: "questions",
            }),
          ),
        );
        expect(sameStage._tag).toBe("Failure");

        const atResearch = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.stage.start",
              commandId: CommandId.make("ff-into-research"),
              taskId: freeformTaskId,
              createdAt: now(7),
              stage: "research",
            }),
          ),
        );
        expect(atResearch.task.workflowRuns.at(-1)?.currentStage).toBe("research");

        // Freeform can return to a stage it has left — the point of no rail.
        const backToQuestions = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.stage.start",
              commandId: CommandId.make("ff-back-to-questions"),
              taskId: freeformTaskId,
              createdAt: now(8),
              stage: "questions",
            }),
          ),
        );
        expect(backToQuestions.task.workflowRuns.at(-1)?.currentStage).toBe("questions");
        // ...and amend the artifact that stage owns, which is why the return trip matters.
        const amended = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("ff-questions-r2"),
              taskId: freeformTaskId,
              createdAt: now(9),
              kind: "questions",
              title: "Questions",
              markdown: ["<!-- kata:block:notes -->", "# Notes", "Revised.", ""].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        expect(
          amended.task.artifacts.find((artifact) => artifact.kind === "questions")?.revisions,
        ).toHaveLength(2);

        // Converge: explicit entry into Plan, then the usual approve/build path.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.stage.start",
              commandId: CommandId.make("ff-into-plan"),
              taskId: freeformTaskId,
              createdAt: now(10),
              stage: "plan",
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("ff-plan"),
              taskId: freeformTaskId,
              createdAt: now(11),
              kind: "plan",
              title: "Plan",
              markdown: "# Plan\n\nShip it.",
              sourceSessionId: null,
            }),
          ),
        );
        const approved = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.plan.approve",
              commandId: CommandId.make("ff-approve"),
              taskId: freeformTaskId,
              createdAt: now(12),
            }),
          ),
        );
        expect(approved.task.workflowRuns.at(-1)?.currentStage).toBe("build");
        expect(approved.task.workspace.repositories[0]?.provisioningStatus).toBe("provisioned");
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "retains preset, pinned versions, manifests, budgets, and summaries after restart",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-s3-restart-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
        const restartTaskId = TaskWorkspaceId.make("s3-restart");

        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.create",
              commandId: CommandId.make("s3r-create"),
              taskId: restartTaskId,
              createdAt: now(1),
              title: "Slice 3 restart",
              projectId,
              workspaceRoot: repoRoot,
              baseRef: "main",
              preset: "guided",
              approvalPolicy: "before-build",
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s3r-questions"),
              taskId: restartTaskId,
              createdAt: now(2),
              kind: "questions",
              title: "Questions",
              markdown: [
                longBlock("wide", "a lot of context. "),
                longBlock("also-wide", "even more context. "),
              ].join("\n"),
              sourceSessionId: null,
            }),
          ),
        );
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("s3r-manifest"),
              taskId: restartTaskId,
              createdAt: now(3),
              artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["wide", "also-wide"] }],
              notes: null,
              sessionId: null,
              budget: 25,
            }),
          ),
        );
        yield* runtime.dispose;

        // TW-S3-AC10: everything Slice 3b added survives a replay from the log.
        const restarted = yield* makeRuntime(repoRoot, baseDir, { value: 0 });
        const restartedService = yield* restarted.runPromise(Effect.service(TaskWorkspaceService));
        const replayed = yield* restarted.runPromise(restartedService.getTask(restartTaskId));

        expect(replayed?.versions.workflowDefinition).toBe("guided@0.1.0");
        expect(replayed?.workflowRuns.at(-1)).toMatchObject({
          preset: "guided",
          definitionVersion: "guided@0.1.0",
        });
        const manifest = replayed?.contextManifests.at(-1);
        expect(manifest?.budget).toBe(25);
        expect(manifest?.tokenEstimate).toBeGreaterThan(25);
        expect(manifest?.compressedBlockCount).toBe(2);
        expect(manifest?.summaryArtifactRef).toMatchObject({ kind: "summary", revision: 1 });
        expect(
          replayed?.artifacts.find((artifact) => artifact.kind === "summary")?.revisions,
        ).toHaveLength(1);
        yield* restarted.dispose;
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect(
    "projects hierarchical Build phases, checkpoints, amendments, and restart recovery",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-s4-build-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
        const dispatch = <T extends TaskWorkspaceCommand>(value: T) =>
          runtime.runPromise(service.dispatch(value));
        const slice4TaskId = TaskWorkspaceId.make("slice-4-integration");

        yield* dispatch(
          command({
            type: "task.create",
            commandId: CommandId.make("s4-create"),
            taskId: slice4TaskId,
            createdAt: now(1),
            title: "Slice 4 Build",
            projectId,
            workspaceRoot: repoRoot,
            baseRef: "main",
            preset: "standard",
            approvalPolicy: "before-build",
          }),
        );
        yield* dispatch(
          command({
            type: "task.artifact.upsert",
            commandId: CommandId.make("s4-questions"),
            taskId: slice4TaskId,
            createdAt: now(2),
            kind: "questions",
            title: "Questions",
            markdown: "# Questions\n\nNo blockers.",
            sourceSessionId: null,
          }),
        );
        yield* dispatch(
          command({
            type: "task.questions.complete",
            commandId: CommandId.make("s4-questions-complete"),
            taskId: slice4TaskId,
            createdAt: now(3),
          }),
        );
        const planMarkdown = [
          "# Plan",
          "",
          "## Phase Prepare",
          "Checkpoint policy: always",
          "",
          "### Work item Prepare fixture",
          "- Check: fixture.pass",
          "",
          "### Work item Prepare review",
          "Depends on: Prepare fixture",
          "- Manual check: operator review",
          "",
          "## Phase Implement",
          "Checkpoint policy: on-failure",
          "",
          "### Work item Implement fixture",
          "- Check: fixture.mismatch",
        ].join("\n");
        yield* dispatch(
          command({
            type: "task.artifact.upsert",
            commandId: CommandId.make("s4-plan"),
            taskId: slice4TaskId,
            createdAt: now(4),
            kind: "plan",
            title: "Plan",
            markdown: planMarkdown,
            sourceSessionId: null,
          }),
        );
        const approved = yield* dispatch(
          command({
            type: "task.plan.approve",
            commandId: CommandId.make("s4-plan-approve"),
            taskId: slice4TaskId,
            createdAt: now(5),
          }),
        );
        expect(approved.task.build.phases).toHaveLength(2);
        expect(approved.task.build.phases[0]?.workItems[1]?.dependsOn).toEqual(["work-item-1"]);
        expect(approved.task.build.checks.map((check) => [check.kind, check.command])).toEqual([
          ["automated", "fixture.pass"],
          ["manual", null],
          ["automated", "fixture.mismatch"],
        ]);

        const phaseStart = command({
          type: "task.build.phase.start",
          commandId: CommandId.make("s4-phase-start"),
          taskId: slice4TaskId,
          createdAt: now(6),
          phaseId: "phase-1",
        });
        const started = yield* dispatch(phaseStart);
        const duplicateStart = yield* dispatch(phaseStart);
        expect(duplicateStart.sequence).toBe(started.sequence);

        yield* dispatch(
          command({
            type: "task.build.work-item.set-status",
            commandId: CommandId.make("s4-work-1-running"),
            taskId: slice4TaskId,
            createdAt: now(7),
            workItemId: "work-item-1",
            status: "running",
          }),
        );
        yield* dispatch(
          command({
            type: "task.build.check.run",
            commandId: CommandId.make("s4-check-pass"),
            taskId: slice4TaskId,
            createdAt: now(8),
            checkId: "phase-1-check-1",
          }),
        );
        yield* dispatch(
          command({
            type: "task.build.work-item.set-status",
            commandId: CommandId.make("s4-work-1-complete"),
            taskId: slice4TaskId,
            createdAt: now(9),
            workItemId: "work-item-1",
            status: "completed",
          }),
        );
        yield* dispatch(
          command({
            type: "task.build.work-item.set-status",
            commandId: CommandId.make("s4-work-2-running"),
            taskId: slice4TaskId,
            createdAt: now(10),
            workItemId: "work-item-2",
            status: "running",
          }),
        );
        yield* dispatch(
          command({
            type: "task.build.check.record-manual",
            commandId: CommandId.make("s4-manual-check"),
            taskId: slice4TaskId,
            createdAt: now(11),
            checkId: "phase-1-check-2",
            status: "pass",
            note: "Reviewed by the operator.",
          }),
        );
        const prepared = yield* dispatch(
          command({
            type: "task.build.work-item.set-status",
            commandId: CommandId.make("s4-work-2-complete"),
            taskId: slice4TaskId,
            createdAt: now(12),
            workItemId: "work-item-2",
            status: "completed",
          }),
        );
        expect(prepared.task.build.checkpoints[0]).toMatchObject({
          phaseId: "phase-1",
          status: "waiting",
        });

        const manifest = yield* dispatch(
          command({
            type: "task.context-manifest.create",
            commandId: CommandId.make("s4-manifest"),
            taskId: slice4TaskId,
            createdAt: now(13),
            checkpointId: "checkpoint-1",
            artifactRefs: [{ kind: "plan", revision: 1, blockIds: [] }],
            notes: "Approved Plan and Build state.",
            sessionId: null,
            budget: null,
          }),
        );
        const continued = yield* dispatch(
          command({
            type: "task.build.checkpoint.continue",
            commandId: CommandId.make("s4-checkpoint-continue"),
            taskId: slice4TaskId,
            createdAt: now(14),
            checkpointId: "checkpoint-1",
            threadId: ThreadId.make("thread-s4-continuation"),
            contextManifestId: manifest.task.contextManifests[0]!.id,
          }),
        );
        expect(continued.task.build.checkpoints[0]).toMatchObject({
          contextManifestId: "manifest-1",
          continuationSessionId: "session-1",
        });
        expect(continued.task.build.activePhaseId).toBe("phase-2");
        expect(continued.task.sessions).toHaveLength(1);

        yield* dispatch(
          command({
            type: "task.build.work-item.set-status",
            commandId: CommandId.make("s4-implement-running"),
            taskId: slice4TaskId,
            createdAt: now(15),
            workItemId: "phase-2-work-item-1",
            status: "running",
          }),
        );
        const failed = yield* dispatch(
          command({
            type: "task.build.check.run",
            commandId: CommandId.make("s4-check-mismatch"),
            taskId: slice4TaskId,
            createdAt: now(16),
            checkId: "phase-2-check-1",
          }),
        );
        expect(failed.task.build.checks.at(-1)).toMatchObject({ status: "fail", exitCode: 1 });
        expect(failed.task.build.phases[1]?.status).toBe("blocked");
        const failureContinue = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.build.checkpoint.continue",
              commandId: CommandId.make("s4-failure-checkpoint-continue"),
              taskId: slice4TaskId,
              createdAt: now(16),
              checkpointId: "checkpoint-2",
              threadId: ThreadId.make("thread-s4-invalid-continue"),
              contextManifestId: "manifest-1",
            }),
          ),
        );
        expect(failureContinue._tag).toBe("Failure");
        const unrelatedDependentCheck = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.amendment.request",
              commandId: CommandId.make("s4-unrelated-dependent-check"),
              taskId: slice4TaskId,
              createdAt: now(17),
              phaseId: "phase-2",
              workItemId: "phase-2-work-item-1",
              checkId: "phase-2-check-1",
              expected: "fixture content",
              found: "mismatched content",
              impact: "The implementation fixture cannot pass.",
              proposedChanges: "Use the corrected fixture content.",
              affectedPhaseIds: ["phase-2"],
              affectedWorkItemIds: ["phase-2-work-item-1"],
              dependentCheckIds: ["phase-1-check-1"],
            }),
          ),
        );
        expect(unrelatedDependentCheck._tag).toBe("Failure");
        const fixtureBypass = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.fixture.apply",
              commandId: CommandId.make("s4-fixture-bypass"),
              taskId: slice4TaskId,
              createdAt: now(16),
            }),
          ),
        );
        expect(fixtureBypass._tag).toBe("Failure");
        const prematureComplete = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.build.work-item.set-status",
              commandId: CommandId.make("s4-implement-premature-complete"),
              taskId: slice4TaskId,
              createdAt: now(17),
              workItemId: "phase-2-work-item-1",
              status: "completed",
            }),
          ),
        );
        expect(prematureComplete._tag).toBe("Failure");

        const requested = yield* dispatch(
          command({
            type: "task.amendment.request",
            commandId: CommandId.make("s4-amendment-request"),
            taskId: slice4TaskId,
            createdAt: now(18),
            phaseId: "phase-2",
            workItemId: "phase-2-work-item-1",
            checkId: "phase-2-check-1",
            expected: "fixture content",
            found: "mismatched content",
            impact: "The implementation fixture cannot pass.",
            proposedChanges: "Use the corrected fixture content.",
            affectedPhaseIds: ["phase-2"],
            affectedWorkItemIds: ["phase-2-work-item-1"],
            dependentCheckIds: ["phase-2-check-1"],
          }),
        );
        expect(requested.task.build.amendmentGateId).toBe("amendment-1");
        expect(
          requested.task.artifacts.find((artifact) => artifact.kind === "amendment"),
        ).toBeTruthy();

        const approvedAmendment = yield* dispatch(
          command({
            type: "task.amendment.approve",
            commandId: CommandId.make("s4-amendment-approve"),
            taskId: slice4TaskId,
            createdAt: now(19),
            amendmentId: "amendment-1",
            approvedBy: "operator",
          }),
        );
        expect(approvedAmendment.task.build.currentPlanRevisionId).toBe("plan-revision-2");
        expect(approvedAmendment.task.build.amendments[0]?.status).toBe("approved");
        expect(approvedAmendment.task.build.phases[0]?.status).toBe("completed");
        expect(approvedAmendment.task.build.phases[1]?.status).toBe("invalidated");
        expect(approvedAmendment.task.build.phases[1]?.checkpointId).toBe("checkpoint-2");
        expect(approvedAmendment.task.build.checks.at(-1)?.status).toBe("pending");

        const resumedContext = yield* dispatch(
          command({
            type: "task.context-manifest.create",
            commandId: CommandId.make("s4-resume-manifest"),
            taskId: slice4TaskId,
            createdAt: now(19),
            checkpointId: "checkpoint-2",
            artifactRefs: [{ kind: "plan", revision: 2, blockIds: [] }],
            notes: "Amended Plan and Build state.",
            sessionId: null,
            budget: null,
          }),
        );
        expect(resumedContext.task.build.checkpoints[1]).toMatchObject({
          contextManifestId: "manifest-2",
          status: "waiting",
        });

        yield* runtime.dispose;
        const restarted = yield* makeRuntime(repoRoot, baseDir, { value: 0 });
        const restartedService = yield* restarted.runPromise(Effect.service(TaskWorkspaceService));
        const recovered = yield* restarted.runPromise(restartedService.getTask(slice4TaskId));
        expect(recovered?.build.amendmentGateId).toBeNull();
        expect(recovered?.build.currentPlanRevisionId).toBe("plan-revision-2");
        expect(recovered?.build.phases[1]?.status).toBe("invalidated");
        expect(recovered?.sessions).toHaveLength(1);

        const resumed = yield* restarted.runPromise(
          restartedService.dispatch(
            command({
              type: "task.build.resume",
              commandId: CommandId.make("s4-resume"),
              taskId: slice4TaskId,
              createdAt: now(20),
              checkpointId: "checkpoint-2",
              threadId: ThreadId.make("thread-s4-resumed"),
              contextManifestId: "manifest-2",
            }),
          ),
        );
        expect(resumed.task.build.phases[1]?.status).toBe("running");
        expect(resumed.task.build.phases[1]?.workItems[0]?.status).toBe("pending");
        expect(resumed.task.build.checkpoints[1]).toMatchObject({
          continuationSessionId: "session-2",
          status: "continued",
        });
        expect(resumed.task.sessions).toHaveLength(2);
        yield* restarted.runPromise(
          restartedService.dispatch(
            command({
              type: "task.build.work-item.set-status",
              commandId: CommandId.make("s4-resumed-running"),
              taskId: slice4TaskId,
              createdAt: now(21),
              workItemId: "phase-2-work-item-1",
              status: "running",
            }),
          ),
        );
        yield* restarted.runPromise(
          restartedService.dispatch(
            command({
              type: "task.build.check.run",
              commandId: CommandId.make("s4-amended-check"),
              taskId: slice4TaskId,
              createdAt: now(22),
              checkId: "phase-2-check-1",
            }),
          ),
        );
        const completed = yield* restarted.runPromise(
          restartedService.dispatch(
            command({
              type: "task.build.work-item.set-status",
              commandId: CommandId.make("s4-resumed-complete"),
              taskId: slice4TaskId,
              createdAt: now(23),
              workItemId: "phase-2-work-item-1",
              status: "completed",
            }),
          ),
        );
        expect(completed.task.build.checks.at(-1)?.status).toBe("pass");
        expect(completed.task.build.phases[1]?.status).toBe("completed");
        yield* restarted.dispose;
      }).pipe(Effect.scoped),
    30_000,
  );

  it.effect("fails startup when persisted task history is corrupt", () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-corrupt-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
          Effect.orDie,
        ),
      );
      const repoRoot = NodePath.join(root, "repo");
      const baseDir = NodePath.join(root, "state");
      yield* Effect.tryPromise(() => NodeFs.mkdir(repoRoot, { recursive: true }));
      yield* Effect.tryPromise(() =>
        NodeFs.mkdir(NodePath.join(baseDir, "userdata"), { recursive: true }),
      );
      yield* Effect.tryPromise(() =>
        NodeFs.writeFile(
          NodePath.join(baseDir, "userdata", "task-workspace-events.ndjson"),
          "{not valid json}\n",
          "utf8",
        ),
      );

      const exit = yield* Effect.exit(makeRuntime(repoRoot, baseDir, { value: 0 }));
      expect(exit._tag).toBe("Failure");
    }),
  );
});

const guidedCreate = (overrides: Record<string, unknown> = {}) =>
  command({
    type: "task.create",
    commandId: CommandId.make("wf-create-1"),
    taskId: TaskWorkspaceId.make("guided-task"),
    createdAt: now(1),
    title: "Guided onboarding",
    projectId,
    baseRef: "main",
    preset: "guided",
    approvalPolicy: "before-build",
    operationKey: "op-wf-create-1",
    brief: "Add a guided onboarding flow.",
    source: { kind: "inline", body: "Add a guided onboarding flow." },
    worktreePolicy: "later",
    modelSelection: {
      instanceId: ProviderInstanceId.make("instance-1"),
      model: "claude-sonnet-4",
      options: [{ id: "reasoningEffort", value: "high" }],
    },
    ...overrides,
  });

describe("TaskWorkspaceService first-slice workflow", () => {
  it.effect("creates a first-slice task with server-stamped identity", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot } = yield* setupRuntime("kata-task-slice5-create-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      const result = yield* runtime.runPromise(service.dispatch(guidedCreate()));

      expect(result.task.environmentId).toBe(EnvironmentId.make("environment-local"));
      expect(result.task.taskRevision).toBe(1);
      expect(result.task.intake).toEqual({
        brief: "Add a guided onboarding flow.",
        source: { kind: "inline", body: "Add a guided onboarding flow." },
      });
      expect(result.task.preferences).toEqual({
        worktreePolicy: "later",
        modelSelection: {
          instanceId: "instance-1",
          model: "claude-sonnet-4",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
        executionProfile: "planning",
      });
      expect(result.task.versions.taskContract).toBe("task-workspace@0.3.0");
      expect(result.task.versions.artifactContract).toBe("task-artifact@0.3.0");
      expect(result.task.occurrences[0]).toMatchObject({
        stage: "questions",
        ordinal: 0,
        status: "starting",
      });
      expect(result.task.workspace.repositories[0]?.provisioningStatus).toBe("not-requested");
      expect(result.task.workspace.repositories[0]?.baseCommitSha).toMatch(/^[0-9a-f]{40}$/u);
      expect(result.task.workspace.repositories[0]?.planningRootFingerprint).toMatch(
        /^[0-9a-f]{64}$/u,
      );
      expect(result.taskRoute).toEqual({
        environmentId: "environment-local",
        taskId: "guided-task",
      });
      expect(result.operation).toEqual({
        key: "op-wf-create-1",
        status: "completed",
        attempt: 1,
        error: null,
      });
      expect(repoRoot).toBeTruthy();
    }),
  );

  it.effect("replays one semantic operation across command ids without duplicate state", () =>
    Effect.gen(function* () {
      const { runtime } = yield* setupRuntime("kata-task-slice5-replay-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      const first = yield* runtime.runPromise(service.dispatch(guidedCreate()));
      const replayed = yield* runtime.runPromise(
        service.dispatch(guidedCreate({ commandId: CommandId.make("wf-create-2") })),
      );
      expect(replayed.task.id).toBe(first.task.id);
      expect(replayed.task.taskRevision).toBe(1);
      expect(replayed.operation.status).toBe("completed");
      expect(replayed.operation.attempt).toBe(1);

      // The same operation key with a different payload is a typed conflict.
      const conflict = yield* runtime.runPromise(
        service
          .dispatch(
            guidedCreate({
              commandId: CommandId.make("wf-create-3"),
              operationKey: "op-wf-create-1",
              brief: "A different brief.",
              source: { kind: "inline", body: "A different brief." },
            }),
          )
          .pipe(Effect.flip),
      );
      expect(conflict).toMatchObject({
        _tag: "TaskWorkspaceError",
        message: "Operation 'op-wf-create-1' was already used with a different payload.",
      });
    }),
  );

  it.effect("rejects a command id reused with a different payload", () =>
    Effect.gen(function* () {
      const { runtime } = yield* setupRuntime("kata-task-slice5-command-conflict-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      yield* runtime.runPromise(service.dispatch(guidedCreate()));
      const conflict = yield* runtime.runPromise(
        service
          .dispatch(
            guidedCreate({
              commandId: CommandId.make("wf-create-1"),
              brief: "Changed brief.",
              source: { kind: "inline", body: "Changed brief." },
            }),
          )
          .pipe(Effect.flip),
      );
      expect(conflict).toMatchObject({
        _tag: "TaskWorkspaceError",
        message: "Command 'wf-create-1' was already used with a different payload.",
      });
    }),
  );

  it.effect("rejects invalid slugs, oversized briefs, and mismatched sources before creation", () =>
    Effect.gen(function* () {
      const { runtime } = yield* setupRuntime("kata-task-slice5-validation-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      const invalidSlug = yield* runtime.runPromiseExit(
        service.dispatch(guidedCreate({ taskId: TaskWorkspaceId.make("Invalid-Slug!") })),
      );
      expect(invalidSlug._tag).toBe("Failure");

      const upperSlug = yield* runtime.runPromiseExit(
        service.dispatch(guidedCreate({ taskId: TaskWorkspaceId.make("myTask") })),
      );
      expect(upperSlug._tag).toBe("Failure");

      const oversized = yield* runtime.runPromiseExit(
        service.dispatch(
          guidedCreate({
            brief: "x".repeat(100_001),
            source: { kind: "inline", body: "x".repeat(100_001) },
          }),
        ),
      );
      expect(oversized._tag).toBe("Failure");

      const mismatched = yield* runtime.runPromiseExit(
        service.dispatch(
          guidedCreate({ brief: "Real brief.", source: { kind: "inline", body: "Other body." } }),
        ),
      );
      expect(mismatched._tag).toBe("Failure");

      const withoutModel = guidedCreate({
        commandId: CommandId.make("wf-create-no-model"),
        operationKey: "op-wf-create-2",
      });
      const { modelSelection: _ignored, ...rest } = withoutModel;
      void _ignored;
      const missingModel = yield* runtime.runPromiseExit(
        service.dispatch(rest as TaskWorkspaceCommand),
      );
      expect(missingModel._tag).toBe("Failure");

      // A rejected create gets a terminal rejected receipt; replaying it returns the same error.
      const replay = yield* runtime.runPromiseExit(
        service.dispatch(guidedCreate({ taskId: TaskWorkspaceId.make("Invalid-Slug!") })),
      );
      expect(replay._tag).toBe("Failure");
    }),
  );

  it.effect("imports a legacy NDJSON log transactionally and never re-imports it", () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-slice5-import-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
          Effect.orDie,
        ),
      );
      const repoRoot = NodePath.join(root, "repo");
      const baseDir = NodePath.join(root, "state");
      yield* Effect.tryPromise(() => NodeFs.mkdir(repoRoot, { recursive: true }));
      const stateDir = NodePath.join(baseDir, "userdata");
      yield* Effect.tryPromise(() => NodeFs.mkdir(stateDir, { recursive: true }));

      const legacyEvent = {
        sequence: 1,
        eventId: "legacy-event-1",
        commandId: "legacy-command-1",
        taskId: "legacy-imported-task",
        type: "task.create",
        occurredAt: "2026-07-28T17:00:00.000Z",
        task: {
          id: "legacy-imported-task",
          title: "Legacy imported",
          versions: {
            taskContract: "task-workspace@0.1.0",
            artifactContract: "task-artifact@0.1.0",
            workflowDefinition: "standard@0.1.0",
            prompt: "task-workspace-slice-1@0.1.0",
          },
          workspace: {
            repositories: [
              {
                id: "primary",
                projectId: "project-1",
                workspaceRoot: repoRoot,
                baseRef: "main",
                branch: null,
                worktreePath: null,
                provisioningStatus: "pending",
              },
            ],
          },
          workflowRuns: [
            {
              id: "standard-run-1",
              preset: "standard",
              definitionVersion: "standard@0.1.0",
              currentStage: "questions",
              approvalPolicy: "before-build",
              createdAt: "2026-07-28T17:00:00.000Z",
              updatedAt: "2026-07-28T17:00:00.000Z",
            },
          ],
          sessions: [],
          artifacts: [],
          comments: [],
          build: { phases: [], resultingCommitSha: null },
          verification: { criteria: [], results: [], signedOffAt: null },
          sourceLinks: [],
          delivery: { state: "unavailable" },
          createdAt: "2026-07-28T17:00:00.000Z",
          updatedAt: "2026-07-28T17:00:00.000Z",
        },
      };
      const legacyFile = NodePath.join(stateDir, "task-workspace-events.ndjson");
      yield* Effect.tryPromise(() =>
        NodeFs.writeFile(legacyFile, `${JSON.stringify(legacyEvent)}\n`, "utf8"),
      );

      const first = yield* makeRuntime(repoRoot, baseDir, { value: 0 });
      yield* Effect.addFinalizer(() => first.dispose);
      const firstService = yield* first.runPromise(Effect.service(TaskWorkspaceService));
      const imported = yield* first.runPromise(
        firstService.getTask(TaskWorkspaceId.make("legacy-imported-task")),
      );
      expect(imported).not.toBeNull();
      expect(imported?.environmentId).toBe(EnvironmentId.make("environment-local"));
      expect(imported?.intake.brief).toBe("Legacy imported");
      expect(imported?.preferences.worktreePolicy).toBe("later");
      expect(imported?.taskRevision).toBe(1);

      // The legacy file is retained read-only; a restart must not re-import it.
      yield* first.dispose;
      const restarted = yield* makeRuntime(repoRoot, baseDir, { value: 0 });
      yield* Effect.addFinalizer(() => restarted.dispose);
      const restartedService = yield* restarted.runPromise(Effect.service(TaskWorkspaceService));
      const again = yield* restarted.runPromise(
        restartedService.getTask(TaskWorkspaceId.make("legacy-imported-task")),
      );
      expect(again?.taskRevision).toBe(1);
      expect(again?.occurrences).toHaveLength(0);
      expect(again?.gateHistory).toHaveLength(0);
    }),
  );
});

const bootstrapEntry = (task: TaskWorkspace, baseDir: string, repoRoot: string) => {
  const bootstrap = task.bootstrap;
  if (!bootstrap) throw new Error("Expected bootstrap state");
  const parsed = /:bootstrap:([^:]+):(\d+):primary$/u.exec(bootstrap.operationKey);
  if (!parsed) throw new Error(`Invalid bootstrap operation key '${bootstrap.operationKey}'.`);
  const stage = parsed[1] as TaskWorkspaceStage;
  const occurrence = Number(parsed[2]);
  const branch = `katacode/task-${task.id.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  const worktreePath = NodePath.join(
    baseDir,
    "worktrees",
    NodePath.basename(repoRoot),
    branch.replace(/\//g, "-"),
  );
  return {
    id: "outbox-bootstrap-test",
    environmentId: EnvironmentId.make("environment-local"),
    taskId: task.id,
    operationKey: bootstrap.operationKey,
    target: "bootstrap" as const,
    status: "pending" as const,
    payload: {
      stage,
      occurrence,
      sessionId: bootstrap.reservedSessionId,
      threadId: bootstrap.reservedThreadId,
      threadCreateCommandId: bootstrap.threadCreateCommandId,
      turnStartCommandId: bootstrap.turnStartCommandId,
      kickoffMessageId: bootstrap.kickoffMessageId,
      worktreeBranch: task.preferences.worktreePolicy === "now" ? branch : null,
      worktreePath: task.preferences.worktreePolicy === "now" ? worktreePath : null,
    },
    attemptCount: 0,
    createdAt: "2026-08-01T17:00:00.000Z",
    updatedAt: "2026-08-01T17:00:00.000Z",
    completedAt: null,
  } as const;
};

describe("TaskWorkspaceService bootstrap saga", () => {
  it.effect("enqueues a bootstrap row with reserved identities on first-slice create", () =>
    Effect.gen(function* () {
      const { runtime } = yield* setupRuntime("kata-task-bootstrap-enqueue-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
      const created = yield* runtime.runPromise(
        service.dispatch(
          guidedCreate({
            commandId: CommandId.make("bs-create-1"),
            operationKey: "op-bs-create-1",
          }),
        ),
      );
      expect(created.task.bootstrap?.status).toBe("pending");
      expect(created.task.bootstrap?.operationKey).toBe(
        "guided-task:bootstrap:questions:0:primary",
      );
      expect(created.task.bootstrap?.reservedSessionId).toBe("guided-task-session-questions-0");
      expect(created.task.bootstrap?.reservedThreadId).not.toBeNull();
      expect(created.task.bootstrap?.threadCreateCommandId).not.toBeNull();
      expect(created.task.bootstrap?.turnStartCommandId).not.toBeNull();
      expect(created.task.bootstrap?.kickoffMessageId).not.toBeNull();
      expect(created.task.occurrences[0]).toMatchObject({ stage: "questions", status: "starting" });
    }),
  );

  it.effect("bootstraps a Later task to Ready with a linked primary session", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-bootstrap-ready-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
      const created = yield* runtime.runPromise(
        service.dispatch(
          guidedCreate({
            commandId: CommandId.make("bs-create-2"),
            operationKey: "op-bs-create-2",
          }),
        ),
      );

      const entry = bootstrapEntry(created.task, baseDir, repoRoot);
      yield* runtime.runPromise(service.processBootstrap(entry));

      const ready = yield* runtime.runPromise(service.getTask(TaskWorkspaceId.make("guided-task")));
      expect(ready?.bootstrap?.status).toBe("ready");
      expect(ready?.bootstrap?.conversationTarget?.threadId).toBe(
        ready?.bootstrap?.reservedThreadId,
      );
      expect(ready?.sessions).toHaveLength(1);
      expect(ready?.sessions[0]).toMatchObject({
        id: "guided-task-session-questions-0",
        stage: "questions",
        role: "primary",
        status: "active",
      });
      expect(ready?.occurrences[0]).toMatchObject({ status: "running" });

      // The saga dispatched the deterministic thread-create and kickoff commands.
      const dispatched = dispatchedOrchestration.filter(
        (command) =>
          (command as { type?: string }).type === "thread.create" ||
          (command as { type?: string }).type === "thread.turn.start",
      );
      expect(dispatched).toHaveLength(2);
      const threadCreate = dispatched[0] as {
        type: string;
        threadId: string;
        commandId: string;
        runtimeMode: string;
        interactionMode: string;
      };
      expect(threadCreate.type).toBe("thread.create");
      expect(threadCreate.threadId).toBe(ready?.bootstrap?.reservedThreadId);
      expect(threadCreate.runtimeMode).toBe("approval-required");
      expect(threadCreate.interactionMode).toBe("plan");
      const kickoff = dispatched[1] as { type: string; message: { text: string } };
      expect(kickoff.type).toBe("thread.turn.start");
      expect(kickoff.message.text).toContain("You are running the Clarify stage");
      expect(kickoff.message.text).toContain("Task brief:\nAdd a guided onboarding flow.");
    }),
  );

  it.effect("provisions the worktree first when the policy is Now", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-bootstrap-now-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
      const created = yield* runtime.runPromise(
        service.dispatch(
          guidedCreate({
            commandId: CommandId.make("bs-create-3"),
            operationKey: "op-bs-create-3",
            worktreePolicy: "now",
          }),
        ),
      );
      expect(created.task.workspace.repositories[0]?.provisioningStatus).toBe("pending");

      const entry = bootstrapEntry(created.task, baseDir, repoRoot);
      const payload = entry.payload as {
        worktreeBranch: string | null;
        worktreePath: string | null;
      };
      // The reserved worktree identity was persisted at creation.
      expect(payload.worktreeBranch).toMatch(/^katacode\/task-/u);
      expect(payload.worktreePath).toContain(baseDir);

      yield* runtime.runPromise(service.processBootstrap(entry));

      const ready = yield* runtime.runPromise(service.getTask(TaskWorkspaceId.make("guided-task")));
      expect(ready?.bootstrap?.status).toBe("ready");
      expect(ready?.workspace.repositories[0]?.provisioningStatus).toBe("ready");
      expect(ready?.workspace.repositories[0]?.worktreePath).toBe(payload.worktreePath);
      expect(ready?.workspace.repositories[0]?.planningRootFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    }),
  );

  it.effect("records a failed bootstrap and retries the same occurrence idempotently", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-bootstrap-fail-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
      const created = yield* runtime.runPromise(
        service.dispatch(
          guidedCreate({
            commandId: CommandId.make("bs-create-4"),
            operationKey: "op-bs-create-4",
          }),
        ),
      );

      // Fail the thread-create dispatch on the first attempt.
      failNextOrchestrationDispatch = true;
      const entry = bootstrapEntry(created.task, baseDir, repoRoot);
      yield* runtime.runPromise(service.processBootstrap(entry));

      const failed = yield* runtime.runPromise(
        service.getTask(TaskWorkspaceId.make("guided-task")),
      );
      expect(failed?.bootstrap?.status).toBe("failed");
      expect(failed?.bootstrap?.failure?.step).toBe("thread");
      expect(failed?.sessions).toHaveLength(0);
      expect(failed?.occurrences[0]).toMatchObject({ status: "starting" });

      // Retry with the latest revision reopens the operation and enqueues the
      // same outbox row; replaying the retry command never double-increments.
      const retried = yield* runtime.runPromise(
        service.dispatch(
          command({
            type: "task.operation.retry",
            commandId: CommandId.make("bs-retry-1"),
            taskId: TaskWorkspaceId.make("guided-task"),
            createdAt: now(2),
            expectedTaskRevision: failed!.taskRevision,
            targetOperationKey: created.task.bootstrap!.operationKey,
          }),
        ),
      );
      expect(retried.operation).toMatchObject({
        key: created.task.bootstrap!.operationKey,
        status: "pending",
        attempt: 2,
      });
      expect(retried.task.bootstrap?.status).toBe("pending");

      const replayedRetry = yield* runtime.runPromise(
        service.dispatch(
          command({
            type: "task.operation.retry",
            commandId: CommandId.make("bs-retry-1"),
            taskId: TaskWorkspaceId.make("guided-task"),
            createdAt: now(2),
            expectedTaskRevision: failed!.taskRevision,
            targetOperationKey: created.task.bootstrap!.operationKey,
          }),
        ),
      );
      expect(replayedRetry.operation.attempt).toBe(2);

      // The retried bootstrap succeeds against the same occurrence.
      yield* runtime.runPromise(
        service.processBootstrap(bootstrapEntry(created.task, baseDir, repoRoot)),
      );
      const ready = yield* runtime.runPromise(service.getTask(TaskWorkspaceId.make("guided-task")));
      expect(ready?.bootstrap?.status).toBe("ready");
      expect(ready?.sessions).toHaveLength(1);
      expect(ready?.occurrences[0]).toMatchObject({ status: "running" });
    }),
  );

  it.effect("rejects a retry with a stale task revision", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-bootstrap-retry-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
      const created = yield* runtime.runPromise(
        service.dispatch(
          guidedCreate({
            commandId: CommandId.make("bs-create-5"),
            operationKey: "op-bs-create-5",
          }),
        ),
      );

      const staleRevision = yield* runtime.runPromiseExit(
        service.dispatch(
          command({
            type: "task.operation.retry",
            commandId: CommandId.make("bs-retry-revision"),
            taskId: TaskWorkspaceId.make("guided-task"),
            createdAt: now(2),
            expectedTaskRevision: created.task.taskRevision + 99,
            targetOperationKey: "op-bs-create-5",
          }),
        ),
      );
      expect(staleRevision._tag).toBe("Failure");
    }),
  );
});

describe("TaskWorkspaceService guided flow", () => {
  const flowCreate = (overrides: Record<string, unknown> = {}) =>
    guidedCreate({
      commandId: CommandId.make("flow-create-1"),
      operationKey: "op-flow-create-1",
      ...overrides,
    });

  it.effect("runs Clarify, Research, Design, and Plan to an open gate with atomic handoffs", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-guided-flow-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      const created = yield* runtime.runPromise(service.dispatch(flowCreate()));
      yield* runtime.runPromise(
        service.processBootstrap(bootstrapEntry(created.task, baseDir, repoRoot)),
      );

      const proposeAndSettle = (
        task: TaskWorkspace,
        stage: string,
        summary: string,
        markdown: string,
      ) =>
        Effect.gen(function* () {
          const occurrence = task.occurrences.find(
            (candidate) => candidate.stage === stage && candidate.status === "running",
          )!;
          const session = task.sessions.find((candidate) => candidate.stage === stage);
          if (!session) {
            throw new Error(
              `Missing session for ${stage}; sessions=${task.sessions.map((candidate) => `${candidate.stage}:${candidate.id}`).join(",")}; occurrences=${task.occurrences.map((candidate) => `${candidate.stage}:${candidate.ordinal}:${candidate.status}`).join(",")}`,
            );
          }
          const proposing = yield* runtime.runPromise(
            service.proposeStageCompletion({
              taskId: task.id,
              sessionId: session.id,
              providerTurnId: `turn-${stage}`,
              payloadDigest: `digest-${stage}`,
              summary,
              markdown,
            }),
          );
          expect(proposing.occurrences.find((o) => o.id === occurrence.id)?.status).toBe(
            "finalizing",
          );
          return yield* runtime.runPromise(
            service.settleProposal({
              taskId: task.id,
              occurrence: occurrence.ordinal,
              providerTurnId: `turn-${stage}`,
              outcome: "completed",
            }),
          );
        });

      // Clarify completes and hands off to Research.
      let task = (yield* runtime.runPromise(service.getTask(created.task.id)))!;
      task = yield* proposeAndSettle(
        task,
        "questions",
        "Goal, constraints, and success conditions are clear.",
        "# Clarified\n\nScope is onboarding.\n",
      );
      expect(task.workflowRuns.at(-1)?.currentStage).toBe("research");
      expect(task.occurrences.find((o) => o.stage === "questions")?.status).toBe("completed");
      expect(task.occurrences.some((o) => o.stage === "research" && o.status === "starting")).toBe(
        true,
      );
      expect(task.artifacts.find((artifact) => artifact.kind === "questions")).toBeDefined();
      expect(task.bootstrap?.operationKey).toContain(":bootstrap:research:0:primary");

      yield* runtime.runPromise(service.processBootstrap(bootstrapEntry(task, baseDir, repoRoot)));
      task = (yield* runtime.runPromise(service.getTask(task.id)))!;
      expect(task?.bootstrap?.status).toBe("ready");
      expect(task?.occurrences.find((o) => o.stage === "research")?.status).toBe("running");

      // Research completes and hands off to Design.
      task = yield* proposeAndSettle(
        task!,
        "research",
        "Codebase facts and conventions recorded.",
        "# Research\n\nUses the onboarding module.\n",
      );
      expect(task.workflowRuns.at(-1)?.currentStage).toBe("design");
      expect(task.artifacts.find((artifact) => artifact.kind === "research")).toBeDefined();

      yield* runtime.runPromise(service.processBootstrap(bootstrapEntry(task, baseDir, repoRoot)));
      task = (yield* runtime.runPromise(service.getTask(task.id)))!;
      expect(task?.occurrences.find((o) => o.stage === "design")?.status).toBe("running");

      // Design completes and hands off to Plan.
      task = yield* proposeAndSettle(
        task!,
        "design",
        "Approach and boundaries recorded.",
        "# Design\n\nFollow the onboarding module.\n",
      );
      expect(task.workflowRuns.at(-1)?.currentStage).toBe("plan");
      expect(task.artifacts.find((artifact) => artifact.kind === "design")).toBeDefined();

      yield* runtime.runPromise(service.processBootstrap(bootstrapEntry(task, baseDir, repoRoot)));
      task = (yield* runtime.runPromise(service.getTask(task.id)))!;
      expect(task?.occurrences.find((o) => o.stage === "plan")?.status).toBe("running");

      // Plan output opens the approval gate.
      task = yield* proposeAndSettle(
        task!,
        "plan",
        "Plan ready for review.",
        "# Plan\n\n## Phase 1\nImplement onboarding.\n",
      );
      expect(task.planGate).toMatchObject({ status: "open", occurrence: 0 });
      expect(task.occurrences.find((o) => o.stage === "plan")?.status).toBe("awaiting-approval");
      expect(task.artifacts.find((artifact) => artifact.kind === "plan")).toBeDefined();

      // A second Plan proposal is rejected while the gate is open.
      const planSession = task.sessions.find((candidate) => candidate.stage === "plan")!;
      const secondProposal = yield* runtime.runPromiseExit(
        service.proposeStageCompletion({
          taskId: task.id,
          sessionId: planSession.id,
          providerTurnId: "turn-plan-2",
          payloadDigest: "digest-plan-2",
          summary: "Replacement plan.",
          markdown: "# Replacement\n",
        }),
      );
      expect(secondProposal._tag).toBe("Failure");
    }),
  );

  it.effect("request changes opens a continuation occurrence and reopens the gate", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-gate-changes-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      const created = yield* runtime.runPromise(service.dispatch(flowCreate()));
      yield* runtime.runPromise(
        service.processBootstrap(bootstrapEntry(created.task, baseDir, repoRoot)),
      );
      let task = (yield* runtime.runPromise(service.getTask(created.task.id)))!;

      // Drive straight to Plan: Clarify -> Research -> Design -> Plan.
      for (const stage of ["questions", "research", "design"] as const) {
        const occurrence = task!.occurrences.find(
          (candidate) => candidate.stage === stage && candidate.status === "running",
        )!;
        const session = task!.sessions.find((candidate) => candidate.stage === stage)!;
        yield* runtime.runPromise(
          service.proposeStageCompletion({
            taskId: task!.id,
            sessionId: session.id,
            providerTurnId: `turn-${stage}`,
            payloadDigest: `digest-${stage}`,
            summary: `${stage} done`,
            markdown: `# ${stage}\n`,
          }),
        );
        task = yield* runtime.runPromise(
          service.settleProposal({
            taskId: task!.id,
            occurrence: occurrence.ordinal,
            providerTurnId: `turn-${stage}`,
            outcome: "completed",
          }),
        );
        yield* runtime.runPromise(
          service.processBootstrap(bootstrapEntry(task, baseDir, repoRoot)),
        );
        task = (yield* runtime.runPromise(service.getTask(task.id)))!;
      }
      const planOccurrence = task!.occurrences.find(
        (candidate) => candidate.stage === "plan" && candidate.status === "running",
      )!;
      const planSession = task!.sessions.find((candidate) => candidate.stage === "plan")!;
      yield* runtime.runPromise(
        service.proposeStageCompletion({
          taskId: task!.id,
          sessionId: planSession.id,
          providerTurnId: "turn-plan",
          payloadDigest: "digest-plan",
          summary: "First plan.",
          markdown: "# Plan v1\n",
        }),
      );
      task = yield* runtime.runPromise(
        service.settleProposal({
          taskId: task!.id,
          occurrence: planOccurrence.ordinal,
          providerTurnId: "turn-plan",
          outcome: "completed",
        }),
      );
      expect(task.planGate?.status).toBe("open");

      // Request changes allocates occurrence 1 and reopens the gate after a new plan.
      const changed = yield* runtime.runPromise(
        service.dispatch(
          command({
            type: "task.stage.request-changes",
            commandId: CommandId.make("flow-changes-1"),
            taskId: task.id,
            createdAt: now(10),
            expectedTaskRevision: task.taskRevision,
            operationKey: "op-flow-changes-1",
            feedback: "Add rollback handling.",
          }),
        ),
      );
      expect(changed.task.planGate).toBeNull();
      expect(changed.task.gateHistory.at(-1)).toMatchObject({
        outcome: "changes-requested",
        feedback: "Add rollback handling.",
        occurrence: 0,
      });
      expect(
        changed.task.occurrences.filter((o) => o.stage === "plan" && o.ordinal === 0)[0]?.status,
      ).toBe("completed");
      expect(
        changed.task.occurrences.some(
          (o) => o.stage === "plan" && o.ordinal === 1 && o.status === "starting",
        ),
      ).toBe(true);
      expect(changed.task.bootstrap?.operationKey).toContain(":bootstrap:plan:1:primary");
      expect(changed.task.artifacts.find((a) => a.kind === "plan")).toBeDefined();

      // The continuation bootstraps and a new plan reopens the gate.
      yield* runtime.runPromise(
        service.processBootstrap(bootstrapEntry(changed.task, baseDir, repoRoot)),
      );
      const continued = yield* runtime.runPromise(service.getTask(task.id));
      const occurrence1 = continued!.occurrences.find(
        (candidate) => candidate.stage === "plan" && candidate.ordinal === 1,
      )!;
      const sessionId = continued!.bootstrap?.reservedSessionId ?? continued!.sessions.at(-1)!.id;
      yield* runtime.runPromise(
        service.proposeStageCompletion({
          taskId: continued!.id,
          sessionId,
          providerTurnId: "turn-plan-2",
          payloadDigest: "digest-plan-2",
          summary: "Revised plan.",
          markdown: "# Plan v2\n",
        }),
      );
      const reopened = yield* runtime.runPromise(
        service.settleProposal({
          taskId: continued!.id,
          occurrence: occurrence1.ordinal,
          providerTurnId: "turn-plan-2",
          outcome: "completed",
        }),
      );
      expect(reopened.planGate?.status).toBe("open");
      expect(reopened.planGate?.occurrence).toBe(1);
      expect(reopened.planGate?.revision).toBeGreaterThan(0);
    }),
  );

  it.effect("approval completes the Plan occurrence without Implement work", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-gate-approve-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      const created = yield* runtime.runPromise(service.dispatch(flowCreate()));
      yield* runtime.runPromise(
        service.processBootstrap(bootstrapEntry(created.task, baseDir, repoRoot)),
      );
      let task = (yield* runtime.runPromise(service.getTask(created.task.id)))!;

      for (const stage of ["questions", "research", "design"] as const) {
        const occurrence = task!.occurrences.find(
          (candidate) => candidate.stage === stage && candidate.status === "running",
        )!;
        const session = task!.sessions.find((candidate) => candidate.stage === stage)!;
        yield* runtime.runPromise(
          service.proposeStageCompletion({
            taskId: task!.id,
            sessionId: session.id,
            providerTurnId: `turn-${stage}`,
            payloadDigest: `digest-${stage}`,
            summary: `${stage} done`,
            markdown: `# ${stage}\n`,
          }),
        );
        task = yield* runtime.runPromise(
          service.settleProposal({
            taskId: task!.id,
            occurrence: occurrence.ordinal,
            providerTurnId: `turn-${stage}`,
            outcome: "completed",
          }),
        );
        yield* runtime.runPromise(
          service.processBootstrap(bootstrapEntry(task, baseDir, repoRoot)),
        );
        task = (yield* runtime.runPromise(service.getTask(task.id)))!;
      }
      const planOccurrence = task!.occurrences.find(
        (candidate) => candidate.stage === "plan" && candidate.status === "running",
      )!;
      const planSession = task!.sessions.find((candidate) => candidate.stage === "plan")!;
      yield* runtime.runPromise(
        service.proposeStageCompletion({
          taskId: task!.id,
          sessionId: planSession.id,
          providerTurnId: "turn-plan",
          payloadDigest: "digest-plan",
          summary: "Plan ready.",
          markdown: "# Plan\n\n## Phase 1\n",
        }),
      );
      task = yield* runtime.runPromise(
        service.settleProposal({
          taskId: task!.id,
          occurrence: planOccurrence.ordinal,
          providerTurnId: "turn-plan",
          outcome: "completed",
        }),
      );
      expect(task.planGate?.status).toBe("open");

      const approved = yield* runtime.runPromise(
        service.dispatch(
          command({
            type: "task.plan.approve",
            commandId: CommandId.make("flow-approve-1"),
            taskId: task.id,
            createdAt: now(20),
            expectedTaskRevision: task.taskRevision,
            operationKey: "op-flow-approve-1",
          }),
        ),
      );
      expect(approved.task.planGate).toBeNull();
      expect(approved.task.gateHistory.at(-1)).toMatchObject({
        outcome: "approved",
        actor: "local-user",
      });
      expect(
        approved.task.occurrences.find((o) => o.stage === "plan" && o.ordinal === 0)?.status,
      ).toBe("completed");
      // Stage stays `plan` and no Implement occurrence or session exists.
      expect(approved.task.workflowRuns.at(-1)?.currentStage).toBe("plan");
      expect(approved.task.occurrences.some((o) => o.stage === "build")).toBe(false);
      expect(approved.task.sessions.some((s) => s.stage === "build")).toBe(false);
      // Later policy enqueues deterministic worktree provisioning.
      expect(approved.task.taskRevision).toBeGreaterThan(task.taskRevision);
      expect(approved.task.workspace.repositories[0]?.provisioningStatus).toBe("pending");
      const repository = approved.task.workspace.repositories[0]!;
      const branch = "katacode/task-guided-task";
      const worktreePath = NodePath.join(
        baseDir,
        "worktrees",
        NodePath.basename(repoRoot),
        branch.replace(/\//g, "-"),
      );
      const worktreeEntry = {
        id: "outbox-worktree-approval-test",
        environmentId: EnvironmentId.make("environment-local"),
        taskId: approved.task.id,
        operationKey: `guided-task:worktree:${repository.baseCommitSha}:later`,
        target: "worktree" as const,
        status: "pending" as const,
        payload: {
          branch,
          path: worktreePath,
          baseCommitSha: repository.baseCommitSha!,
          sourceWorkspaceRoot: repository.workspaceRoot,
        },
        attemptCount: 0,
        createdAt: now(21),
        updatedAt: now(21),
        completedAt: null,
      } as const;
      yield* runtime.runPromise(service.processWorktree(worktreeEntry));
      const provisioned = (yield* runtime.runPromise(service.getTask(task.id)))!;
      expect(provisioned.workspace.repositories[0]).toMatchObject({
        provisioningStatus: "ready",
        branch: "katacode/task-guided-task",
      });
      expect(provisioned.workspace.repositories[0]?.worktreePath).toBeTruthy();
    }),
  );

  it.effect("an aborted turn rejects the proposal and returns the stage to Running", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-proposal-abort-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      const created = yield* runtime.runPromise(service.dispatch(flowCreate()));
      yield* runtime.runPromise(
        service.processBootstrap(bootstrapEntry(created.task, baseDir, repoRoot)),
      );
      let task = (yield* runtime.runPromise(service.getTask(created.task.id)))!;
      const occurrence = task!.occurrences.find(
        (candidate) => candidate.stage === "questions" && candidate.status === "running",
      )!;
      const session = task!.sessions.find((candidate) => candidate.stage === "questions")!;

      yield* runtime.runPromise(
        service.proposeStageCompletion({
          taskId: task!.id,
          sessionId: session.id,
          providerTurnId: "turn-abort",
          payloadDigest: "digest-abort",
          summary: "Draft.",
          markdown: "# Draft\n",
        }),
      );
      task = yield* runtime.runPromise(
        service.settleProposal({
          taskId: task!.id,
          occurrence: occurrence.ordinal,
          providerTurnId: "turn-abort",
          outcome: "aborted",
        }),
      );
      expect(task.occurrences.find((o) => o.id === occurrence.id)?.status).toBe("running");
      expect(task.workflowRuns.at(-1)?.currentStage).toBe("questions");
      expect(task.artifacts.find((a) => a.kind === "questions")).toBeUndefined();
    }),
  );
});

describe("TaskStageBridge", () => {
  it.effect(
    "loads selected context, proposes one completion, and rejects the superseded thread",
    () =>
      Effect.gen(function* () {
        const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-stage-bridge-");
        const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
        const created = yield* runtime.runPromise(service.dispatch(guidedCreate()));
        yield* runtime.runPromise(
          service.processBootstrap(bootstrapEntry(created.task, baseDir, repoRoot)),
        );
        const task = (yield* runtime.runPromise(service.getTask(created.task.id)))!;
        const threadId = task.bootstrap?.reservedThreadId!;
        const providerInstanceId = ProviderInstanceId.make("instance-1");
        const directoryLayer = Layer.succeed(ProviderSessionDirectory, {
          getBinding: () =>
            Effect.succeed(
              Option.some({
                threadId,
                provider: ProviderDriverKind.make("claudeAgent"),
                providerInstanceId,
                runtimePayload: { activeTurnId: "turn-bridge-1" },
              }),
            ),
          getProvider: () => Effect.succeed(ProviderDriverKind.make("claudeAgent")),
          listThreadIds: () => Effect.succeed([threadId]),
          listBindings: () => Effect.succeed([]),
          upsert: () => Effect.void,
        });
        const bridgeLayer = TaskStageBridgeLive.pipe(
          Layer.provide(directoryLayer),
          Layer.provide(Layer.succeed(TaskWorkspaceService, service)),
        );
        const bridgeScope = yield* Scope.make();
        yield* Effect.addFinalizer(() => Scope.close(bridgeScope, Exit.void));
        const bridgeContext = yield* Layer.buildWithScope(bridgeLayer, bridgeScope);
        const bridge = yield* Effect.provide(Effect.service(TaskStageBridge), bridgeContext);
        const scope = {
          environmentId: EnvironmentId.make("environment-local"),
          threadId,
          providerInstanceId,
          providerSessionId: "provider-session-bridge-1",
        };

        const context = yield* Effect.provide(bridge.context(scope), bridgeContext);
        expect(context).toMatchObject({
          stage: "questions",
          occurrence: 0,
          brief: "Add a guided onboarding flow.",
          artifacts: [],
        });
        const acknowledgement = yield* Effect.provide(
          bridge.complete(scope, {
            summary: "Clarify complete.",
            markdown: "# Clarify\n\nThe scope is clear.\n",
          }),
          bridgeContext,
        );
        expect(acknowledgement).toMatchObject({
          accepted: true,
          stage: "questions",
          occurrence: 0,
          providerTurnId: "turn-bridge-1",
        });
        const proposalTask = (yield* runtime.runPromise(service.getTask(task.id)))!;
        expect(proposalTask.occurrences[0]?.status).toBe("finalizing");

        yield* runtime.runPromise(
          service.settleProposal({
            taskId: task.id,
            occurrence: 0,
            providerTurnId: "turn-bridge-1",
            outcome: "completed",
          }),
        );
        const stale = yield* Effect.exit(Effect.provide(bridge.context(scope), bridgeContext));
        expect(stale._tag).toBe("Failure");
      }),
  );
});
