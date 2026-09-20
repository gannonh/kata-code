// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayDb from "../db.ts";
import { relayLinearOAuthStates } from "../persistence/schema.ts";
import * as LinearOAuthStates from "./LinearOAuthStates.ts";

const NOW = DateTime.makeUnsafe(Date.UTC(2026, 8, 18, 12, 0, 0));

const sha256Hex = (value: string) => NodeCrypto.createHash("sha256").update(value).digest("hex");

const provider = (fakeDb: unknown) =>
  LinearOAuthStates.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCryptoLayer.layer,
        Layer.succeed(RelayDb.RelayDb, fakeDb as RelayDb.RelayDb["Service"]),
      ),
    ),
  );

const consumeDb = (input: {
  readonly update: () => Effect.Effect<ReadonlyArray<unknown>, Error>;
  readonly select: () => Effect.Effect<ReadonlyArray<unknown>, Error>;
}) => ({
  update: (table: unknown) => {
    expect(table).toBe(relayLinearOAuthStates);
    return {
      set: () => ({
        where: () => ({
          returning: () => input.update(),
        }),
      }),
    };
  },
  select: () => ({
    from: (table: unknown) => {
      expect(table).toBe(relayLinearOAuthStates);
      return {
        where: () => ({
          limit: () => input.select(),
        }),
      };
    },
  }),
});

describe("LinearOAuthStates", () => {
  it.effect(
    "stores a hashed single-use state bound to the user, environment, connection, and verifier",
    () => {
      const inserted: Array<Record<string, unknown>> = [];
      const invalidated: Array<unknown> = [];
      const operations: string[] = [];
      const fakeDb = {
        delete: (table: unknown) => {
          expect(table).toBe(relayLinearOAuthStates);
          return {
            where: (condition: unknown) => {
              operations.push("invalidate");
              invalidated.push(condition);
              return Effect.succeed([]);
            },
          };
        },
        insert: (table: unknown) => {
          expect(table).toBe(relayLinearOAuthStates);
          return {
            values: (values: Record<string, unknown>) => {
              operations.push("insert");
              inserted.push(values);
              return Effect.succeed([]);
            },
          };
        },
      };

      return Effect.gen(function* () {
        const states = yield* LinearOAuthStates.LinearOAuthStates;
        const created = yield* states.create({
          userId: "user-1",
          environmentId: "env-1",
          connectionId: "connection-1",
          codeVerifier: "code-verifier",
          now: NOW,
        });

        expect(created.state).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(Buffer.from(created.state, "base64url")).toHaveLength(32);

        expect(inserted).toHaveLength(1);
        const values = inserted[0]!;
        expect(values.stateHash).toBe(sha256Hex(created.state));
        expect(values.stateHash).not.toBe(created.state);
        expect(values.userId).toBe("user-1");
        expect(values.environmentId).toBe("env-1");
        expect(values.connectionId).toBe("connection-1");
        expect(values.codeVerifier).toBe("code-verifier");
        expect(values.expiresAt).toBe(NOW.epochMilliseconds + 10 * 60 * 1_000);
        expect(values.consumedAt).toBeNull();
        expect(values.createdAt).toBe("2026-09-18T12:00:00.000Z");
        expect(values.updatedAt).toBe("2026-09-18T12:00:00.000Z");
        expect(operations).toEqual(["invalidate", "insert"]);
        const query = new PgDialect().sqlToQuery(invalidated[0] as never);
        expect(query.sql).toContain('"relay_linear_oauth_states"."environment_id" = $1');
        expect(query.sql).toContain('"relay_linear_oauth_states"."connection_id" = $2');
        expect(query.sql).not.toContain("consumed_at");
        expect(query.params).toEqual(["env-1", "connection-1"]);
      }).pipe(Effect.provide(provider(fakeDb)));
    },
  );

  it.effect("atomically consumes a live state and returns its binding", () => {
    const state = "state-token";
    const consumedAt: Array<Record<string, unknown>> = [];
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayLinearOAuthStates);
        return {
          set: (values: Record<string, unknown>) => {
            consumedAt.push(values);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return {
                  returning: () =>
                    Effect.succeed([
                      {
                        userId: "user-1",
                        environmentId: "env-1",
                        connectionId: "connection-1",
                        codeVerifier: "code-verifier",
                        expiresAt: NOW.epochMilliseconds + 60_000,
                      },
                    ]),
                };
              },
            };
          },
        };
      },
    };

    return Effect.gen(function* () {
      const states = yield* LinearOAuthStates.LinearOAuthStates;
      const binding = yield* states.consume({ state, now: NOW });

      expect(binding).toEqual({
        userId: "user-1",
        environmentId: "env-1",
        connectionId: "connection-1",
        codeVerifier: "code-verifier",
      });
      expect(consumedAt[0]?.consumedAt).toBe("2026-09-18T12:00:00.000Z");
      expect(consumedAt[0]?.updatedAt).toBe("2026-09-18T12:00:00.000Z");

      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_linear_oauth_states"."state_hash" = $1');
      expect(query.sql).toContain('"relay_linear_oauth_states"."consumed_at" is null');
      expect(query.params).toEqual([sha256Hex(state)]);
      expect(state).not.toBe(sha256Hex(state));
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("rejects an expired state without returning its binding", () => {
    const fakeDb = consumeDb({
      update: () =>
        Effect.succeed([
          {
            userId: "user-1",
            environmentId: "env-1",
            connectionId: "connection-1",
            codeVerifier: "code-verifier",
            expiresAt: NOW.epochMilliseconds - 1,
          },
        ]),
      select: () => Effect.succeed([]),
    });

    return Effect.gen(function* () {
      const states = yield* LinearOAuthStates.LinearOAuthStates;
      const error = yield* Effect.flip(states.consume({ state: "expired-state", now: NOW }));

      expect(error._tag).toBe("LinearOAuthStateRejected");
      expect(error).toMatchObject({ reason: "expired" });
      expect(error.message).not.toContain("expired-state");
      expect(error.message).not.toContain("code-verifier");
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("rejects an already-consumed state", () => {
    const fakeDb = consumeDb({
      update: () => Effect.succeed([]),
      select: () => Effect.succeed([{ consumedAt: "2026-09-18T11:59:00.000Z" }]),
    });

    return Effect.gen(function* () {
      const states = yield* LinearOAuthStates.LinearOAuthStates;
      const error = yield* Effect.flip(states.consume({ state: "used-state", now: NOW }));

      expect(error).toMatchObject({
        _tag: "LinearOAuthStateRejected",
        reason: "already_consumed",
      });
      expect(error.message).not.toContain("used-state");
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("rejects an unknown state", () => {
    const fakeDb = consumeDb({
      update: () => Effect.succeed([]),
      select: () => Effect.succeed([]),
    });

    return Effect.gen(function* () {
      const states = yield* LinearOAuthStates.LinearOAuthStates;
      const error = yield* Effect.flip(states.consume({ state: "unknown-state", now: NOW }));

      expect(error).toMatchObject({
        _tag: "LinearOAuthStateRejected",
        reason: "unknown",
      });
      expect(error.message).not.toContain("unknown-state");
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect(
    "claims a live state and reports when a newer authorization already superseded it",
    () => {
      const claimedWhere: Array<unknown> = [];
      const claimDb = (rows: ReadonlyArray<{ stateHash: string }>) => ({
        delete: (table: unknown) => {
          expect(table).toBe(relayLinearOAuthStates);
          return {
            where: (condition: unknown) => {
              claimedWhere.push(condition);
              return {
                returning: () => Effect.succeed([...rows]),
              };
            },
          };
        },
      });
      const claim = (rows: ReadonlyArray<{ stateHash: string }>) =>
        LinearOAuthStates.LinearOAuthStates.pipe(
          Effect.flatMap((states) => states.claim({ state: "state-token" })),
          Effect.provide(provider(claimDb(rows))),
        );

      return Effect.gen(function* () {
        expect(yield* claim([{ stateHash: sha256Hex("state-token") }])).toBe(true);
        expect(yield* claim([])).toBe(false);

        const query = new PgDialect().sqlToQuery(claimedWhere[0] as never);
        expect(query.sql).toContain('"relay_linear_oauth_states"."state_hash" = $1');
        expect(query.params).toEqual([sha256Hex("state-token")]);
      });
    },
  );

  it.effect("retains persistence failures without retaining state or verifier material", () => {
    const cause = new Error("database unavailable");
    const fakeDb = {
      delete: () => ({ where: () => Effect.succeed([]) }),
      insert: () => ({
        values: () => Effect.fail(cause),
      }),
    };

    return Effect.gen(function* () {
      const states = yield* LinearOAuthStates.LinearOAuthStates;
      const error = yield* Effect.flip(
        states.create({
          userId: "user-1",
          environmentId: "env-1",
          connectionId: "connection-1",
          codeVerifier: "sensitive-code-verifier",
          now: NOW,
        }),
      );

      expect(error).toMatchObject({
        _tag: "LinearOAuthStateCreatePersistenceError",
        stage: "insert-state",
      });
      expect(error.cause).toBe(cause);
      expect(error.message).not.toContain("sensitive-code-verifier");
    }).pipe(Effect.provide(provider(fakeDb)));
  });

  it.effect("prunes expired states so no PKCE verifier outlives its state", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      delete: (table: unknown) => {
        expect(table).toBe(relayLinearOAuthStates);
        return {
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return Effect.succeed([]);
          },
        };
      },
    };

    return Effect.gen(function* () {
      const states = yield* LinearOAuthStates.LinearOAuthStates;
      const now = yield* DateTime.now;
      yield* states.pruneExpired;

      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_linear_oauth_states"."expires_at" < $1');
      expect(query.params).toEqual([now.epochMilliseconds]);
    }).pipe(Effect.provide(provider(fakeDb)));
  });
});
