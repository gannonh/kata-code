import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { and, eq } from "drizzle-orm";

import { RelayConfiguration } from "../Config.ts";
import * as RelayDb from "../db.ts";
import { relayLinearOAuthTokens } from "../persistence/schema.ts";
import * as WebCrypto from "../WebCrypto.ts";

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
  tokenCiphertext: relayLinearOAuthTokens.tokenCiphertext,
  tokenNonce: relayLinearOAuthTokens.tokenNonce,
  keyVersion: relayLinearOAuthTokens.keyVersion,
  expiresAt: relayLinearOAuthTokens.expiresAt,
  scope: relayLinearOAuthTokens.scope,
} as const;

type SealedTokenBundle = Pick<
  typeof relayLinearOAuthTokens.$inferSelect,
  keyof typeof tokenBundleColumns
>;

// Rows sealed under any other version read as missing grants. A key rotation
// adds a keyring keyed by this column.
const KEY_VERSION = 1;
const NONCE_BYTES = 12;

const TokenPair = Schema.fromJsonString(
  Schema.Struct({ accessToken: Schema.String, refreshToken: Schema.String }),
);
const encodeTokenPair = Schema.encodeEffect(TokenPair);
const decodeTokenPair = Schema.decodeUnknownEffect(TokenPair);

// Binds the ciphertext to its row, so a sealed bundle copied into another
// connection fails authentication.
const rowBinding = (row: { readonly environmentId: string; readonly connectionId: string }) =>
  new TextEncoder().encode(JSON.stringify([row.environmentId, row.connectionId]));

const decodeBase64 = (value: string) =>
  Effect.fromResult(Encoding.decodeBase64(value)).pipe(
    Effect.map((bytes) => Uint8Array.from(bytes)),
  );

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const crypto = yield* Crypto.Crypto;
  const { subtle } = yield* WebCrypto.WebCrypto;
  const { linearOAuth } = yield* RelayConfiguration;

  const key =
    linearOAuth === null
      ? null
      : yield* decodeBase64(Redacted.value(linearOAuth.tokenEncryptionKey)).pipe(
          Effect.flatMap((raw) =>
            Effect.promise(() =>
              subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]),
            ),
          ),
          Effect.orDie,
        );

  const seal = Effect.fnUntraced(function* (key: CryptoKey, input: LinearOAuthTokenRecord) {
    const nonce = Uint8Array.from(yield* crypto.randomBytes(NONCE_BYTES));
    const plaintext = yield* encodeTokenPair({
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    });
    const ciphertext = yield* Effect.tryPromise(() =>
      subtle.encrypt(
        { name: "AES-GCM", iv: nonce, additionalData: rowBinding(input) },
        key,
        new TextEncoder().encode(plaintext),
      ),
    );
    return {
      tokenCiphertext: Encoding.encodeBase64(new Uint8Array(ciphertext)),
      tokenNonce: Encoding.encodeBase64(nonce),
      keyVersion: KEY_VERSION,
    };
  });

  const unseal = (row: SealedTokenBundle): Effect.Effect<LinearOAuthTokenRecord | null> => {
    const { tokenCiphertext, tokenNonce, keyVersion } = row;
    const missingGrant = Effect.logWarning(
      "Treating an unreadable Linear OAuth token bundle as a missing grant",
      { environmentId: row.environmentId, connectionId: row.connectionId, keyVersion },
    ).pipe(Effect.as(null));
    if (key === null || keyVersion !== KEY_VERSION) {
      return missingGrant;
    }
    return Effect.gen(function* () {
      const nonce = yield* decodeBase64(tokenNonce);
      const ciphertext = yield* decodeBase64(tokenCiphertext);
      const plaintext = yield* Effect.tryPromise(() =>
        subtle.decrypt(
          { name: "AES-GCM", iv: nonce, additionalData: rowBinding(row) },
          key,
          ciphertext,
        ),
      );
      const tokens = yield* decodeTokenPair(new TextDecoder().decode(plaintext));
      return {
        userId: row.userId,
        environmentId: row.environmentId,
        connectionId: row.connectionId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: row.expiresAt,
        scope: row.scope,
      };
    }).pipe(Effect.catch(() => missingGrant));
  };

  return LinearTokens.of({
    save: Effect.fn("relay.linear_tokens.save")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      if (key === null) {
        return yield* new LinearTokenSavePersistenceError({
          cause: "Linear OAuth token encryption is not configured",
        });
      }
      const now = DateTime.formatIso(yield* DateTime.now);
      // Crypto failures carry no token material, so they are safe to retain as the cause.
      const sealed = yield* seal(key, input).pipe(
        Effect.mapError((cause) => new LinearTokenSavePersistenceError({ cause })),
      );
      const bundle = {
        userId: input.userId,
        ...sealed,
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
      return rows[0] === undefined ? null : yield* unseal(rows[0]);
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
      return rows[0] === undefined ? null : yield* unseal(rows[0]);
    }),

    deleteForEnvironment: Effect.fn("relay.linear_tokens.delete_for_environment")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
        const rows = yield* db
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
        const bundles = yield* Effect.forEach(rows, unseal);
        return bundles.filter((bundle) => bundle !== null);
      },
    ),
  });
});

export const layer = Layer.effect(LinearTokens, make);
