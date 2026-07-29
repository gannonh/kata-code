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
