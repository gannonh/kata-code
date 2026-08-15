// @effect-diagnostics missingEffectContext:off
// @effect-diagnostics missingLayerContext:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  TaskCheckFinalizerError,
  TaskCheckFinalizerService,
  TaskCheckFinalizerServiceLive,
} from "./TaskCheckFinalizerService.ts";

const issueInput = {
  taskId: "task-1",
  checkId: "check:typecheck",
  attemptId: "check-attempt-1",
  occurrence: 0,
  commandDigest: "deadbeef",
  canonicalCwd: "/worktree",
  timeoutMs: 120_000,
  maxOutputBytes: 1_048_576,
  startingCommitSha: "0123456789abcdef",
  startingStatus: "",
} as const;

const makeLayer = () =>
  TaskCheckFinalizerServiceLive.pipe(
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  );

describe("TaskCheckFinalizerService", () => {
  it.effect("issues an opaque token, reads bound fields, and never stores the raw token", () =>
    Effect.gen(function* () {
      const service = yield* TaskCheckFinalizerService;
      const issued = yield* service.issue(issueInput);
      expect(issued.finalizerToken.length).toBeGreaterThan(20);
      const read = yield* service.read({ finalizerToken: issued.finalizerToken });
      expect(read).toMatchObject({
        taskId: "task-1",
        checkId: "check:typecheck",
        attemptId: "check-attempt-1",
        occurrence: 0,
        commandDigest: "deadbeef",
        canonicalCwd: "/worktree",
        startingCommitSha: "0123456789abcdef",
      });
      // The raw token must never appear in persisted rows.
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly finalizerHash: string }>`
        SELECT finalizer_hash AS "finalizerHash" FROM task_check_finalizers
      `;
      expect(rows.map((row) => row.finalizerHash)).not.toContain(issued.finalizerToken);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("consumes exactly once and rejects replay", () =>
    Effect.gen(function* () {
      const service = yield* TaskCheckFinalizerService;
      const issued = yield* service.issue(issueInput);
      const consumed = yield* service.consume({ finalizerToken: issued.finalizerToken });
      expect(consumed).toMatchObject({ attemptId: "check-attempt-1", checkId: "check:typecheck" });

      const replay = yield* service
        .consume({ finalizerToken: issued.finalizerToken })
        .pipe(Effect.flip);
      expect(replay).toBeInstanceOf(TaskCheckFinalizerError);
      expect((replay as TaskCheckFinalizerError).code).toBe("replay");

      const reread = yield* service
        .read({ finalizerToken: issued.finalizerToken })
        .pipe(Effect.flip);
      expect((reread as TaskCheckFinalizerError).code).toBe("replay");
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("reconciles only foreign-owner pending finalizers", () =>
    Effect.gen(function* () {
      const service = yield* TaskCheckFinalizerService;
      const issued = yield* service.issue(issueInput);
      yield* service.issue({ ...issueInput, attemptId: "check-attempt-2" });

      // Same-owner finalizers are not reconciled.
      const none = yield* service.reconcile({ foreignOwnersOnly: true });
      expect(none).toEqual([]);

      // Flip one row to a foreign owner generation.
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE task_check_finalizers SET owner_generation = 'foreign-owner' WHERE attempt_id = 'check-attempt-1'`;

      const affected = yield* service.reconcile({ foreignOwnersOnly: true });
      expect(affected).toEqual([{ taskId: "task-1", attemptId: "check-attempt-1" }]);

      // The foreign finalizer is now revoked; the same-owner one is intact.
      const stale = yield* service
        .read({ finalizerToken: issued.finalizerToken })
        .pipe(Effect.flip);
      expect((stale as TaskCheckFinalizerError).code).toBe("stale");
      const remaining = yield* service.reconcile({ foreignOwnersOnly: true });
      expect(remaining).toEqual([]);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("reconciles stale pending finalizers past the age threshold", () =>
    Effect.gen(function* () {
      const service = yield* TaskCheckFinalizerService;
      yield* service.issue(issueInput);
      // A just-issued finalizer is not stale.
      expect(yield* service.reconcile({ olderThanMs: 10_000 })).toEqual([]);
      // A zero/negative threshold reconciles everything pending owned here.
      const affected = yield* service.reconcile({ olderThanMs: 0 });
      expect(affected).toEqual([{ taskId: "task-1", attemptId: "check-attempt-1" }]);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("stamps issued finalizers with the durable claimed owner generation", () =>
    Effect.gen(function* () {
      const service = yield* TaskCheckFinalizerService;
      yield* service.issue(issueInput);
      const sql = yield* SqlClient.SqlClient;
      // The finalizer must fence against the generation this process claimed
      // in the durable owner row — never a process-local fallback and never a
      // stale generation left by a previous runtime.
      const owner = yield* sql<{ readonly ownerGeneration: string }>`
        SELECT owner_generation AS "ownerGeneration"
        FROM task_invocation_lease_owner
        WHERE owner_id = 1
      `;
      expect(owner).toHaveLength(1);
      const row = yield* sql<{ readonly ownerGeneration: string }>`
        SELECT owner_generation AS "ownerGeneration"
        FROM task_check_finalizers
        WHERE attempt_id = ${issueInput.attemptId}
      `;
      expect(row[0]?.ownerGeneration).toBe(owner[0]?.ownerGeneration);
    }).pipe(Effect.provide(makeLayer())),
  );

  it.effect("revokes a prior pending finalizer before issuing a retry token", () =>
    Effect.gen(function* () {
      const service = yield* TaskCheckFinalizerService;
      const first = yield* service.issue(issueInput);
      yield* service.revokeForAttempt({
        taskId: "task-1",
        attemptId: "check-attempt-1",
        reason: "superseded",
      });
      const second = yield* service.issue(issueInput);
      expect(second.finalizerToken).not.toBe(first.finalizerToken);
      const stale = yield* service.read({ finalizerToken: first.finalizerToken }).pipe(Effect.flip);
      expect((stale as TaskCheckFinalizerError).code).toBe("stale");
      const ok = yield* service.consume({ finalizerToken: second.finalizerToken });
      expect(ok.attemptId).toBe("check-attempt-1");
    }).pipe(Effect.provide(makeLayer())),
  );
});
