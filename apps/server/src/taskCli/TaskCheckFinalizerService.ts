import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { TaskInvocationOwner, TaskInvocationOwnerLive } from "./TaskInvocationOwner.ts";

const FinalizerRow = Schema.Struct({
  finalizerHash: Schema.String,
  taskId: Schema.String,
  checkId: Schema.String,
  attemptId: Schema.String,
  occurrence: Schema.Number,
  commandDigest: Schema.String,
  canonicalCwd: Schema.String,
  timeoutMs: Schema.Number,
  maxOutputBytes: Schema.Number,
  startingCommitSha: Schema.String,
  startingStatus: Schema.String,
  ownerGeneration: Schema.String,
  status: Schema.String,
  issuedAt: Schema.String,
  consumedAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String),
  revocationReason: Schema.NullOr(Schema.String),
});
type FinalizerRow = typeof FinalizerRow.Type;

export interface ConsumedFinalizer {
  readonly taskId: string;
  readonly checkId: string;
  readonly attemptId: string;
  readonly occurrence: number;
  readonly commandDigest: string;
  readonly canonicalCwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly startingCommitSha: string;
  readonly startingStatus: string;
  readonly consumedAt: string;
}

export interface PendingFinalizer {
  readonly taskId: string;
  readonly checkId: string;
  readonly attemptId: string;
  readonly occurrence: number;
  readonly commandDigest: string;
  readonly canonicalCwd: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
  readonly startingCommitSha: string;
  readonly startingStatus: string;
  readonly issuedAt: string;
}

export class TaskCheckFinalizerError extends Data.TaggedError("TaskCheckFinalizerError")<{
  readonly code: "not_found" | "replay" | "stale" | "internal";
  readonly message: string;
  readonly attemptId?: string;
  readonly cause?: unknown;
}> {}

export interface TaskCheckFinalizerServiceShape {
  readonly issue: (input: {
    readonly taskId: string;
    readonly checkId: string;
    readonly attemptId: string;
    readonly occurrence: number;
    readonly commandDigest: string;
    readonly canonicalCwd: string;
    readonly timeoutMs: number;
    readonly maxOutputBytes: number;
    readonly startingCommitSha: string;
    readonly startingStatus: string;
  }) => Effect.Effect<{ readonly finalizerToken: string }, TaskCheckFinalizerError>;
  readonly consume: (input: {
    readonly finalizerToken: string;
  }) => Effect.Effect<ConsumedFinalizer, TaskCheckFinalizerError>;
  readonly read: (input: {
    readonly finalizerToken: string;
  }) => Effect.Effect<PendingFinalizer, TaskCheckFinalizerError>;
  readonly pendingForAttempt: (input: {
    readonly taskId: string;
    readonly attemptId: string;
  }) => Effect.Effect<boolean, TaskCheckFinalizerError>;
  readonly revokeForAttempt: (input: {
    readonly taskId: string;
    readonly attemptId: string;
    readonly reason: "reconciled" | "superseded" | "orphan";
  }) => Effect.Effect<void, TaskCheckFinalizerError>;
  readonly reconcile: (input: {
    readonly olderThanMs?: number;
    readonly foreignOwnersOnly?: boolean;
  }) => Effect.Effect<
    ReadonlyArray<{ readonly taskId: string; readonly attemptId: string }>,
    TaskCheckFinalizerError
  >;
}

export class TaskCheckFinalizerService extends Context.Service<
  TaskCheckFinalizerService,
  TaskCheckFinalizerServiceShape
>()("@kata-sh/code-cli/taskCli/TaskCheckFinalizerService") {}

const decodeRow = Schema.decodeUnknownEffect(FinalizerRow);

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;

  // Fencing reuses the invocation-lease owner row claimed by
  // TaskInvocationOwner. Requiring that layer (instead of reading the row at
  // construction time) guarantees this process's freshly claimed generation is
  // observed, never a previous runtime's stale one.
  const { ownerGeneration } = yield* TaskInvocationOwner;

  const toError = (
    code: TaskCheckFinalizerError["code"],
    message: string,
    cause?: unknown,
    attemptId?: string,
  ) =>
    new TaskCheckFinalizerError({
      code,
      message,
      ...(cause !== undefined ? { cause } : {}),
      ...(attemptId !== undefined ? { attemptId } : {}),
    });

  const hashToken = (token: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(token))
      .pipe(Effect.map((bytes) => Buffer.from(bytes).toString("hex")));

  const findRow = SqlSchema.findOneOption({
    Request: Schema.Struct({ finalizerHash: Schema.String }),
    Result: FinalizerRow,
    execute: ({ finalizerHash }) => sql`
      SELECT
        finalizer_hash AS "finalizerHash",
        task_id AS "taskId",
        check_id AS "checkId",
        attempt_id AS "attemptId",
        occurrence,
        command_digest AS "commandDigest",
        canonical_cwd AS "canonicalCwd",
        timeout_ms AS "timeoutMs",
        max_output_bytes AS "maxOutputBytes",
        starting_commit_sha AS "startingCommitSha",
        starting_status AS "startingStatus",
        owner_generation AS "ownerGeneration",
        status,
        issued_at AS "issuedAt",
        consumed_at AS "consumedAt",
        revoked_at AS "revokedAt",
        revocation_reason AS "revocationReason"
      FROM task_check_finalizers
      WHERE finalizer_hash = ${finalizerHash}
    `,
  });

  const issue: TaskCheckFinalizerServiceShape["issue"] = Effect.fn(
    "TaskCheckFinalizerService.issue",
  )(function* (input) {
    const token = yield* crypto.randomBytes(32).pipe(
      Effect.map((bytes) => Buffer.from(bytes).toString("base64url")),
      Effect.mapError((cause) =>
        toError("internal", "Failed to issue check finalization credential.", cause),
      ),
    );
    const finalizerHash = yield* hashToken(token).pipe(
      Effect.mapError((cause) =>
        toError("internal", "Failed to hash check finalization credential.", cause),
      ),
    );
    const issuedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO task_check_finalizers (
        finalizer_hash, task_id, check_id, attempt_id, occurrence,
        command_digest, canonical_cwd, timeout_ms, max_output_bytes,
        starting_commit_sha, starting_status, owner_generation, status,
        issued_at, consumed_at, revoked_at, revocation_reason
      ) VALUES (
        ${finalizerHash}, ${input.taskId}, ${input.checkId}, ${input.attemptId}, ${input.occurrence},
        ${input.commandDigest}, ${input.canonicalCwd}, ${input.timeoutMs}, ${input.maxOutputBytes},
        ${input.startingCommitSha}, ${input.startingStatus}, ${ownerGeneration}, 'pending',
        ${issuedAt}, NULL, NULL, NULL
      )
    `.pipe(
      Effect.mapError((cause) =>
        toError("internal", "Failed to persist check finalization credential.", cause),
      ),
    );
    return { finalizerToken: token };
  });

  const resolvePendingRow = Effect.fn("TaskCheckFinalizerService.resolvePendingRow")(
    function* (input: { readonly finalizerToken: string }) {
      const token = input.finalizerToken.trim();
      if (token.length === 0) {
        return yield* toError("not_found", "A check finalization credential is required.");
      }
      const finalizerHash = yield* hashToken(token).pipe(
        Effect.mapError((cause) =>
          toError("internal", "Failed to hash check finalization credential.", cause),
        ),
      );
      const existing = yield* findRow({ finalizerHash }).pipe(
        Effect.mapError((cause) =>
          toError("internal", "Failed to read check finalization credential.", cause),
        ),
      );
      if (Option.isNone(existing)) {
        return yield* toError("not_found", "The check finalization credential is not valid.");
      }
      const row = existing.value;
      if (row.status === "consumed") {
        return yield* toError(
          "replay",
          "The check finalization credential was already consumed.",
          undefined,
          row.attemptId,
        );
      }
      if (row.status !== "pending") {
        return yield* toError("stale", "The check finalization credential is no longer active.");
      }
      if (row.ownerGeneration !== ownerGeneration) {
        return yield* toError(
          "stale",
          "The check finalization credential belongs to an inactive runtime.",
        );
      }
      return { row, finalizerHash };
    },
  );

  const read: TaskCheckFinalizerServiceShape["read"] = Effect.fn("TaskCheckFinalizerService.read")(
    function* (input) {
      const { row } = yield* resolvePendingRow(input);
      return {
        taskId: row.taskId,
        checkId: row.checkId,
        attemptId: row.attemptId,
        occurrence: row.occurrence,
        commandDigest: row.commandDigest,
        canonicalCwd: row.canonicalCwd,
        timeoutMs: row.timeoutMs,
        maxOutputBytes: row.maxOutputBytes,
        startingCommitSha: row.startingCommitSha,
        startingStatus: row.startingStatus,
        issuedAt: row.issuedAt,
      } satisfies PendingFinalizer;
    },
  );

  const consume: TaskCheckFinalizerServiceShape["consume"] = Effect.fn(
    "TaskCheckFinalizerService.consume",
  )(function* (input) {
    const { row, finalizerHash } = yield* resolvePendingRow(input);
    const consumedAt = DateTime.formatIso(yield* DateTime.now);
    const updated = yield* sql<{ readonly finalizerHash: string }>`
      UPDATE task_check_finalizers
      SET status = 'consumed', consumed_at = ${consumedAt}
      WHERE finalizer_hash = ${finalizerHash}
        AND status = 'pending'
        AND owner_generation = ${ownerGeneration}
      RETURNING finalizer_hash AS "finalizerHash"
    `.pipe(
      Effect.mapError((cause) =>
        toError("internal", "Failed to consume check finalization credential.", cause),
      ),
    );
    if (updated.length !== 1) {
      return yield* toError("replay", "The check finalization credential was already consumed.");
    }
    return {
      taskId: row.taskId,
      checkId: row.checkId,
      attemptId: row.attemptId,
      occurrence: row.occurrence,
      commandDigest: row.commandDigest,
      canonicalCwd: row.canonicalCwd,
      timeoutMs: row.timeoutMs,
      maxOutputBytes: row.maxOutputBytes,
      startingCommitSha: row.startingCommitSha,
      startingStatus: row.startingStatus,
      consumedAt,
    } satisfies ConsumedFinalizer;
  });

  const pendingForAttempt: TaskCheckFinalizerServiceShape["pendingForAttempt"] = (input) =>
    Effect.gen(function* () {
      const rows = yield* sql<{ readonly attemptId: string }>`
        SELECT attempt_id AS "attemptId"
        FROM task_check_finalizers
        WHERE task_id = ${input.taskId}
          AND attempt_id = ${input.attemptId}
          AND status = 'pending'
          AND owner_generation = ${ownerGeneration}
      `.pipe(
        Effect.mapError((cause) =>
          toError("internal", "Failed to read check finalization credential.", cause),
        ),
      );
      return rows.length > 0;
    });

  const revokeForAttempt: TaskCheckFinalizerServiceShape["revokeForAttempt"] = (input) =>
    Effect.gen(function* () {
      const revokedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        UPDATE task_check_finalizers
        SET status = 'revoked', revoked_at = ${revokedAt}, revocation_reason = ${input.reason}
        WHERE task_id = ${input.taskId}
          AND attempt_id = ${input.attemptId}
          AND status = 'pending'
          AND owner_generation = ${ownerGeneration}
      `;
    }).pipe(
      Effect.asVoid,
      Effect.mapError((cause) =>
        toError("internal", "Failed to revoke check finalization credential.", cause),
      ),
    );

  const reconcile: TaskCheckFinalizerServiceShape["reconcile"] = (input) =>
    Effect.gen(function* () {
      const thresholdIso = input.olderThanMs
        ? DateTime.formatIso(
            DateTime.subtract(yield* DateTime.now, { milliseconds: input.olderThanMs }),
          )
        : null;
      const rows = yield* sql<{ readonly taskId: string; readonly attemptId: string }>`
        SELECT task_id AS "taskId", attempt_id AS "attemptId"
        FROM task_check_finalizers
        WHERE status = 'pending'
          AND (
            ${input.foreignOwnersOnly === true ? sql`owner_generation <> ${ownerGeneration}` : sql`owner_generation = ${ownerGeneration}`}
          )
          ${thresholdIso !== null ? sql`AND issued_at <= ${thresholdIso}` : sql``}
      `.pipe(
        Effect.mapError((cause) =>
          toError("internal", "Failed to reconcile check finalization credentials.", cause),
        ),
      );
      const affected = rows.map((row) => ({ taskId: row.taskId, attemptId: row.attemptId }));
      if (affected.length > 0) {
        const revokedAt = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          UPDATE task_check_finalizers
          SET status = 'revoked', revoked_at = ${revokedAt}, revocation_reason = 'reconciled'
          WHERE status = 'pending'
            AND (
              ${input.foreignOwnersOnly === true ? sql`owner_generation <> ${ownerGeneration}` : sql`owner_generation = ${ownerGeneration}`}
            )
            ${thresholdIso !== null ? sql`AND issued_at <= ${thresholdIso}` : sql``}
        `.pipe(
          Effect.mapError((cause) =>
            toError(
              "internal",
              "Failed to revoke reconciled check finalization credentials.",
              cause,
            ),
          ),
        );
      }
      return affected;
    });

  return {
    issue,
    consume,
    read,
    pendingForAttempt,
    revokeForAttempt,
    reconcile,
  } satisfies TaskCheckFinalizerServiceShape;
});

export const TaskCheckFinalizerServiceLive = Layer.effect(TaskCheckFinalizerService, make).pipe(
  Layer.provide(TaskInvocationOwnerLive),
);
