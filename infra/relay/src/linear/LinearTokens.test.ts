import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayDb from "../db.ts";
import { relayLinearOAuthTokens } from "../persistence/schema.ts";
import * as LinearTokens from "./LinearTokens.ts";

const provider = (fakeDb: unknown) =>
  LinearTokens.layer.pipe(
    Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb as RelayDb.RelayDb["Service"])),
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

const whereSql = (condition: unknown) => new PgDialect().sqlToQuery(condition as never);

const fakeSelect = (rows: ReadonlyArray<unknown>, whereConditions: Array<unknown>) => ({
  select: () => ({
    from: (table: unknown) => {
      expect(table).toBe(relayLinearOAuthTokens);
      return {
        where: (condition: unknown) => {
          whereConditions.push(condition);
          return { limit: () => Effect.succeed(rows) };
        },
      };
    },
  }),
});

const fakeDelete = (rows: ReadonlyArray<unknown>, whereConditions: Array<unknown>) => ({
  delete: (table: unknown) => {
    expect(table).toBe(relayLinearOAuthTokens);
    return {
      where: (condition: unknown) => {
        whereConditions.push(condition);
        return { returning: () => Effect.succeed(rows) };
      },
    };
  },
});

describe("LinearTokens", () => {
  it.effect("upserts one bundle per environment and connection and records its owner", () => {
    const inserted: Array<Record<string, unknown>> = [];
    const conflicts: Array<Record<string, unknown>> = [];
    const fakeDb = {
      insert: (table: unknown) => {
        expect(table).toBe(relayLinearOAuthTokens);
        return {
          values: (values: Record<string, unknown>) => {
            inserted.push(values);
            return {
              onConflictDoUpdate: (config: Record<string, unknown>) => {
                conflicts.push(config);
                return Effect.succeed([]);
              },
            };
          },
        };
      },
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      yield* tokens.save(BUNDLE);

      expect(inserted[0]).toMatchObject(BUNDLE);
      expect(typeof inserted[0]?.createdAt).toBe("string");
      expect(inserted[0]?.updatedAt).toBe(inserted[0]?.createdAt);
      expect(conflicts[0]?.target).toEqual([
        relayLinearOAuthTokens.environmentId,
        relayLinearOAuthTokens.connectionId,
      ]);
      // A reauthorization by another linked user takes over the connection.
      expect(conflicts[0]?.set).toMatchObject({
        userId: BUNDLE.userId,
        accessToken: BUNDLE.accessToken,
        refreshToken: BUNDLE.refreshToken,
        expiresAt: BUNDLE.expiresAt,
        scope: BUNDLE.scope,
      });
      expect(conflicts[0]?.set).not.toHaveProperty("createdAt");
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("reads the bundle by its environment and connection key", () => {
    const whereConditions: Array<unknown> = [];

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const found = yield* tokens.get({ environmentId: "env-1", connectionId: "connection-1" });

      expect(found).toEqual(BUNDLE);
      const query = whereSql(whereConditions[0]);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."connection_id" = $2');
      expect(query.params).toEqual(["env-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fakeSelect([BUNDLE], whereConditions))));
  });

  it.effect("returns null when no bundle is stored for the connection", () =>
    Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      expect(yield* tokens.get({ environmentId: "env-1", connectionId: "missing" })).toBeNull();
    }).pipe(Effect.provide(provider(fakeSelect([], [])))),
  );

  it.effect("deletes a connection only for its owner and returns the bundle to revoke", () => {
    const whereConditions: Array<unknown> = [];

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const deleted = yield* tokens.delete({
        userId: "user-1",
        environmentId: "env-1",
        connectionId: "connection-1",
      });

      expect(deleted).toEqual(BUNDLE);
      const query = whereSql(whereConditions[0]);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."user_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $2');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."connection_id" = $3');
      expect(query.params).toEqual(["user-1", "env-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fakeDelete([BUNDLE], whereConditions))));
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
    }).pipe(Effect.provide(provider(fakeDelete([], [])))),
  );

  it.effect("deletes every bundle a user authorized for an environment", () => {
    const whereConditions: Array<unknown> = [];
    const rows = [BUNDLE, { ...BUNDLE, connectionId: "connection-2" }];

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const deleted = yield* tokens.deleteForEnvironment({
        userId: "user-1",
        environmentId: "env-1",
      });

      expect(deleted).toEqual(rows);
      const query = whereSql(whereConditions[0]);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."user_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $2');
      expect(query.params).toEqual(["user-1", "env-1"]);
    }).pipe(Effect.provide(provider(fakeDelete(rows, whereConditions))));
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
