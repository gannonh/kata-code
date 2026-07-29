// @effect-diagnostics nodeBuiltinImport:off - integration test creates a real temporary Git repository.
import { execFile } from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { promisify } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
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
import { GitWorkflowService, type GitWorkflowServiceShape } from "../git/GitWorkflowService.ts";
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
  const gitLayer = Layer.succeed(GitWorkflowService, makeGitWorkflow(baseDir, createCount));
  const taskLayer = TaskWorkspaceServiceLive.pipe(
    Layer.provide(gitLayer),
    Layer.provide(ServerConfig.layerTest(repoRoot, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(taskLayer, scope);
  return {
    runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(effect, context),
    runPromiseExit: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.exit(Effect.provide(effect, context)),
    dispose: Scope.close(scope, Exit.void),
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
      }),
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

        // Context manifest for downstream sessions.
        const manifested = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.context-manifest.create",
              commandId: CommandId.make("s2-manifest"),
              taskId: slice2TaskId,
              createdAt: now(3),
              artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["intro"] }],
              notes: "context for alternatives",
              sessionId: "session-1",
            }),
          ),
        );
        expect(manifested.task.contextManifests).toEqual([
          expect.objectContaining({ id: "manifest-1", notes: "context for alternatives" }),
        ]);

        // Alternative link without a manifest is rejected.
        const alternativeWithoutManifest = yield* runtime.runPromiseExit(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-alt-no-manifest"),
              taskId: slice2TaskId,
              createdAt: now(4),
              stage: "questions",
              threadId: ThreadId.make("thread-alt"),
              role: "alternative",
            }),
          ),
        );
        expect(alternativeWithoutManifest._tag).toBe("Failure");

        // Alternative link with a manifest succeeds.
        yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.link",
              commandId: CommandId.make("s2-alt-manifest"),
              taskId: slice2TaskId,
              createdAt: now(5),
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
              createdAt: now(6),
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

        // Fork records parent + fork point + manifest.
        const forked = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.session.fork",
              commandId: CommandId.make("s2-fork"),
              taskId: slice2TaskId,
              createdAt: now(7),
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
              createdAt: now(8),
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

        // Artifact upsert persists a block index with heading paths and content hashes.
        const withBlocks = yield* runtime.runPromise(
          service.dispatch(
            command({
              type: "task.artifact.upsert",
              commandId: CommandId.make("s2-questions-r1"),
              taskId: slice2TaskId,
              createdAt: now(9),
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

        yield* runtime.dispose;
      }),
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

        yield* runtime.dispose;
      }),
    30_000,
  );

  it.effect("replays Slice 2 comments, sessions, manifests, and block indexes after restart", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setupRuntime("kata-task-s2-restart-");
      const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));

      yield* runtime.runPromise(service.dispatch(createSlice2Task(now(1), repoRoot)));
      yield* runtime.runPromise(
        service.dispatch(
          command({
            type: "task.context-manifest.create",
            commandId: CommandId.make("s2r-manifest"),
            taskId: slice2TaskId,
            createdAt: now(2),
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
            createdAt: now(3),
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
            type: "task.artifact.upsert",
            commandId: CommandId.make("s2r-upsert"),
            taskId: slice2TaskId,
            createdAt: now(4),
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
    }),
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
