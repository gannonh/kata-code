import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, eq, isNull, lt } from "drizzle-orm";

import * as RelayDb from "../db.ts";
import { relayLinearOAuthStates } from "../persistence/schema.ts";

export const LINEAR_OAUTH_STATE_TTL_MILLIS = 10 * 60 * 1_000;

export interface LinearOAuthStateBinding {
  readonly userId: string;
  readonly environmentId: string;
  readonly connectionId: string;
  readonly codeVerifier: string;
}

export class LinearOAuthStateRejected extends Schema.TaggedError<LinearOAuthStateRejected>()(
  "LinearOAuthStateRejected",
  {
    reason: Schema.Literals(["unknown", "expired", "already_consumed", "superseded"]),
  },
) {
  override get message(): string {
    return `Linear OAuth authorization state was rejected as ${this.reason}`;
  }
}

export class LinearOAuthStateCreatePersistenceError extends Schema.TaggedError<LinearOAuthStateCreatePersistenceError>()(
  "LinearOAuthStateCreatePersistenceError",
  {
    stage: Schema.Literals(["generate-state", "hash-state", "invalidate-state", "insert-state"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to create a Linear OAuth authorization state during '${this.stage}'`;
  }
}

export class LinearOAuthStateConsumePersistenceError extends Schema.TaggedError<LinearOAuthStateConsumePersistenceError>()(
  "LinearOAuthStateConsumePersistenceError",
  {
    stage: Schema.Literals(["hash-state", "consume-state", "lookup-state", "claim-state"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to consume a Linear OAuth authorization state during '${this.stage}'`;
  }
}

export class LinearOAuthStatePrunePersistenceError extends Schema.TaggedError<LinearOAuthStatePrunePersistenceError>()(
  "LinearOAuthStatePrunePersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to prune expired Linear OAuth authorization states";
  }
}

export class LinearOAuthStates extends Context.Service<
  LinearOAuthStates,
  {
    readonly create: (input: {
      readonly userId: string;
      readonly environmentId: string;
      readonly connectionId: string;
      readonly codeVerifier: string;
      readonly now: DateTime.DateTime;
    }) => Effect.Effect<{ readonly state: string }, LinearOAuthStateCreatePersistenceError>;
    readonly consume: (input: {
      readonly state: string;
      readonly now: DateTime.DateTime;
    }) => Effect.Effect<
      LinearOAuthStateBinding,
      LinearOAuthStateRejected | LinearOAuthStateConsumePersistenceError
    >;
    /**
     * Deletes the consumed row so a later begin cannot race this callback.
     * Returns false when a newer authorization already superseded it.
     */
    readonly claim: (input: {
      readonly state: string;
    }) => Effect.Effect<boolean, LinearOAuthStateConsumePersistenceError>;
    /** Removes expired rows, consumed or not, so no PKCE verifier outlives its state. */
    readonly pruneExpired: Effect.Effect<void, LinearOAuthStatePrunePersistenceError>;
  }
>()("kata-code-relay/linear/LinearOAuthStates") {}

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const crypto = yield* Crypto.Crypto;

  const hashState = (state: string) =>
    crypto.digest("SHA-256", new TextEncoder().encode(state)).pipe(Effect.map(Encoding.encodeHex));

  return LinearOAuthStates.of({
    create: Effect.fn("relay.linear_oauth_states.create")(function* (input) {
      const state = yield* crypto.randomBytes(32).pipe(
        Effect.map(Encoding.encodeBase64Url),
        Effect.mapError(
          (cause) => new LinearOAuthStateCreatePersistenceError({ stage: "generate-state", cause }),
        ),
      );
      const stateHash = yield* hashState(state).pipe(
        Effect.mapError(
          (cause) => new LinearOAuthStateCreatePersistenceError({ stage: "hash-state", cause }),
        ),
      );
      const now = DateTime.formatIso(input.now);
      // Drop every prior state for this connection, including consumed rows
      // whose callbacks are still exchanging. complete() claims its row
      // before saving, so a superseded callback aborts instead of overwriting.
      yield* db
        .delete(relayLinearOAuthStates)
        .where(
          and(
            eq(relayLinearOAuthStates.environmentId, input.environmentId),
            eq(relayLinearOAuthStates.connectionId, input.connectionId),
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new LinearOAuthStateCreatePersistenceError({ stage: "invalidate-state", cause }),
          ),
        );
      yield* db
        .insert(relayLinearOAuthStates)
        .values({
          stateHash,
          userId: input.userId,
          environmentId: input.environmentId,
          connectionId: input.connectionId,
          codeVerifier: input.codeVerifier,
          expiresAt: input.now.epochMilliseconds + LINEAR_OAUTH_STATE_TTL_MILLIS,
          consumedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .pipe(
          Effect.mapError(
            (cause) => new LinearOAuthStateCreatePersistenceError({ stage: "insert-state", cause }),
          ),
        );
      return { state };
    }),

    consume: Effect.fn("relay.linear_oauth_states.consume")(function* (input) {
      const stateHash = yield* hashState(input.state).pipe(
        Effect.mapError(
          (cause) => new LinearOAuthStateConsumePersistenceError({ stage: "hash-state", cause }),
        ),
      );
      const now = DateTime.formatIso(input.now);
      const rows = yield* db
        .update(relayLinearOAuthStates)
        .set({ consumedAt: now, updatedAt: now })
        .where(
          and(
            eq(relayLinearOAuthStates.stateHash, stateHash),
            isNull(relayLinearOAuthStates.consumedAt),
          ),
        )
        .returning({
          userId: relayLinearOAuthStates.userId,
          environmentId: relayLinearOAuthStates.environmentId,
          connectionId: relayLinearOAuthStates.connectionId,
          codeVerifier: relayLinearOAuthStates.codeVerifier,
          expiresAt: relayLinearOAuthStates.expiresAt,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new LinearOAuthStateConsumePersistenceError({ stage: "consume-state", cause }),
          ),
        );
      const row = rows[0];
      if (row) {
        if (row.expiresAt <= input.now.epochMilliseconds) {
          return yield* new LinearOAuthStateRejected({ reason: "expired" });
        }
        return {
          userId: row.userId,
          environmentId: row.environmentId,
          connectionId: row.connectionId,
          codeVerifier: row.codeVerifier,
        };
      }
      const consumed = yield* db
        .select({ consumedAt: relayLinearOAuthStates.consumedAt })
        .from(relayLinearOAuthStates)
        .where(eq(relayLinearOAuthStates.stateHash, stateHash))
        .limit(1)
        .pipe(
          Effect.mapError(
            (cause) =>
              new LinearOAuthStateConsumePersistenceError({ stage: "lookup-state", cause }),
          ),
        );
      return yield* new LinearOAuthStateRejected({
        reason: consumed.length > 0 ? "already_consumed" : "unknown",
      });
    }),

    claim: Effect.fn("relay.linear_oauth_states.claim")(function* (input) {
      const stateHash = yield* hashState(input.state).pipe(
        Effect.mapError(
          (cause) => new LinearOAuthStateConsumePersistenceError({ stage: "hash-state", cause }),
        ),
      );
      const rows = yield* db
        .delete(relayLinearOAuthStates)
        .where(eq(relayLinearOAuthStates.stateHash, stateHash))
        .returning({ stateHash: relayLinearOAuthStates.stateHash })
        .pipe(
          Effect.mapError(
            (cause) => new LinearOAuthStateConsumePersistenceError({ stage: "claim-state", cause }),
          ),
        );
      return rows.length > 0;
    }),

    pruneExpired: Effect.gen(function* () {
      const now = yield* DateTime.now;
      yield* db
        .delete(relayLinearOAuthStates)
        .where(lt(relayLinearOAuthStates.expiresAt, now.epochMilliseconds))
        .pipe(Effect.mapError((cause) => new LinearOAuthStatePrunePersistenceError({ cause })));
    }).pipe(Effect.withSpan("relay.linear_oauth_states.prune_expired")),
  });
});

export const layer = Layer.effect(LinearOAuthStates, make);
