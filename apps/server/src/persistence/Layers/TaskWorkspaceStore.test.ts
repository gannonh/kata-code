// @effect-diagnostics nodeBuiltinImport:off - the restart test creates a real temporary SQLite file.
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import {
  CommandId,
  EnvironmentId,
  TaskWorkspaceId,
  ThreadId,
  type TaskWorkspace,
} from "@kata-sh/code-contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { TaskWorkspaceStore } from "../Services/TaskWorkspaceStore.ts";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";
import { TaskWorkspaceStoreLive } from "./TaskWorkspaceStore.ts";

const environmentId = EnvironmentId.make("environment-store");
const taskId = TaskWorkspaceId.make("store-task");
const now = "2026-08-01T17:00:00.000Z";

function task(revision: number): TaskWorkspace {
  return {
    id: taskId,
    environmentId,
    title: "Store task",
    versions: {
      taskContract: "task-workspace@0.3.0",
      artifactContract: "task-artifact@0.3.0",
      workflowDefinition: "guided@0.2.0",
      prompt: "task-workspace-guided@0.2.0",
    },
    intake: { brief: "Store test", source: { kind: "inline", body: "Store test" } },
    preferences: { worktreePolicy: "later", modelSelection: null, executionProfile: "planning" },
    bootstrap: null,
    occurrences: [],
    planGate: null,
    gateHistory: [],
    taskRevision: revision,
    workspace: { repositories: [] },
    workflowRuns: [],
    sessions: [],
    artifacts: [],
    comments: [],
    contextManifests: [],
    build: {
      phases: [],
      resultingCommitSha: null,
      activePhaseId: null,
      activeWorkItemId: null,
      checks: [],
      checkpoints: [],
      amendments: [],
      currentPlanRevisionId: null,
      amendmentGateId: null,
      continuationSessionIds: [],
    },
    verification: { criteria: [], results: [], signedOffAt: null },
    sourceLinks: [],
    delivery: { state: "unavailable" },
    createdAt: now,
    updatedAt: now,
  } as const;
}

/** Fresh in-memory store per test: SqlitePersistenceMemory is `:memory:`, so each build is isolated. */
const makeStore = Effect.gen(function* () {
  const layer = TaskWorkspaceStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));
  const context = yield* Layer.build(layer);
  return yield* Effect.service(TaskWorkspaceStore).pipe(Effect.provide(context));
});

describe("TaskWorkspaceStore", () => {
  it.effect("commits events with per-task stream versions and replays them", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const stored = yield* store.commit({
        environmentId,
        events: [
          {
            eventId: "event-1",
            commandId: CommandId.make("command-1"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
          {
            eventId: "event-2",
            commandId: CommandId.make("command-2"),
            taskId,
            type: "task.questions.complete",
            occurredAt: now,
            task: task(2),
          },
        ],
      });
      expect(stored.map((event) => event.sequence).toSorted((a, b) => a - b)).toEqual([1, 2]);

      const replayed = yield* store.replayAll();
      expect(replayed).toHaveLength(2);
      expect(replayed[0]?.task.taskRevision).toBe(1);
      expect(replayed[1]?.task.taskRevision).toBe(2);
    }),
  );

  it.effect("upserts and reads command receipts keyed by environment and command id", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      yield* store.commit({
        environmentId,
        events: [
          {
            eventId: "event-1",
            commandId: CommandId.make("command-1"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
        ],
        commandReceipt: {
          environmentId,
          commandId: CommandId.make("command-1"),
          taskId,
          commandType: "task.create",
          commandDigest: "digest-1",
          operationKey: "op-1",
          status: "accepted",
          resultEventId: "event-1",
          error: null,
          createdAt: now,
        },
      });
      const receipt = yield* store.getCommandReceipt({
        environmentId,
        commandId: CommandId.make("command-1"),
      });
      expect(Option.isSome(receipt)).toBe(true);
      const value = Option.getOrThrow(receipt);
      expect(value.commandDigest).toBe("digest-1");
      expect(value.status).toBe("accepted");
    }),
  );

  it.effect("upserts and reads operation receipts with attempt counts", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      yield* store.commit({
        environmentId,
        events: [
          {
            eventId: "event-1",
            commandId: CommandId.make("command-1"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
        ],
        operationReceipt: {
          environmentId,
          taskId,
          operationType: "task.create",
          operationKey: "op-create-1",
          payloadDigest: "digest-create",
          status: "pending",
          attemptCount: 1,
          sourceCommandIds: [CommandId.make("command-1")],
          resultEventId: null,
          resultTaskRevision: null,
          error: null,
          createdAt: now,
          updatedAt: now,
        },
      });
      const receipt = yield* store.getOperationReceipt({
        environmentId,
        taskId,
        operationKey: "op-create-1",
      });
      expect(Option.isSome(receipt)).toBe(true);
      const value = Option.getOrThrow(receipt);
      expect(value.attemptCount).toBe(1);
      expect(value.status).toBe("pending");
    }),
  );

  it.effect("persists completion proposals and settles them", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const proposal = {
        id: "proposal-1",
        environmentId,
        taskId,
        stage: "questions" as const,
        occurrence: 0,
        sessionId: "session-1",
        threadId: ThreadId.make("thread-1"),
        providerTurnId: "turn-1",
        payloadDigest: "digest-proposal",
        summary: "Clarified.",
        markdown: "# Clarified",
        status: "proposed" as const,
        terminalTurnOutcome: null,
        committedArtifactRevisionId: null,
        rejectionReason: null,
        createdAt: now,
        settledAt: null,
      };
      yield* store.commit({
        environmentId,
        events: [
          {
            eventId: "event-1",
            commandId: CommandId.make("command-1"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
        ],
        proposal,
      });
      const proposed = yield* store.getProposal({
        taskId,
        occurrence: 0,
        providerTurnId: "turn-1",
      });
      expect(Option.isSome(proposed)).toBe(true);
      expect(Option.getOrThrow(proposed).status).toBe("proposed");

      yield* store.upsertProposal({ ...proposal, status: "committed", settledAt: now });
      const settled = yield* store.getProposal({ taskId, occurrence: 0, providerTurnId: "turn-1" });
      expect(Option.getOrThrow(settled).status).toBe("committed");
      expect(Option.getOrThrow(settled).settledAt).toBe(now);
    }),
  );

  it.effect("enqueues outbox rows and reads pending work", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      yield* store.commit({
        environmentId,
        events: [
          {
            eventId: "event-1",
            commandId: CommandId.make("command-1"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
        ],
        outbox: [
          {
            id: "outbox-1",
            environmentId,
            taskId,
            operationKey: "op-bootstrap-1",
            target: "bootstrap",
            status: "pending",
            payload: { sessionId: "session-1", threadId: "thread-1" },
            attemptCount: 0,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          },
        ],
      });
      const pending = yield* store.readPendingOutbox(10);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.target).toBe("bootstrap");
      expect(pending[0]?.payload).toEqual({ sessionId: "session-1", threadId: "thread-1" });
    }),
  );

  it.effect("imports legacy events once and never twice", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const imported = yield* store.importLegacy({
        environmentId,
        events: [
          {
            sequence: 0,
            eventId: "legacy-1",
            commandId: CommandId.make("legacy-command"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
        ],
        migratedEvents: [
          {
            sequence: 0,
            eventId: "migrated-legacy-1",
            commandId: CommandId.make("legacy-command"),
            taskId,
            type: "task.migrated",
            occurredAt: now,
            task: task(2),
          },
        ],
      });
      expect(imported.importedEventCount).toBe(2);

      const second = yield* store.importLegacy({
        environmentId,
        events: [
          {
            sequence: 0,
            eventId: "legacy-1",
            commandId: CommandId.make("legacy-command"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
        ],
        migratedEvents: [],
      });
      expect(second.importedEventCount).toBe(0);
      expect(yield* store.replayAll()).toHaveLength(2);
    }),
  );

  it.effect("rolls back an entire commit when any insert fails", () =>
    Effect.gen(function* () {
      const store = yield* makeStore;
      const result = yield* store
        .commit({
          environmentId,
          events: [
            {
              eventId: "event-1",
              commandId: CommandId.make("command-1"),
              taskId,
              type: "task.create",
              occurredAt: now,
              task: task(1),
            },
            // Duplicate event id inside the same commit must roll back the first insert.
            {
              eventId: "event-1",
              commandId: CommandId.make("command-2"),
              taskId,
              type: "task.questions.complete",
              occurredAt: now,
              task: task(2),
            },
          ],
        })
        .pipe(Effect.exit);
      expect(result._tag).toBe("Failure");
      expect(yield* store.replayAll()).toHaveLength(0);
    }),
  );
});

describe("TaskWorkspaceStore restart", () => {
  it.effect("survives a process restart across a file-backed database", () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-store-restart-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
          Effect.orDie,
        ),
      );
      const dbPath = NodePath.join(root, "state.sqlite");
      const sqliteLayer = makeSqlitePersistenceLive(dbPath);

      const makeRuntime = Effect.gen(function* () {
        const layer = TaskWorkspaceStoreLive.pipe(Layer.provide(sqliteLayer));
        const context = yield* Layer.build(layer);
        return yield* Effect.service(TaskWorkspaceStore).pipe(Effect.provide(context));
      });

      const first = yield* makeRuntime;
      yield* first.commit({
        environmentId,
        events: [
          {
            eventId: "event-1",
            commandId: CommandId.make("command-1"),
            taskId,
            type: "task.create",
            occurredAt: now,
            task: task(1),
          },
        ],
      });

      // A brand new store over the same database file sees the committed event.
      const second = yield* makeRuntime;
      const replayed = yield* second.replayAll();
      expect(replayed).toHaveLength(1);
      expect(replayed[0]?.eventId).toBe("event-1");
      expect(replayed[0]?.task.taskRevision).toBe(1);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
