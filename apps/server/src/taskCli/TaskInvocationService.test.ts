// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics missingEffectContext:off
// @effect-diagnostics missingLayerContext:off
// @effect-diagnostics anyUnknownInErrorContext:off
// @effect-diagnostics unsafeEffectTypeAssertion:off
import { describe, expect, it } from "@effect/vitest";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  TaskWorkspaceId,
  ThreadId,
  TurnId,
  type TaskStageContextResult,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  makeSqlitePersistenceLive,
  SqlitePersistenceMemory,
} from "../persistence/Layers/Sqlite.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
  type ProviderSessionDirectoryShape,
} from "../provider/Services/ProviderSessionDirectory.ts";
import {
  TaskWorkspaceService,
  type TaskWorkspaceServiceShape,
} from "../taskWorkspace/TaskWorkspaceService.ts";
import {
  TaskInvocationService,
  TaskInvocationServiceLive,
  type TaskInvocationServiceShape,
} from "./TaskInvocationService.ts";

const environmentId = EnvironmentId.make("environment-task-cli-test");
const threadId = ThreadId.make("thread-task-cli-test");
const providerInstanceId = ProviderInstanceId.make("codex-test");
const context: TaskStageContextResult = {
  stage: "questions",
  occurrence: 0,
  brief: "Build a provider-neutral Task CLI.",
  feedback: null,
  artifacts: [],
};

const makeLayer = () => {
  let binding: ProviderRuntimeBinding | undefined;
  let active = {
    taskId: TaskWorkspaceId.make("task-cli-test"),
    stage: "questions" as const,
    occurrence: 0,
    context,
  };

  const directory: ProviderSessionDirectoryShape = {
    upsert: (next) =>
      Effect.sync(() => {
        binding = {
          ...next,
          threadId,
          provider: ProviderDriverKind.make("codex"),
          providerInstanceId,
        };
      }),
    getProvider: () => Effect.succeed(ProviderDriverKind.make("codex")),
    getBinding: () => Effect.succeed(binding === undefined ? Option.none() : Option.some(binding)),
    listThreadIds: () => Effect.succeed(binding ? [threadId] : []),
    listBindings: () =>
      Effect.succeed(binding ? [{ ...binding, lastSeenAt: "2026-01-01T00:00:00.000Z" }] : []),
  };

  const taskWorkspace = {
    resolveTaskCliInvocation: () => Effect.succeed(active),
  } as unknown as TaskWorkspaceServiceShape;

  const layer = TaskInvocationServiceLive.pipe(
    Layer.provide(Layer.succeed(ProviderSessionDirectory, directory)),
    Layer.provide(Layer.succeed(TaskWorkspaceService, taskWorkspace)),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  );

  return {
    layer,
    setBinding: (turnId: string, status: "running" | "stopped" = "running") => {
      binding = {
        threadId,
        provider: ProviderDriverKind.make("codex"),
        providerInstanceId,
        status,
        runtimePayload: { activeTurnId: turnId },
      };
    },
    setActive: (next: Partial<typeof active>) => {
      active = { ...active, ...next };
    },
  };
};

const issueInput = (providerTurnId: string) => ({
  environmentId,
  threadId,
  providerInstanceId,
  providerTurnId: TurnId.make(providerTurnId),
});

const readLeaseRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly tokenHash: string;
    readonly status: string;
    readonly providerTurnId: string;
    readonly revocationReason: string | null;
  }>`
    SELECT
      token_hash AS "tokenHash",
      status,
      provider_turn_id AS "providerTurnId",
      revocation_reason AS "revocationReason"
    FROM task_invocation_leases
    ORDER BY issued_at, rowid
  `;
});

describe("TaskInvocationService", () => {
  it.effect("issues a hashed lease and resolves bounded server context", () => {
    const test = makeLayer();
    return Effect.gen(function* () {
      test.setBinding("turn-1");
      const service = yield* TaskInvocationService;
      const issued = yield* service.issue(issueInput("turn-1"));
      const resolved = yield* service.resolve(issued.token);
      const rows = yield* readLeaseRows;

      expect(resolved.context).toEqual(context);
      expect(resolved.scope.taskId).toBe("task-cli-test");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe("active");
      expect(rows[0]?.providerTurnId).toBe("turn-1");
      expect(rows[0]?.tokenHash).not.toBe(issued.token);
      expect(rows.some((row) => Object.values(row).includes(issued.token))).toBe(false);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("binds the pending lease to the canonical native provider turn", () => {
    const test = makeLayer();
    return Effect.gen(function* () {
      test.setBinding("pending-task-cli-1");
      const service = yield* TaskInvocationService;
      const issued = yield* service.issue(issueInput("pending-task-cli-1"));
      test.setBinding("native-turn-1");
      yield* service.bind({
        token: issued.token,
        threadId,
        providerInstanceId,
        providerTurnId: TurnId.make("native-turn-1"),
      });
      const resolved = yield* service.resolve(issued.token);
      expect(resolved.scope.providerTurnId).toBe("native-turn-1");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("atomically supersedes the old lease and keeps only one active row", () => {
    const test = makeLayer();
    return Effect.gen(function* () {
      test.setBinding("turn-1");
      const service = yield* TaskInvocationService;
      const first = yield* service.issue(issueInput("turn-1"));
      test.setBinding("turn-2");
      const second = yield* service.issue(issueInput("turn-2"));
      const oldFailure = yield* service.resolve(first.token).pipe(Effect.flip);
      const fresh = yield* service.resolve(second.token);
      const rows = yield* readLeaseRows;

      expect(oldFailure.code).toBe("stale_lease");
      expect(fresh.scope.providerTurnId).toBe("turn-2");
      expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
      expect(rows[0]?.revocationReason).toBe("superseded");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("serializes concurrent rotations at the database boundary", () => {
    const test = makeLayer();
    return Effect.gen(function* () {
      test.setBinding("turn-b");
      const service = yield* TaskInvocationService;
      const [first, second] = yield* Effect.all(
        [service.issue(issueInput("turn-a")), service.issue(issueInput("turn-b"))],
        { concurrency: "unbounded" },
      );
      const rows = yield* readLeaseRows;
      const activeRows = rows.filter((row) => row.status === "active");
      const successful = yield* Effect.forEach([first, second], (issued) =>
        service.resolve(issued.token).pipe(Effect.option),
      );

      expect(activeRows).toHaveLength(1);
      expect(successful.filter(Option.isSome)).toHaveLength(1);
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("rejects terminal, old-turn, cross-scope, and orphaned leases", () => {
    const test = makeLayer();
    return Effect.gen(function* () {
      test.setBinding("turn-terminal");
      const service = yield* TaskInvocationService;
      const terminal = yield* service.issue(issueInput("turn-terminal"));
      yield* service.revokeTurn({ threadId, providerTurnId: TurnId.make("turn-terminal") });
      const terminalFailure = yield* service.resolve(terminal.token).pipe(Effect.flip);
      expect(terminalFailure.code).toBe("terminal_lease");

      test.setBinding("turn-cross-scope");
      const crossScope = yield* service.issue(issueInput("turn-cross-scope"));
      test.setActive({ occurrence: 1 });
      const scopeFailure = yield* service.resolve(crossScope.token).pipe(Effect.flip);
      expect(scopeFailure.code).toBe("stale_lease");

      test.setActive({ occurrence: 0 });
      test.setBinding("turn-orphan");
      const orphan = yield* service.issue(issueInput("turn-orphan"));
      test.setBinding("turn-orphan", "stopped");
      const orphanFailure = yield* service.resolve(orphan.token).pipe(Effect.flip);
      expect(orphanFailure.code).toBe("terminal_lease");
    }).pipe(Effect.provide(test.layer));
  });

  // @effect-diagnostics missingEffectContext:off
  it.effect(
    "fences stale runtime writers across shared SQLite",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.promise(() =>
          NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-owner-fence-")),
        );
        const dbPath = NodePath.join(root, "state.sqlite");
        const makeAuthority = () => {
          const directory: ProviderSessionDirectoryShape = {
            upsert: () => Effect.void,
            getProvider: () => Effect.succeed(ProviderDriverKind.make("codex")),
            getBinding: () =>
              Effect.succeed(
                Option.some({
                  threadId,
                  provider: ProviderDriverKind.make("codex"),
                  providerInstanceId,
                  status: "running" as const,
                  runtimePayload: { activeTurnId: "turn-shared" },
                }),
              ),
            listThreadIds: () => Effect.succeed([threadId]),
            listBindings: () => Effect.succeed([]),
          };
          const taskWorkspace = {
            resolveTaskCliInvocation: () =>
              Effect.succeed({
                taskId: TaskWorkspaceId.make("task-cli-shared"),
                stage: "questions" as const,
                occurrence: 0,
                context,
              }),
          } as unknown as TaskWorkspaceServiceShape;
          return { directory, taskWorkspace };
        };
        const build = (sqlite: Layer.Layer<SqlClient.SqlClient, unknown, unknown>) => {
          const authority = makeAuthority();
          const persistence = sqlite.pipe(Layer.provideMerge(NodeServices.layer));
          return Layer.fresh(TaskInvocationServiceLive).pipe(
            Layer.provide(Layer.succeed(ProviderSessionDirectory, authority.directory)),
            Layer.provide(Layer.succeed(TaskWorkspaceService, authority.taskWorkspace)),
            Layer.provideMerge(persistence),
            Layer.provideMerge(NodeServices.layer),
          );
        };
        const firstSqlite = makeSqlitePersistenceLive(dbPath);
        const firstScope = yield* Scope.make();
        yield* Effect.addFinalizer(() => Scope.close(firstScope, Exit.void));
        const firstContext = yield* Layer.buildWithScope(
          build(firstSqlite).pipe(Layer.provide(NodeServices.layer)),
          firstScope,
        );
        const firstService = Context.get(firstContext, TaskInvocationService);
        const firstIssued = yield* Effect.provide(
          firstService.issue(issueInput("turn-shared")),
          firstContext,
        );

        const secondSqlite = makeSqlitePersistenceLive(dbPath);
        const secondScope = yield* Scope.make();
        yield* Effect.addFinalizer(() => Scope.close(secondScope, Exit.void));
        const secondContext = yield* Layer.buildWithScope(
          build(secondSqlite).pipe(Layer.provide(NodeServices.layer)),
          secondScope,
        );
        const secondService = Context.get(secondContext, TaskInvocationService);
        const secondIssued = yield* Effect.provide(
          secondService.issue(issueInput("turn-shared")),
          secondContext,
        );

        const readSharedRows = Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ readonly status: string; readonly ownerGeneration: string }>`
            SELECT status, owner_generation AS "ownerGeneration"
            FROM task_invocation_leases
            WHERE provider_turn_id = 'turn-shared'
            ORDER BY issued_at, rowid
          `;
        }).pipe(Effect.provide(secondContext));

        const rowsBeforeStaleWrites = yield* readSharedRows;
        const generations = [...new Set(rowsBeforeStaleWrites.map((row) => row.ownerGeneration))];
        expect(generations).toHaveLength(2);
        expect(generations[0]).not.toBe(generations[1]);
        expect(rowsBeforeStaleWrites.filter((row) => row.status === "active")).toHaveLength(1);
        const activeOwnerBefore = rowsBeforeStaleWrites.find(
          (row) => row.status === "active",
        )?.ownerGeneration;
        expect(activeOwnerBefore).toBeDefined();

        const firstOwnFailure = yield* Effect.provide(
          firstService.resolve(firstIssued.token),
          firstContext,
        ).pipe(Effect.flip);
        expect(firstOwnFailure.code).toBe("stale_lease");

        yield* Effect.provide(firstService.reconcile, firstContext);
        yield* Effect.provide(firstService.revokeThread(threadId), firstContext);
        yield* Effect.provide(
          firstService.revokeTurn({ threadId, providerTurnId: TurnId.make("turn-shared") }),
          firstContext,
        );
        yield* Effect.provide(firstService.revokeAll, firstContext);
        const firstIssueFailure = yield* Effect.provide(
          firstService.issue(issueInput("turn-shared")),
          firstContext,
        ).pipe(Effect.flip);
        expect(firstIssueFailure.code).toBe("stale_lease");

        const secondResolution = yield* Effect.provide(
          secondService.resolve(secondIssued.token),
          secondContext,
        );
        expect(secondResolution.scope.providerTurnId).toBe("turn-shared");

        const rows = yield* readSharedRows;
        expect(rows.filter((row) => row.status === "active")).toHaveLength(1);
        expect(rows.find((row) => row.status === "active")?.ownerGeneration).toBe(
          activeOwnerBefore,
        );
        expect(new Set(rows.map((row) => row.ownerGeneration)).size).toBe(2);
      }) as Effect.Effect<void, unknown, Scope.Scope>,
  );

  it.effect("keeps a no-expiry lease valid after a long TestClock turn", () => {
    const test = makeLayer();
    return Effect.gen(function* () {
      test.setBinding("turn-long");
      const service = yield* TaskInvocationService;
      const issued = yield* service.issue(issueInput("turn-long"));
      yield* TestClock.adjust("24 hours");
      const resolved = yield* service.resolve(issued.token);
      const rows = yield* readLeaseRows;

      expect(resolved.context).toEqual(context);
      expect(resolved.lease.expiresAt).toBeNull();
      expect(rows[0]?.status).toBe("active");
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("revokes every thread lease on explicit stop and never returns raw credentials", () => {
    const test = makeLayer();
    return Effect.gen(function* () {
      test.setBinding("turn-stop");
      const service = yield* TaskInvocationService;
      const issued = yield* service.issue(issueInput("turn-stop"));
      yield* service.revokeThread(threadId);
      const failure = yield* service.resolve(issued.token).pipe(Effect.flip);
      const rows = yield* readLeaseRows;

      expect(failure.code).toBe("terminal_lease");
      expect(rows[0]?.revocationReason).toBe("stopped");
      expect(rows[0]).not.toHaveProperty("token");
    }).pipe(Effect.provide(test.layer));
  });
});

// Keep the service shape imported in this file so accidental widening of the
// test double remains visible to typecheck when the invocation boundary grows.
void (undefined as TaskInvocationServiceShape | undefined);
