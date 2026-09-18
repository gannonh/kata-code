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

describe("LinearTokens", () => {
  it.effect("upserts a token bundle keyed by user, environment, and connection", () => {
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

      expect(inserted).toHaveLength(1);
      const values = inserted[0]!;
      expect(values.accessToken).toBe(BUNDLE.accessToken);
      expect(values.refreshToken).toBe(BUNDLE.refreshToken);
      expect(values.expiresAt).toBe(BUNDLE.expiresAt);
      expect(values.scope).toBe(BUNDLE.scope);
      expect(typeof values.createdAt).toBe("string");
      expect(values.updatedAt).toBe(values.createdAt);

      expect(conflicts).toHaveLength(1);
      const conflict = conflicts[0]!;
      expect(conflict.target).toEqual([
        relayLinearOAuthTokens.userId,
        relayLinearOAuthTokens.environmentId,
        relayLinearOAuthTokens.connectionId,
      ]);
      expect(conflict.set).toMatchObject({
        accessToken: BUNDLE.accessToken,
        refreshToken: BUNDLE.refreshToken,
        expiresAt: BUNDLE.expiresAt,
        scope: BUNDLE.scope,
      });
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("returns the stored bundle for the exact user, environment, and connection", () => {
    const whereConditions: Array<unknown> = [];
    const row = { ...BUNDLE, updatedAt: "2026-09-18T12:00:00.000Z" };
    const fakeDb = {
      select: () => ({
        from: (table: unknown) => {
          expect(table).toBe(relayLinearOAuthTokens);
          return {
            where: (condition: unknown) => {
              whereConditions.push(condition);
              return {
                limit: () => Effect.succeed([row]),
              };
            },
          };
        },
      }),
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const found = yield* tokens.get({
        userId: "user-1",
        environmentId: "env-1",
        connectionId: "connection-1",
      });

      expect(found).toEqual(row);
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."user_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $2');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."connection_id" = $3');
      expect(query.params).toEqual(["user-1", "env-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("returns null when no bundle is stored for the connection", () => {
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Effect.succeed([]),
          }),
        }),
      }),
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      expect(
        yield* tokens.get({
          userId: "user-1",
          environmentId: "env-1",
          connectionId: "connection-1",
        }),
      ).toBeNull();
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("returns the stored bundle for the exact environment and connection", () => {
    const whereConditions: Array<unknown> = [];
    const row = { ...BUNDLE, updatedAt: "2026-09-18T12:00:00.000Z" };
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return {
              limit: () => Effect.succeed([row]),
            };
          },
        }),
      }),
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const found = yield* tokens.getForEnvironment({
        environmentId: "env-1",
        connectionId: "connection-1",
      });

      expect(found).toEqual(row);
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."connection_id" = $2');
      expect(query.sql).not.toContain('"relay_linear_oauth_tokens"."user_id"');
      expect(query.params).toEqual(["env-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("returns null when no bundle is stored for the environment and connection", () => {
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Effect.succeed([]),
          }),
        }),
      }),
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      expect(
        yield* tokens.getForEnvironment({
          environmentId: "env-1",
          connectionId: "connection-1",
        }),
      ).toBeNull();
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("deletes every bundle for a user's connection", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayLinearOAuthTokens);
        return {
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return {
              returning: () => Effect.succeed([{ connectionId: "connection-1" }]),
            };
          },
        };
      },
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const deleted = yield* tokens.deleteForUserConnection({
        userId: "user-1",
        connectionId: "connection-1",
      });

      expect(deleted).toBe(true);
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.params).toEqual(["user-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("deletes only one connection's bundle", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayLinearOAuthTokens);
        return {
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return {
              returning: () => Effect.succeed([{ connectionId: "connection-1" }]),
            };
          },
        };
      },
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const deleted = yield* tokens.delete({
        userId: "user-1",
        environmentId: "env-1",
        connectionId: "connection-1",
      });

      expect(deleted).toBe(true);
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.params).toEqual(["user-1", "env-1", "connection-1"]);
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("deletes every bundle for an environment", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayLinearOAuthTokens);
        return {
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return {
              returning: () =>
                Effect.succeed([
                  { connectionId: "connection-1" },
                  { connectionId: "connection-2" },
                ]),
            };
          },
        };
      },
    };

    return Effect.gen(function* () {
      const tokens = yield* LinearTokens.LinearTokens;
      const deleted = yield* tokens.deleteForEnvironment({ environmentId: "env-1" });

      expect(deleted).toBe(2);
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_linear_oauth_tokens"."environment_id" = $1');
      expect(query.params).toEqual(["env-1"]);
    }).pipe(Effect.provide(provider(fakeDb)));
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
