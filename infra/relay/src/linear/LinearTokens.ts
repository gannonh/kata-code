import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, eq } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayLinearOAuthTokens } from "../persistence/schema.ts";

export interface LinearOAuthTokenRecord {
  readonly userId: string;
  readonly environmentId: string;
  readonly connectionId: string;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope: string;
}

export class LinearTokenSavePersistenceError extends Schema.TaggedError<LinearTokenSavePersistenceError>()(
  "LinearTokenSavePersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to persist a Linear OAuth token bundle";
  }
}

export class LinearTokenLookupPersistenceError extends Schema.TaggedError<LinearTokenLookupPersistenceError>()(
  "LinearTokenLookupPersistenceError",
  {
    environmentId: Schema.String,
    connectionId: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to look up the Linear OAuth token bundle for connection '${this.connectionId}'`;
  }
}

export class LinearTokenDeletePersistenceError extends Schema.TaggedError<LinearTokenDeletePersistenceError>()(
  "LinearTokenDeletePersistenceError",
  {
    operation: Schema.Literals(["connection", "environment"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to delete Linear OAuth token bundles by ${this.operation}`;
  }
}

/**
 * One bundle per (environment, connection). `userId` records the cloud user
 * who authorized it; deletes are scoped to that owner and return the removed
 * bundles so the caller can revoke them at Linear.
 */
export class LinearTokens extends Context.Service<
  LinearTokens,
  {
    readonly save: (
      input: LinearOAuthTokenRecord,
    ) => Effect.Effect<void, LinearTokenSavePersistenceError>;
    readonly get: (input: {
      readonly environmentId: string;
      readonly connectionId: string;
    }) => Effect.Effect<LinearOAuthTokenRecord | null, LinearTokenLookupPersistenceError>;
    readonly delete: (input: {
      readonly userId: string;
      readonly environmentId: string;
      readonly connectionId: string;
    }) => Effect.Effect<LinearOAuthTokenRecord | null, LinearTokenDeletePersistenceError>;
    readonly deleteForEnvironment: (input: {
      readonly userId: string;
      readonly environmentId: string;
    }) => Effect.Effect<ReadonlyArray<LinearOAuthTokenRecord>, LinearTokenDeletePersistenceError>;
  }
>()("kata-code-relay/linear/LinearTokens") {}

const tokenBundleColumns = {
  userId: relayLinearOAuthTokens.userId,
  environmentId: relayLinearOAuthTokens.environmentId,
  connectionId: relayLinearOAuthTokens.connectionId,
  accessToken: relayLinearOAuthTokens.accessToken,
  refreshToken: relayLinearOAuthTokens.refreshToken,
  expiresAt: relayLinearOAuthTokens.expiresAt,
  scope: relayLinearOAuthTokens.scope,
} as const;

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;

  return LinearTokens.of({
    save: Effect.fn("relay.linear_tokens.save")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      const now = DateTime.formatIso(yield* DateTime.now);
      const bundle = {
        userId: input.userId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
        scope: input.scope,
        updatedAt: now,
      };
      yield* db
        .insert(relayLinearOAuthTokens)
        .values({
          ...bundle,
          environmentId: input.environmentId,
          connectionId: input.connectionId,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [relayLinearOAuthTokens.environmentId, relayLinearOAuthTokens.connectionId],
          set: bundle,
        })
        .pipe(Effect.mapError((cause) => new LinearTokenSavePersistenceError({ cause })));
    }),

    get: Effect.fn("relay.linear_tokens.get")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      const rows = yield* db
        .select(tokenBundleColumns)
        .from(relayLinearOAuthTokens)
        .where(
          and(
            eq(relayLinearOAuthTokens.environmentId, input.environmentId),
            eq(relayLinearOAuthTokens.connectionId, input.connectionId),
          ),
        )
        .limit(1)
        .pipe(
          Effect.mapError(
            (cause) =>
              new LinearTokenLookupPersistenceError({
                environmentId: input.environmentId,
                connectionId: input.connectionId,
                cause,
              }),
          ),
        );
      return rows[0] ?? null;
    }),

    delete: Effect.fn("relay.linear_tokens.delete")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      const rows = yield* db
        .delete(relayLinearOAuthTokens)
        .where(
          and(
            eq(relayLinearOAuthTokens.userId, input.userId),
            eq(relayLinearOAuthTokens.environmentId, input.environmentId),
            eq(relayLinearOAuthTokens.connectionId, input.connectionId),
          ),
        )
        .returning(tokenBundleColumns)
        .pipe(
          Effect.mapError(
            (cause) => new LinearTokenDeletePersistenceError({ operation: "connection", cause }),
          ),
        );
      return rows[0] ?? null;
    }),

    deleteForEnvironment: Effect.fn("relay.linear_tokens.delete_for_environment")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
        return yield* db
          .delete(relayLinearOAuthTokens)
          .where(
            and(
              eq(relayLinearOAuthTokens.userId, input.userId),
              eq(relayLinearOAuthTokens.environmentId, input.environmentId),
            ),
          )
          .returning(tokenBundleColumns)
          .pipe(
            Effect.mapError(
              (cause) => new LinearTokenDeletePersistenceError({ operation: "environment", cause }),
            ),
          );
      },
    ),
  });
});

export const layer = Layer.effect(LinearTokens, make);
