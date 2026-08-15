// @effect-diagnostics nodeBuiltinImport:off - durable test persistence and real git fixtures use Node platform APIs.
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
  ProviderInstanceId,
  ProjectId,
  TaskWorkspaceId,
  type TaskWorkspace,
} from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

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
import {
  TaskWorkspaceBootstrapWorker,
  TaskWorkspaceBootstrapWorkerLive,
} from "./TaskWorkspaceBootstrapWorker.ts";
import { TaskWorkspaceService, layer as TaskWorkspaceServiceLive } from "./TaskWorkspaceService.ts";
import { TaskCheckFinalizerServiceLive } from "../taskCli/TaskCheckFinalizerService.ts";

const execFileAsync = promisify(execFile);
const now = (second: number) => `2026-08-03T17:00:${String(second).padStart(2, "0")}.000Z`;
const taskId = TaskWorkspaceId.make("guided-task");
const projectId = ProjectId.make("project-1");
const environmentId = EnvironmentId.make("environment-local");

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

function unsupported(operation: string): never {
  throw new Error(`Unexpected Git workflow operation: ${operation}`);
}

const dispatchedOrchestration: unknown[] = [];

const makeRuntime = Effect.fn("TaskWorkspaceBootstrapWorkerTest.makeRuntime")(function* (
  repoRoot: string,
  baseDir: string,
) {
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
  const gitLayer = Layer.succeed(GitWorkflowService, {
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
          const newRefName = input.newRefName ?? "katacode/task-test";
          const worktreePath = input.path ?? NodePath.join(baseDir, "task-worktree");
          await git(input.cwd, ["worktree", "add", "-b", newRefName, worktreePath, input.refName]);
          return { worktree: { path: worktreePath, refName: newRefName } };
        },
        catch: (cause) => cause as never,
      }),
    removeWorktree: () => Effect.sync(() => unsupported("removeWorktree")),
    createRef: () => Effect.sync(() => unsupported("createRef")),
    switchRef: () => Effect.sync(() => unsupported("switchRef")),
    renameBranch: () => Effect.sync(() => unsupported("renameBranch")),
  } satisfies GitWorkflowServiceShape);
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
      return Effect.succeed({ sequence: dispatchedOrchestration.length });
    },
    streamDomainEvents: Stream.empty,
    readEvents: () => {
      const turnStart = [...dispatchedOrchestration]
        .toReversed()
        .find((entry) => (entry as { type?: string }).type === "thread.turn.start") as
        | { readonly threadId: string }
        | undefined;
      if (!turnStart) return Stream.empty;
      return Stream.succeed({
        type: "thread.session-set",
        payload: {
          threadId: turnStart.threadId,
          session: { status: "running", activeTurnId: "bootstrap-turn" },
        },
      } as never);
    },
  } as OrchestrationEngineShape);
  const allServices = Layer.merge(
    Layer.merge(Layer.merge(TaskWorkspaceServiceLive, TaskWorkspaceStoreLive), environmentLayer),
    TaskWorkspaceBootstrapWorkerLive,
  );
  const workerLayer = allServices.pipe(
    Layer.provide(TaskWorkspaceServiceLive),
    Layer.provide(TaskWorkspaceStoreLive),
    Layer.provide(environmentLayer),
    Layer.provide(gitLayer),
    Layer.provide(sourceResolverLayer),
    Layer.provide(orchestrationLayer),
    Layer.provideMerge(TaskCheckFinalizerServiceLive),
    Layer.provideMerge(SqlitePersistenceLive),
    Layer.provide(ServerConfig.layerTest(repoRoot, baseDir)),
    Layer.provideMerge(NodeServices.layer),
  );
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(workerLayer, scope);
  return {
    runPromise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provide(effect, context),
    runPromiseExit: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.exit(Effect.provide(effect, context)),
    dispose: Effect.provide(Scope.close(scope, Exit.void), context),
  };
});

const setup = Effect.fn("TaskWorkspaceBootstrapWorkerTest.setup")(function* (prefix: string) {
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
  yield* Effect.tryPromise(() => NodeFs.writeFile(NodePath.join(repoRoot, "README.md"), "# f\n"));
  yield* Effect.tryPromise(() => git(repoRoot, ["add", "README.md"]));
  yield* Effect.tryPromise(() => git(repoRoot, ["commit", "-m", "chore: seed"]));
  const runtime = yield* makeRuntime(repoRoot, baseDir);
  yield* Effect.addFinalizer(() => runtime.dispose);
  return { runtime, repoRoot, baseDir };
});

type WorkerTestRuntime = Effect.Success<ReturnType<typeof makeRuntime>>;

const guidedCreate = (overrides: Record<string, unknown> = {}) => ({
  type: "task.create" as const,
  commandId: CommandId.make("wf-create-1"),
  taskId,
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

const PLAN_MARKDOWN = [
  "## Phase [phase:foundation] Foundation",
  "Checkpoint: never",
  "",
  "### Work item [work:implement] Implement approved Plan",
  "",
  "- Automated check [check:typecheck]: Typecheck | vp run typecheck",
  "",
].join("\n");

const bootstrapEntryFor = (task: TaskWorkspace, baseDir: string, repoRoot: string) => {
  const bootstrap = task.bootstrap;
  if (!bootstrap) throw new Error("Expected bootstrap state");
  const parsed = /:bootstrap:([^:]+):(\d+):primary$/u.exec(bootstrap.operationKey);
  if (!parsed) throw new Error(`Invalid bootstrap operation key '${bootstrap.operationKey}'.`);
  const repository = task.workspace.repositories[0]!;
  return {
    id: `outbox-bootstrap-${bootstrap.operationKey}`,
    environmentId,
    taskId: task.id,
    operationKey: bootstrap.operationKey,
    target: "bootstrap" as const,
    status: "pending" as const,
    payload: {
      stage: parsed[1],
      occurrence: Number(parsed[2]),
      sessionId: bootstrap.reservedSessionId,
      threadId: bootstrap.reservedThreadId,
      threadCreateCommandId: bootstrap.threadCreateCommandId,
      turnStartCommandId: bootstrap.turnStartCommandId,
      kickoffMessageId: bootstrap.kickoffMessageId,
      worktreeBranch: repository.branch,
      worktreePath: repository.worktreePath,
    },
    attemptCount: 0,
    createdAt: now(10),
    updatedAt: now(10),
    completedAt: null,
  } as const;
};

/**
 * Drive a fresh guided task through Clarify, Research, Design, and Plan to an
 * open gate, approve the Plan (later policy), and provision the worktree so the
 * task sits in the Build stage with a compiled check and a pending build
 * bootstrap.
 */
const driveToBuild = Effect.fn("TaskWorkspaceBootstrapWorkerTest.driveToBuild")(function* (
  runtime: WorkerTestRuntime,
  baseDir: string,
  repoRoot: string,
) {
  const service = yield* runtime.runPromise(Effect.service(TaskWorkspaceService));
  const created = yield* runtime.runPromise(service.dispatch(guidedCreate() as never));
  yield* runtime.runPromise(
    service.processBootstrap(bootstrapEntryFor(created.task, baseDir, repoRoot) as never),
  );
  let task = (yield* runtime.runPromise(service.getTask(taskId)))!;

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
      service.processBootstrap(bootstrapEntryFor(task, baseDir, repoRoot) as never),
    );
    task = (yield* runtime.runPromise(service.getTask(taskId)))!;
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
      markdown: PLAN_MARKDOWN,
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
    service.dispatch({
      type: "task.plan.approve",
      commandId: CommandId.make("flow-approve-1"),
      taskId: task!.id,
      createdAt: now(20),
      expectedTaskRevision: task!.taskRevision,
      operationKey: "op-flow-approve-1",
    } as never),
  );
  const repository = approved.task.workspace.repositories[0]!;
  const branch = `katacode/task-${approved.task.id}`;
  const worktreePath = NodePath.join(
    baseDir,
    "worktrees",
    NodePath.basename(repoRoot),
    branch.replace(/\//g, "-"),
  );
  yield* runtime.runPromise(
    service.processWorktree({
      id: "outbox-worktree-approval-test",
      environmentId,
      taskId: approved.task.id,
      operationKey: `${approved.task.id}:worktree:${repository.baseCommitSha}:later`,
      target: "worktree",
      status: "pending",
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
    } as never),
  );
  const provisioned = (yield* runtime.runPromise(service.getTask(taskId)))!;
  expect(provisioned.workflowRuns.at(-1)?.currentStage).toBe("build");
  expect(provisioned.build.checks.map((check) => check.id)).toContain("check:typecheck");
  yield* runtime.runPromise(
    service.processBootstrap(bootstrapEntryFor(provisioned, baseDir, repoRoot) as never),
  );
  const bootstrapped = (yield* runtime.runPromise(service.getTask(taskId)))!;
  expect(bootstrapped.occurrences.find((o) => o.stage === "build")?.status).toBe("running");
  yield* runtime.runPromise(
    service.implementationProgressCli({
      taskId: bootstrapped.id,
      target: "work-item",
      id: "work:implement",
      status: "running",
      summary: "Start implementation checks.",
    }),
  );
  const running = (yield* runtime.runPromise(service.getTask(taskId)))!;
  return { service, task: running };
});
describe("TaskWorkspaceBootstrapWorker", () => {
  it.effect("reconciles a foreign-owner finalizer to indeterminate without rerunning", () =>
    Effect.gen(function* () {
      const { runtime, repoRoot, baseDir } = yield* setup("kata-worker-reconcile-");
      const { service, task } = yield* driveToBuild(runtime, baseDir, repoRoot);
      const begun = yield* runtime.runPromise(
        service.implementationCheckBegin({ taskId: task.id, checkId: "check:typecheck" }),
      );
      expect(begun.outcome).toBe("spawn");
      expect(begun.finalizerToken).not.toBeNull();
      expect(begun.attemptId).toBe("check-attempt-1");

      // Flip the issued finalizer to a foreign owner generation so the worker
      // startup fence treats it as unreconcilable from this runtime.
      const sql = yield* runtime.runPromise(Effect.service(SqlClient.SqlClient));
      yield* runtime.runPromise(
        sql`UPDATE task_check_finalizers SET owner_generation = 'foreign-owner'`,
      );

      const worker = yield* runtime.runPromise(Effect.service(TaskWorkspaceBootstrapWorker));
      yield* runtime.runPromise(worker.reconcile());

      const after = (yield* runtime.runPromise(service.getTask(task.id)))!;
      const attempt = after.build.checkAttempts.find(
        (candidate) => candidate.id === begun.attemptId,
      );
      expect(attempt?.status).toBe("indeterminate");
      expect(attempt?.output).toBe("The check result could not be reconciled after restart.");
    }),
  );
});
