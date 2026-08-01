// @effect-diagnostics nodeBuiltinImport:off - integration test creates a real temporary Git repository.
import { execFile } from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { promisify } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  TaskWorkspaceId,
  ThreadId,
  type TaskWorkspaceCommand,
} from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { ServerConfig } from "../config.ts";
import {
  ServerEnvironment,
  type ServerEnvironmentShape,
} from "../environment/Services/ServerEnvironment.ts";
import { GitWorkflowService, type GitWorkflowServiceShape } from "../git/GitWorkflowService.ts";
import { layerConfig as SqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import { TaskWorkspaceStoreLive } from "../persistence/Layers/TaskWorkspaceStore.ts";
import { TaskWorkspaceService, layer as TaskWorkspaceServiceLive } from "./TaskWorkspaceService.ts";

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
  const taskLayer = TaskWorkspaceServiceLive.pipe(
    Layer.provide(gitLayer),
    Layer.provide(environmentLayer),
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
    dispose: Effect.provide(Scope.close(scope, Exit.void), context),
  };
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

  const setupRuntime = Effect.fn("TaskWorkspaceServiceTest.setupRuntime")(function* (
    prefix: string,
  ) {
    const root = yield* Effect.tryPromise(() =>
      NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), prefix)),
    );
    yield* Effect.addFinalizer(() =>
      Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
    );
    const repoRoot = NodePath.join(root, "repo");
    const baseDir = NodePath.join(root, "state");
    yield* Effect.tryPromise(() => NodeFs.mkdir(repoRoot, { recursive: true }));
    const runtime = yield* makeRuntime(repoRoot, baseDir, { value: 0 });
    yield* Effect.addFinalizer(() => runtime.dispose);
    return { runtime, repoRoot, baseDir };
  });

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
        yield* Effect.tryPromise(() => git(repoRoot, ["init", "-b", "main"]));
        yield* Effect.tryPromise(() =>
          NodeFs.writeFile(NodePath.join(repoRoot, "README.md"), "# fixture\n", "utf8"),
        );
        yield* Effect.tryPromise(() => git(repoRoot, ["add", "README.md"]));
        yield* Effect.tryPromise(() =>
          git(repoRoot, ["commit", "-m", "chore: seed freeform repository"]),
        );
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

        yield* Effect.tryPromise(() => git(repoRoot, ["init", "-b", "main"]));
        yield* Effect.tryPromise(() =>
          NodeFs.writeFile(NodePath.join(repoRoot, "README.md"), "# Slice 4\n", "utf8"),
        );
        yield* Effect.tryPromise(() => git(repoRoot, ["add", "README.md"]));
        yield* Effect.tryPromise(() => git(repoRoot, ["commit", "-m", "chore: seed slice 4"]));

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
