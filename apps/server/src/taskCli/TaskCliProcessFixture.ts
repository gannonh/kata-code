// @effect-diagnostics nodeBuiltinImport:off - the fixture owns a real SQLite file, HTTP listener, and child process.
// @effect-diagnostics anyUnknownInErrorContext:off - inert external-service doubles are intentionally boundary-shaped.
import { spawn } from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  EnvironmentTaskCliHttpApi,
  EnvironmentHttpApi,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  TaskWorkspaceId,
  type OrchestrationEvent,
  type TaskWorkspace,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServer from "effect/unstable/http/HttpServer";

import { ServerConfig } from "../config.ts";
import {
  TaskWorkspaceSourceResolver,
  type TaskWorkspaceSourceResolverShape,
} from "../taskWorkspace/Services/TaskWorkspaceSourceResolver.ts";
import {
  TaskWorkspaceService,
  layer as TaskWorkspaceServiceLive,
} from "../taskWorkspace/TaskWorkspaceService.ts";
import { TaskWorkspaceStoreLive } from "../persistence/Layers/TaskWorkspaceStore.ts";
import { layerConfig as SqlitePersistenceLive } from "../persistence/Layers/Sqlite.ts";
import { ProviderSessionDirectory } from "../provider/Services/ProviderSessionDirectory.ts";
import { ProviderSessionDirectoryLive } from "../provider/Layers/ProviderSessionDirectory.ts";
import { ProviderSessionRuntimeRepositoryLive } from "../persistence/Layers/ProviderSessionRuntime.ts";
import { TaskInvocationService, TaskInvocationServiceLive } from "./TaskInvocationService.ts";
import { taskCliHttpApiLayer } from "./http.ts";
import { GitWorkflowService, type GitWorkflowServiceShape } from "../git/GitWorkflowService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../orchestration/Services/OrchestrationEngine.ts";
import * as Context from "effect/Context";
import {
  ServerEnvironment,
  type ServerEnvironmentShape,
} from "../environment/Services/ServerEnvironment.ts";

class TaskCliTestHttpApi extends HttpApi.make("environment").add(EnvironmentTaskCliHttpApi) {}

const environmentId = EnvironmentId.make("environment-task-cli-process");
const providerInstanceId = ProviderInstanceId.make("codex-task-cli-test");
const pendingProviderTurnId = TurnId.make("pending-task-cli-turn-1");
const providerTurnId = TurnId.make("native-task-cli-turn-1");

const unsupported = (operation: string): Effect.Effect<never, never> =>
  Effect.die(new Error(`Unexpected external Git operation in Task CLI fixture: ${operation}`));

const inertGit = {
  status: () => unsupported("status"),
  localStatus: () => unsupported("localStatus"),
  remoteStatus: () => unsupported("remoteStatus"),
  invalidateLocalStatus: () => Effect.void,
  invalidateRemoteStatus: () => Effect.void,
  invalidateStatus: () => Effect.void,
  pullCurrentBranch: () => unsupported("pullCurrentBranch"),
  runStackedAction: () => unsupported("runStackedAction"),
  resolvePullRequest: () => unsupported("resolvePullRequest"),
  preparePullRequestThread: () => unsupported("preparePullRequestThread"),
  listRefs: () => unsupported("listRefs"),
  createWorktree: () => unsupported("createWorktree"),
  removeWorktree: () => unsupported("removeWorktree"),
  createRef: () => unsupported("createRef"),
  switchRef: () => unsupported("switchRef"),
  renameBranch: () => unsupported("renameBranch"),
} satisfies Partial<GitWorkflowServiceShape>;

const inertSourceResolver: TaskWorkspaceSourceResolverShape = {
  resolve: ({ projectId, baseRef, worktreePolicy }) =>
    Effect.succeed({
      workspaceRoot: `/tmp/task-cli-process/${projectId}`,
      baseCommitSha: `fixture-${baseRef}`,
      planningRootFingerprint: worktreePolicy === "later" ? null : null,
    }),
};

const makeInertOrchestration = () => {
  let latestThreadId: ThreadId | undefined;
  const dispatch = (command: { readonly type: string; readonly threadId?: ThreadId }) =>
    Effect.sync(() => {
      if (command.threadId !== undefined) latestThreadId = command.threadId;
      return { sequence: command.type === "thread.turn.start" ? 2 : 1 };
    });
  const readEvents = (_fromSequenceExclusive: number) =>
    Stream.succeed({
      sequence: 2,
      type: "thread.session-set",
      payload: {
        threadId: latestThreadId,
        session: { status: "running", activeTurnId: providerTurnId },
      },
    } as unknown as OrchestrationEvent);
  return {
    dispatch,
    readEvents,
    streamDomainEvents: Stream.empty,
  } satisfies Partial<OrchestrationEngineShape>;
};

const environmentLayer = Layer.succeed(ServerEnvironment, {
  getEnvironmentId: Effect.succeed(environmentId),
  getDescriptor: Effect.succeed({
    environmentId,
    label: "task-cli-process-test",
    platform: { os: "darwin", arch: "arm64" },
    serverVersion: "0.0.0",
    capabilities: { repositoryIdentity: true },
  }),
} satisfies ServerEnvironmentShape);

const bootstrapEntry = (task: TaskWorkspace) => {
  const bootstrap = task.bootstrap;
  if (!bootstrap) throw new Error("Expected a Task bootstrap reservation.");
  const stage = "questions" as const;
  return {
    id: "task-cli-process-bootstrap",
    environmentId,
    taskId: task.id,
    operationKey: bootstrap.operationKey,
    target: "bootstrap" as const,
    status: "pending" as const,
    payload: {
      stage,
      occurrence: 0,
      executionProfile: "planning" as const,
      runtimeMode: task.preferences.runtimeMode,
      presentation: "stage" as const,
      sessionId: bootstrap.reservedSessionId,
      threadId: bootstrap.reservedThreadId,
      threadCreateCommandId: bootstrap.threadCreateCommandId,
      turnStartCommandId: bootstrap.turnStartCommandId,
      kickoffMessageId: bootstrap.kickoffMessageId,
      trustedInstructions: "Deterministic Task CLI process fixture.",
      contextManifestId: null,
      continuationCheckpointId: null,
      continuationMode: null,
      continuationActivatePhase: false,
      worktreeBranch: null,
      worktreePath: null,
    },
    attemptCount: 0,
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    completedAt: null,
  } as const;
};

export interface TaskCliProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface TaskCliProcessFixture {
  readonly root: string;
  readonly endpoint: string;
  readonly taskId: TaskWorkspaceId;
  readonly threadId: ThreadId;
  readonly providerInstanceId: ProviderInstanceId;
  readonly providerTurnId: TurnId;
  readonly token: string;
  readonly task: TaskWorkspace;
  readonly taskService: typeof TaskWorkspaceService.Service;
  readonly invocationService: typeof TaskInvocationService.Service;
  readonly providerDirectory: typeof ProviderSessionDirectory.Service;
  readonly runCli: (
    env?: Record<string, string | undefined>,
  ) => Effect.Effect<TaskCliProcessResult>;
}

const runChild = (
  bundlePath: string,
  endpoint: string,
  env: Record<string, string | undefined>,
): Effect.Effect<TaskCliProcessResult, Error> =>
  Effect.callback((resume) => {
    const child = spawn(process.execPath, [bundlePath, "task", "context"], {
      cwd: process.cwd(),
      env: Object.fromEntries(
        Object.entries({ ...process.env, ...env }).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => resume(Effect.fail(error)));
    child.on("close", (exitCode) =>
      resume(
        Effect.succeed({
          exitCode,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        }),
      ),
    );
  });

export const makeTaskCliProcessFixture = Effect.fn("makeTaskCliProcessFixture")(function* () {
  const root = yield* Effect.tryPromise(() =>
    NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-cli-process-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => NodeFs.rm(root, { recursive: true, force: true })),
  );
  const repoRoot = NodePath.join(root, "repo");
  const baseDir = NodePath.join(root, "state");
  yield* Effect.promise(() => NodeFs.mkdir(repoRoot, { recursive: true }));

  const configLayer = ServerConfig.layerTest(repoRoot, baseDir);
  const persistenceLayer = SqlitePersistenceLive.pipe(
    Layer.provide(configLayer),
    Layer.provideMerge(NodeServices.layer),
  );
  const workspaceLayer = TaskWorkspaceServiceLive.pipe(
    Layer.provide(Layer.succeed(GitWorkflowService, inertGit as GitWorkflowServiceShape)),
    Layer.provide(environmentLayer),
    Layer.provide(Layer.succeed(TaskWorkspaceSourceResolver, inertSourceResolver)),
    Layer.provide(
      Layer.succeed(
        OrchestrationEngineService,
        makeInertOrchestration() as OrchestrationEngineShape,
      ),
    ),
    Layer.provide(TaskWorkspaceStoreLive),
    Layer.provide(configLayer),
    Layer.provideMerge(persistenceLayer),
  );
  const directoryLayer = ProviderSessionDirectoryLive.pipe(
    Layer.provide(ProviderSessionRuntimeRepositoryLive),
    Layer.provideMerge(persistenceLayer),
  );
  const invocationLayer = TaskInvocationServiceLive.pipe(
    Layer.provide(workspaceLayer),
    Layer.provide(directoryLayer),
    Layer.provideMerge(persistenceLayer),
  );
  const scope = yield* Effect.scope;
  const services = yield* Layer.buildWithScope(
    Layer.mergeAll(workspaceLayer, directoryLayer, invocationLayer),
    scope,
  );
  const taskService = Context.get(services, TaskWorkspaceService);
  const directory = Context.get(services, ProviderSessionDirectory);
  const invocationService = Context.get(services, TaskInvocationService);
  const taskId = TaskWorkspaceId.make("task-cli-process");
  const projectId = "project-task-cli-process";
  const created = yield* taskService.dispatch({
    type: "task.create",
    commandId: "task-cli-process-create",
    taskId,
    createdAt: "2026-08-13T00:00:00.000Z",
    title: "Task CLI process proof",
    projectId,
    baseRef: "main",
    preset: "guided",
    approvalPolicy: "before-build",
    operationKey: "task-cli-process-create-op",
    brief: "Prove the built Task CLI against real authority.",
    source: { kind: "inline", body: "Prove the built Task CLI against real authority." },
    worktreePolicy: "later",
    modelSelection: { instanceId: providerInstanceId, model: "fixture-model", options: [] },
  } as never);
  yield* taskService.processBootstrap(bootstrapEntry(created.task) as never);
  const task = yield* taskService
    .getTask(taskId)
    .pipe(
      Effect.flatMap((value) =>
        value ? Effect.succeed(value) : Effect.die("Task bootstrap disappeared."),
      ),
    );
  const threadId = ThreadId.make(task.bootstrap?.reservedThreadId ?? "missing-thread");
  yield* directory.upsert({
    threadId,
    provider: ProviderDriverKind.make("codex"),
    providerInstanceId,
    adapterKey: "codex-task-cli-test",
    status: "running",
    runtimeMode: "full-access",
    runtimePayload: { activeTurnId: pendingProviderTurnId },
  });
  const issued = yield* invocationService.issue({
    environmentId,
    threadId,
    providerInstanceId,
    providerTurnId: pendingProviderTurnId,
  });
  yield* directory.upsert({
    threadId,
    provider: ProviderDriverKind.make("codex"),
    providerInstanceId,
    adapterKey: "codex-task-cli-test",
    status: "running",
    runtimeMode: "full-access",
    runtimePayload: { activeTurnId: providerTurnId },
  });
  yield* invocationService.bind({
    token: issued.token,
    threadId,
    providerInstanceId,
    providerTurnId,
  });

  const routeLayer = HttpApiBuilder.layer(TaskCliTestHttpApi).pipe(
    Layer.provide(taskCliHttpApiLayer as never),
    Layer.provideMerge(Layer.succeedContext(services)),
  );
  const serverLayer = HttpRouter.serve(routeLayer, {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(
    Layer.provideMerge(NodeHttpServer.layer(NodeHttp.createServer, { host: "127.0.0.1", port: 0 })),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(Layer.succeedContext(services)),
  );
  const serverContext = yield* Layer.buildWithScope(serverLayer, scope);
  const server = Context.get(serverContext, HttpServer.HttpServer);
  const address = server.address;
  if (typeof address === "string" || !("port" in address))
    throw new Error("Expected TCP server address.");
  const endpoint = `http://127.0.0.1:${address.port}`;
  const bundlePath = NodePath.resolve(process.cwd(), "apps/server/dist/bin.mjs");
  const runCli = (env: Record<string, string | undefined> = {}) =>
    runChild(bundlePath, endpoint, {
      KATACODE_TASK_CLI_ENDPOINT: endpoint,
      KATACODE_TASK_INVOCATION_TOKEN: issued.token,
      ...env,
    }).pipe(Effect.orDie);
  return {
    root,
    endpoint,
    taskId,
    threadId,
    providerInstanceId,
    providerTurnId,
    token: issued.token,
    task,
    taskService,
    invocationService,
    providerDirectory: directory,
    runCli,
  } satisfies TaskCliProcessFixture;
});
