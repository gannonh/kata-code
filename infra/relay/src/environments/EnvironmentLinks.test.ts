import type {
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkRequest,
  RelayManagedEndpoint,
} from "@kata-sh/code-contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PgDialect } from "drizzle-orm/pg-core";

import { RelayDb, type RelayDatabase } from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";
import { EnvironmentLinks, layer } from "./EnvironmentLinks.ts";

describe("EnvironmentLinks", () => {
  it.effect("lists only active environment leases", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return Effect.succeed([]);
          },
        }),
      }),
    } as unknown as RelayDatabase;

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks;
      expect(yield* links.listForUser({ userId: "user-1" })).toEqual([]);
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.sql).toContain('"relay_environment_links"."lease_expires_at" > $2');
      expect(query.params[0]).toBe("user-1");
      expect(typeof query.params[1]).toBe("string");
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(RelayDb, fakeDb)))));
  });

  it.effect("renews active leases and atomically claims expired leases for cleanup", () => {
    const updates: Array<Record<string, unknown>> = [];
    const conditions: Array<unknown> = [];
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            conditions.push(condition);
            return Effect.succeed([
              { environmentId: "env-1", environmentPublicKey: "key-1", userId: "user-1" },
            ]);
          },
        }),
      }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: (condition: unknown) => ({
            returning: () => {
              updates.push(values);
              conditions.push(condition);
              return Effect.succeed([{ environmentId: "env-1" }]);
            },
          }),
        }),
      }),
    } as unknown as RelayDatabase;

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks;
      const renewedUntil = yield* links.renewForUser({
        userId: "user-1",
        environmentId: "env-1",
      });
      expect(renewedUntil).toBe(updates[0]?.leaseExpiresAt);
      expect(String(updates[0]?.leaseExpiresAt) > String(updates[0]?.updatedAt)).toBe(true);

      expect(yield* links.claimExpired()).toEqual([{ environmentId: "env-1" }]);
      expect(yield* links.listExpired()).toEqual([
        { environmentId: "env-1", environmentPublicKey: "key-1", userId: "user-1" },
      ]);

      const dialect = new PgDialect();
      const renewQuery = dialect.sqlToQuery(conditions[0] as never);
      expect(renewQuery.sql).toContain('"relay_environment_links"."cleanup_claimed_at" is null');
      const claimQuery = dialect.sqlToQuery(conditions[1] as never);
      expect(claimQuery.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(claimQuery.sql).toContain('"relay_environment_links"."cleanup_claimed_at" is null');
      expect(claimQuery.sql).toContain('"relay_environment_links"."lease_expires_at" < $1');
      const pendingQuery = dialect.sqlToQuery(conditions[2] as never);
      expect(pendingQuery.sql).toContain(
        '"relay_environment_links"."cleanup_claimed_at" is not null',
      );
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(RelayDb, fakeDb)))));
  });

  it.effect("rejects relinking a cleanup-claimed environment", () => {
    let cleanupClaimed = true;
    let setWhere: unknown;
    const fakeDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: (config: { readonly setWhere?: unknown }) => ({
            returning: () => {
              setWhere = config.setWhere;
              if (cleanupClaimed && config.setWhere !== undefined) {
                return Effect.succeed([]);
              }
              cleanupClaimed = false;
              return Effect.succeed([{ environmentId: "env-1" }]);
            },
          }),
        }),
      }),
    } as unknown as RelayDatabase;
    const request = {
      notificationsEnabled: true,
      liveActivitiesEnabled: true,
      managedTunnelsEnabled: true,
    } as RelayEnvironmentLinkRequest;
    const proof = {
      environmentId: "env-1",
      environmentPublicKey: "key-1",
      descriptor: { label: "Environment" },
    } as RelayEnvironmentLinkProofPayload;
    const endpoint = {
      httpBaseUrl: "https://example.test",
      wsBaseUrl: "wss://example.test",
      providerKind: "manual",
    } as RelayManagedEndpoint;

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks;
      const rejected = yield* links.upsert({ userId: "user-1", request, proof, endpoint }).pipe(
        Effect.as(false),
        Effect.orElseSucceed(() => true),
      );
      expect(rejected).toBe(true);
      expect(cleanupClaimed).toBe(true);
      const condition = new PgDialect().sqlToQuery(setWhere as never);
      expect(condition.sql).toContain('"relay_environment_links"."cleanup_claimed_at" is null');
      expect(condition.sql).toContain('"relay_environment_links"."revoked_at" is not null');
      expect(condition.sql).toContain(" or ");

      cleanupClaimed = false;
      yield* links.upsert({ userId: "user-1", request, proof, endpoint });
      expect(cleanupClaimed).toBe(false);
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(RelayDb, fakeDb)))));
  });

  it.effect("makes renewal and cleanup claims mutually exclusive", () => {
    const makeLinks = (initialLeaseExpiresAt: string) => {
      const state = {
        cleanupClaimed: false,
        leaseExpiresAt: initialLeaseExpiresAt,
        renewed: false,
        revoked: false,
      };
      const fakeDb = {
        update: () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => ({
              returning: () => {
                if (!("leaseExpiresAt" in values)) {
                  if (state.revoked || state.cleanupClaimed || state.renewed) {
                    return Effect.succeed([]);
                  }
                  state.cleanupClaimed = true;
                  return Effect.succeed([
                    { environmentId: "env-1", environmentPublicKey: "key-1", userId: "user-1" },
                  ]);
                }
                if (state.revoked || state.cleanupClaimed) {
                  return Effect.succeed([]);
                }
                state.leaseExpiresAt = String(values.leaseExpiresAt);
                state.renewed = true;
                return Effect.succeed([{ environmentId: "env-1" }]);
              },
            }),
          }),
        }),
      } as unknown as RelayDatabase;
      return {
        effect: EnvironmentLinks.pipe(
          Effect.provide(layer.pipe(Layer.provide(Layer.succeed(RelayDb, fakeDb)))),
        ),
        state,
      };
    };

    return Effect.gen(function* () {
      const renewalFirst = makeLinks("2000-01-01T00:00:00.000Z");
      const renewalLinks = yield* renewalFirst.effect;
      expect(
        yield* renewalLinks.renewForUser({ userId: "user-1", environmentId: "env-1" }),
      ).not.toBeNull();
      expect(yield* renewalLinks.claimExpired()).toEqual([]);
      expect(renewalFirst.state.cleanupClaimed).toBe(false);

      const cleanupFirst = makeLinks("2000-01-01T00:00:00.000Z");
      const cleanupLinks = yield* cleanupFirst.effect;
      expect(yield* cleanupLinks.claimExpired()).toHaveLength(1);
      expect(
        yield* cleanupLinks.renewForUser({ userId: "user-1", environmentId: "env-1" }),
      ).toBeNull();
      expect(cleanupFirst.state.cleanupClaimed).toBe(true);
    });
  });

  it.effect("selects users when either notifications or Live Activities are enabled", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      select: (selection: unknown) => {
        expect(selection).toBeDefined();
        return {
          from: (table: unknown) => {
            expect(table).toBe(relayEnvironmentLinks);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return Effect.succeed([]);
              },
            };
          },
        };
      },
    } as unknown as RelayDatabase;

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks;
      expect(yield* links.listUsersForEnvironment({ environmentId: "env-1" })).toEqual([]);
      expect(whereConditions).toHaveLength(1);

      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.sql).toContain('"relay_environment_links"."notifications_enabled" = $2');
      expect(query.sql).toContain('"relay_environment_links"."live_activities_enabled" = $3');
      expect(query.sql).toContain(" or ");
      expect(query.params).toEqual(["env-1", true, true]);
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(RelayDb, fakeDb)))));
  });

  it.effect("revokes only the active link owned by the requesting user", () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          set: (values: Record<string, unknown>) => {
            updateValues.push(values);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return {
                  returning: (selection: unknown) => {
                    expect(selection).toBeDefined();
                    return Effect.succeed([{ environmentId: "env-1" }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as RelayDatabase;

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks;
      const revoked = yield* links.revokeForUser({
        userId: "user-1",
        environmentId: "env-1",
      });

      expect(revoked).toBe(true);
      expect(updateValues).toHaveLength(1);
      expect(updateValues[0]?.revokedAt).toEqual(updateValues[0]?.updatedAt);
      expect(typeof updateValues[0]?.revokedAt).toBe("string");
      expect(whereConditions).toHaveLength(1);

      const dialect = new PgDialect();
      const query = dialect.sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $2');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.params).toEqual(["user-1", "env-1"]);
    }).pipe(Effect.provide(layer.pipe(Layer.provide(Layer.succeed(RelayDb, fakeDb)))));
  });
});
