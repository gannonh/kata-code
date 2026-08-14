import {
  EnvironmentId,
  ProviderInstanceId,
  TaskCliErrorCode,
  TaskInvocationLease,
  TaskInvocationScope,
  TaskStageContextResult,
  TaskWorkspaceError,
  TaskWorkspaceId,
  TaskWorkspaceStage,
  ThreadId,
  TurnId,
} from "@kata-sh/code-contracts";
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

import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "../provider/Services/ProviderSessionDirectory.ts";
import { TaskWorkspaceService } from "../taskWorkspace/TaskWorkspaceService.ts";

const LeaseRow = Schema.Struct({
  tokenHash: Schema.String,
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  occurrence: Schema.Number,
  stage: TaskWorkspaceStage,
  threadId: ThreadId,
  providerInstanceId: ProviderInstanceId,
  providerTurnId: TurnId,
  ownerGeneration: Schema.String,
  status: Schema.String,
  issuedAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  revokedAt: Schema.NullOr(Schema.String),
  revocationReason: Schema.NullOr(Schema.String),
});
type LeaseRow = typeof LeaseRow.Type;

type TaskInvocationScopeValue = typeof TaskInvocationScope.Type;
type TaskStageContextResultValue = typeof TaskStageContextResult.Type;

const decodeLease = Schema.decodeUnknownEffect(TaskInvocationLease);
const decodeScope = Schema.decodeUnknownEffect(TaskInvocationScope);

export class TaskInvocationError extends Data.TaggedError("TaskInvocationError")<{
  readonly code: TaskCliErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface TaskInvocationResolution {
  readonly lease: TaskInvocationLease;
  readonly scope: TaskInvocationScopeValue;
  readonly context: TaskStageContextResultValue;
}

export interface TaskInvocationServiceShape {
  /** Allocate a fresh single-turn credential. The turn id may be a server-owned
   * pending id while a provider allocates its native turn id. */
  readonly issue: (input: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly providerTurnId: TurnId;
  }) => Effect.Effect<
    { readonly token: string; readonly scope: TaskInvocationScopeValue },
    TaskInvocationError
  >;
  /** Bind a prepared credential to the provider's native turn id. */
  readonly bind: (input: {
    readonly token: string;
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly providerTurnId: TurnId;
  }) => Effect.Effect<void, TaskInvocationError>;
  readonly resolve: (
    rawToken: string,
  ) => Effect.Effect<TaskInvocationResolution, TaskInvocationError>;
  readonly revokeThread: (threadId: ThreadId) => Effect.Effect<void, TaskInvocationError>;
  readonly revokeTurn: (input: {
    readonly threadId: ThreadId;
    readonly providerTurnId: TurnId;
  }) => Effect.Effect<void, TaskInvocationError>;
  readonly revokeAll: Effect.Effect<void, TaskInvocationError>;
  readonly reconcile: Effect.Effect<void, TaskInvocationError>;
}

export class TaskInvocationService extends Context.Service<
  TaskInvocationService,
  TaskInvocationServiceShape
>()("@kata-sh/code-cli/taskCli/TaskInvocationService") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const sql = yield* SqlClient.SqlClient;
  const sessions = yield* Effect.serviceOption(ProviderSessionDirectory);
  const taskWorkspace = yield* Effect.serviceOption(TaskWorkspaceService);
  const ownerGeneration = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
  const claimedAt = DateTime.formatIso(yield* DateTime.now);
  yield* sql`
    INSERT INTO task_invocation_lease_owner (owner_id, owner_generation, claimed_at)
    VALUES (1, ${ownerGeneration}, ${claimedAt})
    ON CONFLICT(owner_id) DO UPDATE SET
      owner_generation = excluded.owner_generation,
      claimed_at = excluded.claimed_at
  `;

  const findLease = SqlSchema.findOneOption({
    Request: Schema.Struct({ tokenHash: Schema.String }),
    Result: LeaseRow,
    execute: ({ tokenHash }) => sql`
      SELECT
        token_hash AS "tokenHash",
        environment_id AS "environmentId",
        task_id AS "taskId",
        occurrence,
        stage,
        thread_id AS "threadId",
        provider_instance_id AS "providerInstanceId",
        provider_turn_id AS "providerTurnId",
        owner_generation AS "ownerGeneration",
        status,
        issued_at AS "issuedAt",
        expires_at AS "expiresAt",
        revoked_at AS "revokedAt",
        revocation_reason AS "revocationReason"
      FROM task_invocation_leases
      WHERE token_hash = ${tokenHash}
    `,
  });

  const hashToken = (token: string) =>
    crypto
      .digest("SHA-256", new TextEncoder().encode(token))
      .pipe(Effect.map((bytes) => Buffer.from(bytes).toString("hex")));

  const toError = (code: TaskCliErrorCode, message: string, cause?: unknown) =>
    new TaskInvocationError({ code, message, ...(cause !== undefined ? { cause } : {}) });

  const isTaskWorkspaceError = Schema.is(TaskWorkspaceError);

  const preserveInvocationError =
    (message: string) =>
    (cause: unknown): TaskInvocationError =>
      cause instanceof TaskInvocationError ? cause : toError("internal_error", message, cause);

  const currentOwnerExists = sql<{ readonly ownerGeneration: string }>`
    SELECT owner_generation AS "ownerGeneration"
    FROM task_invocation_lease_owner
    WHERE owner_id = 1 AND owner_generation = ${ownerGeneration}
  `.pipe(
    Effect.mapError((cause) =>
      toError("internal_error", "Failed to read invocation runtime ownership.", cause),
    ),
  );

  const isCurrentOwner = Effect.gen(function* () {
    const rows = yield* currentOwnerExists;
    return rows.length === 1;
  });

  const revokeToken = (
    tokenHash: string,
    reason:
      | "superseded"
      | "terminal"
      | "failed"
      | "stopped"
      | "startup_orphan"
      | "orphan"
      | "manual" = "orphan",
  ) =>
    Effect.gen(function* () {
      const revokedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        UPDATE task_invocation_leases
        SET status = 'revoked', revoked_at = ${revokedAt}, revocation_reason = ${reason}
        WHERE token_hash = ${tokenHash}
          AND owner_generation = ${ownerGeneration}
          AND status = 'active'
      `;
    }).pipe(
      Effect.mapError((cause) =>
        toError("internal_error", "Failed to revoke invocation credential.", cause),
      ),
    );

  const currentBinding = (scope: TaskInvocationScopeValue) =>
    Option.isNone(sessions)
      ? Effect.succeed(Option.none<ProviderRuntimeBinding>())
      : sessions.value
          .getBinding(scope.threadId)
          .pipe(
            Effect.mapError((cause) =>
              toError("internal_error", "Failed to read provider turn state.", cause),
            ),
          );

  const reconcileStartupLeases = Effect.gen(function* () {
    // Persisted provider bindings do not prove continuity across a process
    // restart; only the current process can bind a fresh lease to a native
    // turn. Startup fences every lease owned by a prior runtime generation,
    // and only while this process still owns the singleton owner row.
    const revokedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      UPDATE task_invocation_leases
      SET status = 'revoked', revoked_at = ${revokedAt}, revocation_reason = 'startup_orphan'
      WHERE status = 'active'
        AND owner_generation <> ${ownerGeneration}
        AND EXISTS (
          SELECT 1 FROM task_invocation_lease_owner
          WHERE owner_id = 1 AND owner_generation = ${ownerGeneration}
        )
    `.pipe(
      Effect.mapError((cause) =>
        toError("internal_error", "Failed to fence Task CLI invocation credentials.", cause),
      ),
    );
  }).pipe(
    Effect.mapError(
      preserveInvocationError("Failed to reconcile Task CLI invocation credentials."),
    ),
  );

  const resolveActiveTaskInvocation = (scope: {
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly providerInstanceId: ProviderInstanceId;
    readonly providerTurnId: TurnId;
  }) =>
    Option.isNone(taskWorkspace)
      ? Effect.fail(toError("internal_error", "The Task workflow service is unavailable."))
      : taskWorkspace.value
          .resolveTaskCliInvocation(scope)
          .pipe(
            Effect.mapError((cause) =>
              isTaskWorkspaceError(cause) && cause.commandType === "task.cli.context"
                ? toError("not_active", cause.message, cause)
                : toError("internal_error", cause.message, cause),
            ),
          );

  const bindingHasTurn = (
    binding: Option.Option<ProviderRuntimeBinding>,
    scope: TaskInvocationScopeValue,
  ): boolean => {
    if (Option.isNone(binding)) return false;
    if (binding.value.providerInstanceId !== scope.providerInstanceId) return false;
    if (binding.value.status !== "running") return false;
    const payload = binding.value.runtimePayload;
    return (
      payload !== null &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).activeTurnId === scope.providerTurnId
    );
  };

  yield* reconcileStartupLeases;

  const issue: TaskInvocationServiceShape["issue"] = Effect.fn("TaskInvocationService.issue")(
    function* (input) {
      const active = yield* resolveActiveTaskInvocation({
        environmentId: input.environmentId,
        threadId: input.threadId,
        providerInstanceId: input.providerInstanceId,
        providerTurnId: input.providerTurnId,
      });
      const scope = yield* decodeScope({
        environmentId: input.environmentId,
        taskId: active.taskId,
        occurrence: active.occurrence,
        stage: active.stage,
        threadId: input.threadId,
        providerInstanceId: input.providerInstanceId,
        providerTurnId: input.providerTurnId,
      }).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to build invocation scope.", cause),
        ),
      );
      const token = yield* crypto.randomBytes(32).pipe(
        Effect.map((bytes) => Buffer.from(bytes).toString("base64url")),
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to issue invocation credential.", cause),
        ),
      );
      const tokenHash = yield* hashToken(token).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to hash invocation credential.", cause),
        ),
      );
      const issuedAt = DateTime.formatIso(yield* DateTime.now);
      // New leases are turn-bound rather than wall-clock-bound. The nullable
      // column remains for decoding older persisted rows that had a TTL.
      const expiresAt = null;
      yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* sql`
            UPDATE task_invocation_leases
            SET status = 'revoked', revoked_at = ${issuedAt}, revocation_reason = 'superseded'
            WHERE thread_id = ${scope.threadId}
              AND owner_generation = ${ownerGeneration}
              AND status = 'active'
          `;
            const inserted = yield* sql<{ readonly tokenHash: string }>`
              INSERT INTO task_invocation_leases (
                token_hash, environment_id, task_id, occurrence, stage,
                thread_id, provider_instance_id, provider_turn_id, owner_generation, status,
                issued_at, expires_at, revoked_at, revocation_reason
              )
              SELECT
                ${tokenHash}, ${scope.environmentId}, ${scope.taskId}, ${scope.occurrence}, ${scope.stage},
                ${scope.threadId}, ${scope.providerInstanceId}, ${scope.providerTurnId}, ${ownerGeneration}, 'active',
                ${issuedAt}, ${expiresAt}, NULL, NULL
              WHERE EXISTS (
                SELECT 1 FROM task_invocation_lease_owner
                WHERE owner_id = 1 AND owner_generation = ${ownerGeneration}
              )
              RETURNING token_hash AS "tokenHash"
            `;
            if (inserted.length !== 1) {
              return yield* toError("stale_lease", "The invocation runtime is no longer active.");
            }
          }),
        )
        .pipe(Effect.mapError(preserveInvocationError("Failed to persist invocation credential.")));
      return { token, scope };
    },
  );

  const bind: TaskInvocationServiceShape["bind"] = Effect.fn("TaskInvocationService.bind")(
    function* (input) {
      const token = input.token.trim();
      if (token.length === 0) {
        return yield* toError("unauthorized", "An invocation credential is required.");
      }
      const tokenHash = yield* hashToken(token).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to hash invocation credential.", cause),
        ),
      );
      const row = yield* findLease({ tokenHash }).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to read invocation credential.", cause),
        ),
      );
      if (Option.isNone(row) || row.value.status !== "active") {
        return yield* toError("stale_lease", "The invocation credential is no longer active.");
      }
      if (
        row.value.threadId !== input.threadId ||
        row.value.providerInstanceId !== input.providerInstanceId
      ) {
        return yield* toError(
          "stale_lease",
          "The invocation credential is bound to another provider turn.",
        );
      }
      const bindingScope: TaskInvocationScopeValue = {
        environmentId: row.value.environmentId,
        taskId: row.value.taskId,
        occurrence: row.value.occurrence,
        stage: row.value.stage,
        threadId: row.value.threadId,
        providerInstanceId: row.value.providerInstanceId,
        providerTurnId: input.providerTurnId,
      };
      const binding = yield* currentBinding(bindingScope);
      if (!bindingHasTurn(binding, bindingScope)) {
        return yield* toError(
          "stale_lease",
          "The invocation credential cannot bind to an inactive provider turn.",
        );
      }
      const updated = yield* sql<{ readonly tokenHash: string }>`
        UPDATE task_invocation_leases
        SET provider_turn_id = ${input.providerTurnId}
        WHERE token_hash = ${tokenHash}
          AND thread_id = ${input.threadId}
          AND provider_instance_id = ${input.providerInstanceId}
          AND provider_turn_id = ${row.value.providerTurnId}
          AND owner_generation = ${ownerGeneration}
          AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM task_invocation_lease_owner
            WHERE owner_id = 1 AND owner_generation = ${ownerGeneration}
          )
        RETURNING token_hash AS "tokenHash"
      `.pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to bind invocation credential.", cause),
        ),
      );
      if (updated.length !== 1) {
        return yield* toError("stale_lease", "The invocation credential is no longer active.");
      }
    },
  );

  const resolve: TaskInvocationServiceShape["resolve"] = Effect.fn("TaskInvocationService.resolve")(
    function* (rawToken) {
      const token = rawToken.trim();
      if (token.length === 0) {
        return yield* toError("unauthorized", "An invocation credential is required.");
      }
      const tokenHash = yield* hashToken(token).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to hash invocation credential.", cause),
        ),
      );
      const rowOption = yield* findLease({ tokenHash }).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "Failed to read invocation credential.", cause),
        ),
      );
      if (Option.isNone(rowOption)) {
        return yield* toError("unauthorized", "The invocation credential is not valid.");
      }
      const row = rowOption.value;
      if (row.status !== "active") {
        const terminal =
          row.revocationReason === "terminal" ||
          row.revocationReason === "failed" ||
          row.revocationReason === "stopped";
        return yield* toError(
          terminal ? "terminal_lease" : "stale_lease",
          terminal
            ? "The provider turn for this invocation has terminated."
            : "The invocation credential has been revoked.",
        );
      }
      if (row.ownerGeneration !== ownerGeneration || !(yield* isCurrentOwner)) {
        return yield* toError(
          "stale_lease",
          "The invocation credential belongs to an inactive runtime.",
        );
      }
      if (row.expiresAt !== null) {
        const expiresAt = yield* Schema.decodeUnknownEffect(Schema.DateFromString)(
          row.expiresAt,
        ).pipe(
          Effect.mapError((cause) =>
            toError("internal_error", "The persisted invocation expiry is malformed.", cause),
          ),
        );
        const now = yield* DateTime.now;
        if (expiresAt.getTime() <= DateTime.toEpochMillis(now)) {
          yield* revokeToken(tokenHash, "orphan").pipe(Effect.ignore);
          return yield* toError("stale_lease", "The invocation credential has expired.");
        }
      }
      const scope = yield* decodeScope(row).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "The persisted invocation scope is malformed.", cause),
        ),
      );
      const active = yield* resolveActiveTaskInvocation(scope).pipe(
        Effect.tapError((error) =>
          error.code === "not_active" ? revokeToken(tokenHash).pipe(Effect.ignore) : Effect.void,
        ),
        Effect.mapError((cause) =>
          cause.code === "not_active"
            ? toError("stale_lease", "The invocation no longer matches an active Task turn.", cause)
            : cause,
        ),
      );
      if (
        active.taskId !== scope.taskId ||
        active.occurrence !== scope.occurrence ||
        active.stage !== scope.stage
      ) {
        yield* revokeToken(tokenHash).pipe(Effect.ignore);
        return yield* toError("stale_lease", "The invocation belongs to another Task occurrence.");
      }
      const binding = yield* currentBinding(scope);
      if (!bindingHasTurn(binding, scope)) {
        yield* revokeToken(tokenHash).pipe(Effect.ignore);
        const code =
          Option.isSome(binding) && binding.value.status !== "running"
            ? "terminal_lease"
            : "stale_lease";
        return yield* toError(
          code,
          "The invocation credential is bound to an inactive provider turn.",
        );
      }
      const lease = yield* decodeLease({
        tokenHash: row.tokenHash,
        scope,
        status: "active",
        issuedAt: row.issuedAt,
        expiresAt: row.expiresAt,
        revokedAt: row.revokedAt,
        revocationReason: row.revocationReason,
      }).pipe(
        Effect.mapError((cause) =>
          toError("internal_error", "The persisted invocation credential is malformed.", cause),
        ),
      );
      return { lease, scope, context: active.context };
    },
  );

  const revokeThread: TaskInvocationServiceShape["revokeThread"] = (threadId) =>
    Effect.gen(function* () {
      const revokedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        UPDATE task_invocation_leases
        SET status = 'revoked', revoked_at = ${revokedAt}, revocation_reason = 'stopped'
        WHERE thread_id = ${threadId}
          AND owner_generation = ${ownerGeneration}
          AND status = 'active'
      `;
    }).pipe(
      Effect.mapError((cause) =>
        toError("internal_error", "Failed to revoke invocation credential.", cause),
      ),
    );

  const revokeTurn: TaskInvocationServiceShape["revokeTurn"] = (input) =>
    Effect.gen(function* () {
      const revokedAt = DateTime.formatIso(yield* DateTime.now);
      yield* sql`
        UPDATE task_invocation_leases
        SET status = 'revoked', revoked_at = ${revokedAt}, revocation_reason = 'terminal'
        WHERE thread_id = ${input.threadId}
          AND provider_turn_id = ${input.providerTurnId}
          AND owner_generation = ${ownerGeneration}
          AND status = 'active'
      `;
    }).pipe(
      Effect.mapError((cause) =>
        toError("internal_error", "Failed to revoke invocation credential.", cause),
      ),
    );

  const reconcile: TaskInvocationServiceShape["reconcile"] = Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      UPDATE task_invocation_leases
      SET status = 'revoked', revoked_at = ${now}, revocation_reason = 'orphan'
      WHERE status = 'active'
        AND owner_generation = ${ownerGeneration}
        AND expires_at IS NOT NULL
        AND expires_at <= ${now}
        AND EXISTS (
          SELECT 1 FROM task_invocation_lease_owner
          WHERE owner_id = 1 AND owner_generation = ${ownerGeneration}
        )
    `;
    yield* reconcileStartupLeases;
  }).pipe(
    Effect.mapError(
      preserveInvocationError("Failed to reconcile Task CLI invocation credentials."),
    ),
  );

  const revokeAll: TaskInvocationServiceShape["revokeAll"] = Effect.gen(function* () {
    const revokedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      UPDATE task_invocation_leases
      SET status = 'revoked', revoked_at = ${revokedAt}, revocation_reason = 'manual'
      WHERE owner_generation = ${ownerGeneration}
        AND status = 'active'
    `;
  }).pipe(
    Effect.mapError((cause) =>
      toError("internal_error", "Failed to revoke invocation credentials.", cause),
    ),
  );

  return {
    issue,
    bind,
    resolve,
    revokeThread,
    revokeTurn,
    revokeAll,
    reconcile,
  } satisfies TaskInvocationServiceShape;
});

export const TaskInvocationServiceLive = Layer.effect(TaskInvocationService, make);
