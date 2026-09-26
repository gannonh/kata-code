import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayConfiguration from "../Config.ts";
import * as RelayDb from "../db.ts";
import { relayLinearOAuthTokens } from "../persistence/schema.ts";
import * as WebCrypto from "../WebCrypto.ts";
import * as LinearTokens from "./LinearTokens.ts";

const TOKEN_ENCRYPTION_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

const relaySettings = (
  linearOAuth: RelayConfiguration.LinearOAuthConfiguration | null,
): RelayConfiguration.RelayConfiguration["Service"] => ({
  relayIssuer: "https://relay.example.test",
  apns: null,
  clerkSecretKey: Redacted.make("clerk-secret-key"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "kata-code-relay",
  apnsDeliveryJobSigningSecret: Redacted.make("apns-delivery-secret"),
  cloudMintPrivateKey: Redacted.make("cloud-mint-private-key"),
  cloudMintPublicKey: "cloud-mint-public-key",
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
  linearOAuth,
});

const CONFIGURED_LINEAR_OAUTH = {
  clientId: "linear-client-id",
  clientSecret: Redacted.make("linear-client-secret"),
  tokenEncryptionKey: Redacted.make(TOKEN_ENCRYPTION_KEY),
};

const provider = (
  fakeDb: unknown,
  linearOAuth: RelayConfiguration.LinearOAuthConfiguration | null = CONFIGURED_LINEAR_OAUTH,
) =>
  LinearTokens.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RelayDb.RelayDb, fakeDb as RelayDb.RelayDb["Service"]),
        RelayConfiguration.layer(relaySettings(linearOAuth)),
        Layer.succeed(WebCrypto.WebCrypto, { subtle: globalThis.crypto.subtle }),
        NodeCrypto.layer,
      ),
    ),
  );

const BUNDLE = {
  userId: "user-1",
  environmentId: "env-1",
  connectionId: "connection-1",
  accessToken: "linear-access-token",
  refreshToken: "linear-refresh-token",
  expiresAt: 1_790_000_000_000,
  scope: "read,admin",
} as const;

type Row = Record<string, unknown>;

const serialize = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const whereSql = (condition: unknown) => new PgDialect().sqlToQuery(condition as never);

const project = (row: Row, columns: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(columns).map((column) => [column, row[column]]));

/**
 * Stores inserted rows and serves every stored row back from select and
 * delete, projected to the requested columns. Where conditions are recorded,
 * not evaluated.
 */
const makeFakeDb = () => {
  const rows: Array<Row> = [];
  const inserted: Array<Row> = [];
  const conflicts: Array<{ readonly target: unknown; readonly set: Row }> = [];
  const whereConditions: Array<unknown> = [];
  const db = {
    insert: (table: unknown) => {
      expect(table).toBe(relayLinearOAuthTokens);
      return {
        values: (values: Row) => ({
          onConflictDoUpdate: (config: { readonly target: unknown; readonly set: Row }) => {
            inserted.push(values);
            conflicts.push(config);
            rows.push(values);
            return Effect.succeed([]);
          },
        }),
      };
    },
    select: (columns: Record<string, unknown>) => ({
      from: (table: unknown) => {
        expect(table).toBe(relayLinearOAuthTokens);
        return {
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return {
              limit: () => Effect.sync(() => rows.map((row) => project(row, columns))),
            };
          },
        };
      },
    }),
    delete: (table: unknown) => {
      expect(table).toBe(relayLinearOAuthTokens);
      return {
        where: (condition: unknown) => {
          whereConditions.push(condition);
          return {
            returning: (columns: Record<string, unknown>) =>
              Effect.sync(() => rows.map((row) => project(row, columns))),
          };
        },
      };
    },
  };
  return { db, rows, inserted, conflicts, whereConditions };
};

const saveBundle = (bundle: LinearTokens.LinearOAuthTokenRecord) =>
  LinearTokens.LinearTokens.pipe(Effect.flatMap((tokens) => tokens.save(bundle)));

const flipFirstCiphertextByte = (row: Row): Row => {
  const bytes = Buffer.from(String(row.tokenCiphertext), "base64");
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  return { ...row, tokenCiphertext: bytes.toString("base64") };
};

describe("LinearTokens", () => {
  it.effect("returns exactly the saved bundle from get", () => {
    const fake = makeFakeDb();

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      yield* tokens.save(BUNDLE);

      expect(yield* tokens.get({ environmentId: "env-1", connectionId: "connection-1" })).toEqual(
        BUNDLE,
      );
    }).pipe(Effect.provide(provider(fake.db)));
  });

  it.effect("persists the tokens only as ciphertext under key version 1", () => {
    const fake = makeFakeDb();

    return Effect.gen(function* () {
      yield* saveBundle(BUNDLE);

      const inserted = fake.inserted[0];
      const conflict = fake.conflicts[0];
      for (const persisted of [inserted, conflict?.set]) {
        const serialized = serialize(persisted);
        expect(serialized).not.toContain("linear-access-token");
        expect(serialized).not.toContain("linear-refresh-token");
        expect(persisted).not.toHaveProperty("accessToken");
        expect(persisted).not.toHaveProperty("refreshToken");
        expect(persisted?.keyVersion).toBe(1);
        expect(String(persisted?.tokenNonce)).toHaveLength(16);
        expect(Buffer.from(String(persisted?.tokenNonce), "base64")).toHaveLength(12);
      }
      expect(inserted).toMatchObject({
        userId: "user-1",
        environmentId: "env-1",
        connectionId: "connection-1",
        expiresAt: 1_790_000_000_000,
        scope: "read,admin",
      });
      expect(typeof inserted?.createdAt).toBe("string");
      expect(inserted?.updatedAt).toBe(inserted?.createdAt);
      expect(conflict?.target).toEqual([
        relayLinearOAuthTokens.environmentId,
        relayLinearOAuthTokens.connectionId,
      ]);
      // A reauthorization by another linked user takes over the connection.
      expect(conflict?.set).toMatchObject({
        userId: "user-1",
        tokenCiphertext: inserted?.tokenCiphertext,
        tokenNonce: inserted?.tokenNonce,
        expiresAt: 1_790_000_000_000,
        scope: "read,admin",
      });
      expect(conflict?.set).not.toHaveProperty("createdAt");
    }).pipe(Effect.provide(provider(fake.db)));
  });

  it.effect("seals each save of the same bundle under a fresh nonce", () => {
    const fake = makeFakeDb();

    return Effect.gen(function* () {
      yield* saveBundle(BUNDLE);
      yield* saveBundle(BUNDLE);

      const [first, second] = fake.inserted;
      expect(first?.tokenNonce).not.toBe(second?.tokenNonce);
      expect(first?.tokenCiphertext).not.toBe(second?.tokenCiphertext);
    }).pipe(Effect.provide(provider(fake.db)));
  });

  it.effect.each([
    { name: "a tampered ciphertext", corrupt: flipFirstCiphertextByte },
    {
      name: "a bundle moved to another connection",
      corrupt: (row: Row): Row => ({ ...row, connectionId: "connection-2" }),
    },
    { name: "an unknown key version", corrupt: (row: Row): Row => ({ ...row, keyVersion: 2 }) },
  ])("treats $name as a missing grant and logs no token material", ({ corrupt }) => {
    const fake = makeFakeDb();
    const logs: Array<unknown> = [];
    const logger = Logger.make(({ message }) => {
      logs.push(message);
    });

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      yield* tokens.save(BUNDLE);
      const corrupted = corrupt(fake.rows[0] ?? {});
      fake.rows[0] = corrupted;

      expect(
        yield* tokens.get({
          environmentId: "env-1",
          connectionId: String(corrupted.connectionId),
        }),
      ).toBeNull();

      yield* tokens.save({ ...BUNDLE, connectionId: "connection-3" });
      expect(
        yield* tokens.deleteForEnvironment({ userId: "user-1", environmentId: "env-1" }),
      ).toEqual([{ ...BUNDLE, connectionId: "connection-3" }]);

      const warning = [
        "Treating an unreadable Linear OAuth token bundle as a missing grant",
        {
          environmentId: "env-1",
          connectionId: corrupted.connectionId,
          keyVersion: corrupted.keyVersion,
        },
      ];
      expect(logs).toEqual([warning, warning]);
      expect(serialize(logs)).not.toContain("linear-access-token");
      expect(serialize(logs)).not.toContain(String(corrupted.tokenCiphertext));
    }).pipe(
      Effect.provide(
        Layer.merge(provider(fake.db), Logger.layer([logger], { mergeWithExisting: false })),
      ),
    );
  });

  it.effect("refuses to save and reads no grants without a token encryption key", () => {
    const fake = makeFakeDb();

    return Effect.gen(function* () {
      yield* saveBundle(BUNDLE).pipe(Effect.provide(provider(fake.db)));

      const tokens = yield* LinearTokens.LinearTokens.pipe(Effect.provide(provider(fake.db, null)));
      const error = yield* Effect.flip(tokens.save(BUNDLE));
      expect(error._tag).toBe("LinearTokenSavePersistenceError");
      expect(fake.inserted).toHaveLength(1);
      expect(
        yield* tokens.get({ environmentId: "env-1", connectionId: "connection-1" }),
      ).toBeNull();
    });
  });

  it.effect("reads the bundle by its environment and connection key", () => {
    const fake = makeFakeDb();

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      yield* tokens.save(BUNDLE);
      const found = yield* tokens.get({ environmentId: "env-1", connectionId: "connection-1" });

      expect(found).toEqual(BUNDLE);
      const query = whereSql(fake.whereConditions[0]);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."connection_id" = $2');
      expect(query.params).toEqual(["env-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fake.db)));
  });

  it.effect("returns null when no bundle is stored for the connection", () =>
    Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      expect(yield* tokens.get({ environmentId: "env-1", connectionId: "missing" })).toBeNull();
    }).pipe(Effect.provide(provider(makeFakeDb().db))),
  );

  it.effect("deletes a connection only for its owner and returns the bundle to revoke", () => {
    const fake = makeFakeDb();

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      yield* tokens.save(BUNDLE);
      const deleted = yield* tokens.delete({
        userId: "user-1",
        environmentId: "env-1",
        connectionId: "connection-1",
      });

      expect(deleted).toEqual(BUNDLE);
      const query = whereSql(fake.whereConditions[0]);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."user_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $2');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."connection_id" = $3');
      expect(query.params).toEqual(["user-1", "env-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fake.db)));
  });

  it.effect("returns null when the delete matched no bundle", () =>
    Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      expect(
        yield* tokens.delete({
          userId: "user-other",
          environmentId: "env-1",
          connectionId: "connection-1",
        }),
      ).toBeNull();
    }).pipe(Effect.provide(provider(makeFakeDb().db))),
  );

  it.effect("deletes every bundle a user authorized for an environment", () => {
    const fake = makeFakeDb();
    const second = { ...BUNDLE, connectionId: "connection-2" };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      yield* tokens.save(BUNDLE);
      yield* tokens.save(second);
      const deleted = yield* tokens.deleteForEnvironment({
        userId: "user-1",
        environmentId: "env-1",
      });

      expect(deleted).toEqual([BUNDLE, second]);
      const query = whereSql(fake.whereConditions[0]);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."user_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $2');
      expect(query.params).toEqual(["user-1", "env-1"]);
    }).pipe(Effect.provide(provider(fake.db)));
  });

  it.effect("retains persistence failures without retaining token material", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => Effect.fail(cause),
        }),
      }),
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const error = yield* Effect.flip(tokens.save(BUNDLE));

      expect(error).toMatchObject({ _tag: "LinearTokenSavePersistenceError" });
      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain(BUNDLE.accessToken);
      expect(error.message).not.toContain(BUNDLE.refreshToken);
      expect(error).not.toHaveProperty("accessToken");
      expect(error).not.toHaveProperty("refreshToken");
    }).pipe(Effect.provide(provider(fakeDb)));
  });
});
