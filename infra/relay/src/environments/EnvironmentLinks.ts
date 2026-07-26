import type {
  RelayClientEnvironmentRecord,
  RelayEnvironmentLinkProofPayload,
  RelayEnvironmentLinkRequest,
  RelayManagedEndpoint,
} from "@kata-sh/code-contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { and, eq, gt, isNotNull, isNull, lt, or } from "drizzle-orm";

import { RelayDb } from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";

export interface RelayLinkedEnvironmentRecord extends RelayClientEnvironmentRecord {
  readonly environmentPublicKey: string;
}

export interface AgentAwarenessDeliveryUserRecord {
  readonly userId: string;
  readonly notificationsEnabled: boolean;
  readonly liveActivitiesEnabled: boolean;
}

export interface ExpiredEnvironmentLinkRecord {
  readonly environmentId: string;
  readonly environmentPublicKey: string;
  readonly userId: string;
  readonly cleanupClaimedAt: string;
  readonly managedEndpointAllocationId: string | null;
}

export interface EnvironmentCleanupAttempt extends ExpiredEnvironmentLinkRecord {
  readonly attemptToken: string;
}

export class EnvironmentLinkUpsertPersistenceError extends Schema.TaggedErrorClass<EnvironmentLinkUpsertPersistenceError>()(
  "EnvironmentLinkUpsertPersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to persist environment link";
  }
}

export class EnvironmentLinkUserListPersistenceError extends Schema.TaggedErrorClass<EnvironmentLinkUserListPersistenceError>()(
  "EnvironmentLinkUserListPersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to list users linked to environment";
  }
}

export class EnvironmentPublicKeyListPersistenceError extends Schema.TaggedErrorClass<EnvironmentPublicKeyListPersistenceError>()(
  "EnvironmentPublicKeyListPersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to list environment public keys";
  }
}

export class EnvironmentLinkListPersistenceError extends Schema.TaggedErrorClass<EnvironmentLinkListPersistenceError>()(
  "EnvironmentLinkListPersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to list environment links";
  }
}

export class EnvironmentLinkLookupPersistenceError extends Schema.TaggedErrorClass<EnvironmentLinkLookupPersistenceError>()(
  "EnvironmentLinkLookupPersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to look up environment link";
  }
}

export class EnvironmentLinkRevokePersistenceError extends Schema.TaggedErrorClass<EnvironmentLinkRevokePersistenceError>()(
  "EnvironmentLinkRevokePersistenceError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Failed to revoke environment link";
  }
}

export interface EnvironmentLinksShape {
  readonly upsert: (input: {
    readonly userId: string;
    readonly request: RelayEnvironmentLinkRequest;
    readonly proof: RelayEnvironmentLinkProofPayload;
    readonly endpoint: RelayManagedEndpoint;
    readonly managedEndpointAllocationId: string | null;
  }) => Effect.Effect<void, EnvironmentLinkUpsertPersistenceError>;
  readonly listUsersForEnvironment: (input: {
    readonly environmentId: string;
  }) => Effect.Effect<ReadonlyArray<string>, EnvironmentLinkUserListPersistenceError>;
  readonly listDeliveryUsersForEnvironment: (input: {
    readonly environmentId: string;
    readonly environmentPublicKey: string;
  }) => Effect.Effect<
    ReadonlyArray<AgentAwarenessDeliveryUserRecord>,
    EnvironmentLinkUserListPersistenceError
  >;
  readonly listPublicKeysForEnvironment: (input: {
    readonly environmentId: string;
  }) => Effect.Effect<ReadonlyArray<string>, EnvironmentPublicKeyListPersistenceError>;
  readonly listForUser: (input: {
    readonly userId: string;
  }) => Effect.Effect<
    ReadonlyArray<RelayClientEnvironmentRecord>,
    EnvironmentLinkListPersistenceError
  >;
  readonly getForUser: (input: {
    readonly userId: string;
    readonly environmentId: string;
  }) => Effect.Effect<RelayLinkedEnvironmentRecord | null, EnvironmentLinkLookupPersistenceError>;
  readonly revokeForUser: (input: {
    readonly userId: string;
    readonly environmentId: string;
  }) => Effect.Effect<boolean, EnvironmentLinkRevokePersistenceError>;
  readonly renewForUser: (input: {
    readonly userId: string;
    readonly environmentId: string;
  }) => Effect.Effect<string | null, EnvironmentLinkRevokePersistenceError>;
  /** Atomically reserve every currently expired link for cleanup. */
  readonly claimExpired: () => Effect.Effect<
    ReadonlyArray<ExpiredEnvironmentLinkRecord>,
    EnvironmentLinkRevokePersistenceError
  >;
  /** Exclusively acquire pending cleanup work for a bounded attempt. */
  readonly acquireCleanupAttempts: (input: {
    readonly attemptToken: string;
  }) => Effect.Effect<
    ReadonlyArray<EnvironmentCleanupAttempt>,
    EnvironmentLinkRevokePersistenceError
  >;
  /** Revalidate and renew the bounded ownership lease before destructive work. */
  readonly ownsCleanupAttempt: (
    input: EnvironmentCleanupAttempt,
  ) => Effect.Effect<boolean, EnvironmentLinkRevokePersistenceError>;
  readonly releaseCleanupAttempt: (
    input: EnvironmentCleanupAttempt,
  ) => Effect.Effect<void, EnvironmentLinkRevokePersistenceError>;
  readonly completeCleanupAttempt: (
    input: EnvironmentCleanupAttempt,
  ) => Effect.Effect<boolean, EnvironmentLinkRevokePersistenceError>;
  readonly purgeRevokedBefore: (
    cutoff: string,
  ) => Effect.Effect<number, EnvironmentLinkRevokePersistenceError>;
}

export const RELAY_ENVIRONMENT_LEASE_DURATION_MS = 15 * 60 * 1_000;
export const ENVIRONMENT_CLEANUP_ATTEMPT_DURATION_MS = 2 * 60 * 1_000;

export function environmentLeaseExpiry(now: DateTime.DateTime): string {
  return DateTime.formatIso(
    DateTime.add(now, { milliseconds: RELAY_ENVIRONMENT_LEASE_DURATION_MS }),
  );
}

export class EnvironmentLinks extends Context.Service<EnvironmentLinks, EnvironmentLinksShape>()(
  "@kata-sh/code-relay/environments/EnvironmentLinks",
) {}

function agentAwarenessDeliveryUserCondition(environmentId: string) {
  return and(
    eq(relayEnvironmentLinks.environmentId, environmentId),
    isNull(relayEnvironmentLinks.revokedAt),
    or(
      eq(relayEnvironmentLinks.notificationsEnabled, true),
      eq(relayEnvironmentLinks.liveActivitiesEnabled, true),
    ),
  );
}

function agentAwarenessDeliveryUserKeyCondition(input: {
  readonly environmentId: string;
  readonly environmentPublicKey: string;
}) {
  return and(
    agentAwarenessDeliveryUserCondition(input.environmentId),
    eq(relayEnvironmentLinks.environmentPublicKey, input.environmentPublicKey),
  );
}

const make = Effect.gen(function* () {
  const db = yield* RelayDb;

  return EnvironmentLinks.of({
    upsert: Effect.fn("relay.environment_links.upsert")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({
          "relay.environment_id": input.proof.environmentId,
        });
        const nowDateTime = yield* DateTime.now;
        const now = DateTime.formatIso(nowDateTime);
        const leaseExpiresAt = environmentLeaseExpiry(nowDateTime);
        const { request, proof } = input;
        const environmentId = proof.environmentId;
        const { endpoint } = input;
        const rows = yield* db
          .insert(relayEnvironmentLinks)
          .values({
            userId: input.userId,
            environmentId,
            environmentLabel: proof.descriptor.label,
            environmentPublicKey: proof.environmentPublicKey,
            endpointHttpBaseUrl: endpoint.httpBaseUrl,
            endpointWsBaseUrl: endpoint.wsBaseUrl,
            endpointProviderKind: endpoint.providerKind,
            notificationsEnabled: request.notificationsEnabled,
            liveActivitiesEnabled: request.liveActivitiesEnabled,
            managedTunnelsEnabled: request.managedTunnelsEnabled,
            createdByDeviceId: request.deviceId ?? null,
            leaseExpiresAt,
            cleanupClaimedAt: null,
            cleanupAttemptToken: null,
            cleanupAttemptExpiresAt: null,
            managedEndpointAllocationId: input.managedEndpointAllocationId,
            revokedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [relayEnvironmentLinks.userId, relayEnvironmentLinks.environmentId],
            set: {
              environmentPublicKey: proof.environmentPublicKey,
              environmentLabel: proof.descriptor.label,
              endpointHttpBaseUrl: endpoint.httpBaseUrl,
              endpointWsBaseUrl: endpoint.wsBaseUrl,
              endpointProviderKind: endpoint.providerKind,
              notificationsEnabled: request.notificationsEnabled,
              liveActivitiesEnabled: request.liveActivitiesEnabled,
              managedTunnelsEnabled: request.managedTunnelsEnabled,
              createdByDeviceId: request.deviceId ?? null,
              leaseExpiresAt,
              cleanupClaimedAt: null,
              cleanupAttemptToken: null,
              cleanupAttemptExpiresAt: null,
              managedEndpointAllocationId: input.managedEndpointAllocationId,
              revokedAt: null,
              updatedAt: now,
            },
            // A bounded cleanup attempt owns the terminal transition while its
            // token is live. Relinking may cancel a released or expired claim,
            // which lets an environment recover after cleanup fails.
            setWhere: or(
              isNull(relayEnvironmentLinks.cleanupClaimedAt),
              isNull(relayEnvironmentLinks.cleanupAttemptToken),
              lt(relayEnvironmentLinks.cleanupAttemptExpiresAt, now),
            )!,
          })
          .returning({ environmentId: relayEnvironmentLinks.environmentId });
        if (rows.length === 0) {
          return yield* Effect.fail("Environment link cleanup is already in progress");
        }
      },
      Effect.mapError((cause) => new EnvironmentLinkUpsertPersistenceError({ cause })),
    ),

    listUsersForEnvironment: Effect.fn("relay.environment_links.list_users_for_environment")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
        return yield* db
          .select({ userId: relayEnvironmentLinks.userId })
          .from(relayEnvironmentLinks)
          .where(agentAwarenessDeliveryUserCondition(input.environmentId))
          .pipe(
            Effect.map((rows) => rows.map((row) => row.userId)),
            Effect.mapError((cause) => new EnvironmentLinkUserListPersistenceError({ cause })),
          );
      },
    ),

    listDeliveryUsersForEnvironment: Effect.fn(
      "relay.environment_links.list_delivery_users_for_environment",
    )(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      return yield* db
        .select({
          userId: relayEnvironmentLinks.userId,
          notificationsEnabled: relayEnvironmentLinks.notificationsEnabled,
          liveActivitiesEnabled: relayEnvironmentLinks.liveActivitiesEnabled,
        })
        .from(relayEnvironmentLinks)
        .where(agentAwarenessDeliveryUserKeyCondition(input))
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              userId: row.userId,
              notificationsEnabled: row.notificationsEnabled,
              liveActivitiesEnabled: row.liveActivitiesEnabled,
            })),
          ),
          Effect.mapError((cause) => new EnvironmentLinkUserListPersistenceError({ cause })),
        );
    }),

    listPublicKeysForEnvironment: Effect.fn(
      "relay.environment_links.list_public_keys_for_environment",
    )(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      return yield* db
        .select({ environmentPublicKey: relayEnvironmentLinks.environmentPublicKey })
        .from(relayEnvironmentLinks)
        .where(
          and(
            eq(relayEnvironmentLinks.environmentId, input.environmentId),
            isNull(relayEnvironmentLinks.revokedAt),
          ),
        )
        .pipe(
          Effect.map((rows) => [
            ...new Set(rows.map((row) => row.environmentPublicKey).filter((key) => key.length > 0)),
          ]),
          Effect.mapError((cause) => new EnvironmentPublicKeyListPersistenceError({ cause })),
        );
    }),

    listForUser: Effect.fn("relay.environment_links.list_for_user")(function* (input) {
      const now = DateTime.formatIso(yield* DateTime.now);
      return yield* db
        .select({
          environmentId: relayEnvironmentLinks.environmentId,
          environmentLabel: relayEnvironmentLinks.environmentLabel,
          endpointHttpBaseUrl: relayEnvironmentLinks.endpointHttpBaseUrl,
          endpointWsBaseUrl: relayEnvironmentLinks.endpointWsBaseUrl,
          endpointProviderKind: relayEnvironmentLinks.endpointProviderKind,
          createdAt: relayEnvironmentLinks.createdAt,
          leaseExpiresAt: relayEnvironmentLinks.leaseExpiresAt,
        })
        .from(relayEnvironmentLinks)
        .where(
          and(
            eq(relayEnvironmentLinks.userId, input.userId),
            isNull(relayEnvironmentLinks.revokedAt),
            gt(relayEnvironmentLinks.leaseExpiresAt, now),
          ),
        )
        .pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              environmentId: row.environmentId as RelayClientEnvironmentRecord["environmentId"],
              label:
                row.environmentLabel.trim().length > 0 ? row.environmentLabel : row.environmentId,
              endpoint: {
                httpBaseUrl: row.endpointHttpBaseUrl,
                wsBaseUrl: row.endpointWsBaseUrl,
                providerKind:
                  row.endpointProviderKind as RelayClientEnvironmentRecord["endpoint"]["providerKind"],
              },
              linkedAt: row.createdAt,
              leaseExpiresAt: row.leaseExpiresAt,
            })),
          ),
          Effect.mapError((cause) => new EnvironmentLinkListPersistenceError({ cause })),
        );
    }),

    getForUser: Effect.fn("relay.environment_links.get_for_user")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.environment_id": input.environmentId,
      });
      // Match listForUser / credential auth: expired or cleanup-claimed links
      // must not authorize status/connect, even when revokedAt is still null.
      const now = DateTime.formatIso(yield* DateTime.now);
      return yield* db
        .select({
          environmentId: relayEnvironmentLinks.environmentId,
          environmentLabel: relayEnvironmentLinks.environmentLabel,
          environmentPublicKey: relayEnvironmentLinks.environmentPublicKey,
          endpointHttpBaseUrl: relayEnvironmentLinks.endpointHttpBaseUrl,
          endpointWsBaseUrl: relayEnvironmentLinks.endpointWsBaseUrl,
          endpointProviderKind: relayEnvironmentLinks.endpointProviderKind,
          createdAt: relayEnvironmentLinks.createdAt,
          leaseExpiresAt: relayEnvironmentLinks.leaseExpiresAt,
        })
        .from(relayEnvironmentLinks)
        .where(
          and(
            eq(relayEnvironmentLinks.userId, input.userId),
            eq(relayEnvironmentLinks.environmentId, input.environmentId),
            isNull(relayEnvironmentLinks.revokedAt),
            isNull(relayEnvironmentLinks.cleanupClaimedAt),
            gt(relayEnvironmentLinks.leaseExpiresAt, now),
          ),
        )
        .limit(1)
        .pipe(
          Effect.map((rows) => {
            const row = rows[0];
            return row
              ? {
                  environmentId: row.environmentId as RelayClientEnvironmentRecord["environmentId"],
                  label:
                    row.environmentLabel.trim().length > 0
                      ? row.environmentLabel
                      : row.environmentId,
                  endpoint: {
                    httpBaseUrl: row.endpointHttpBaseUrl,
                    wsBaseUrl: row.endpointWsBaseUrl,
                    providerKind:
                      row.endpointProviderKind as RelayClientEnvironmentRecord["endpoint"]["providerKind"],
                  },
                  environmentPublicKey: row.environmentPublicKey,
                  linkedAt: row.createdAt,
                  leaseExpiresAt: row.leaseExpiresAt,
                }
              : null;
          }),
          Effect.mapError((cause) => new EnvironmentLinkLookupPersistenceError({ cause })),
        );
    }),

    revokeForUser: Effect.fn("relay.environment_links.revoke_for_user")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({
          "relay.environment_id": input.environmentId,
        });
        const revokedAt = DateTime.formatIso(yield* DateTime.now);
        const rows = yield* db
          .update(relayEnvironmentLinks)
          .set({
            revokedAt,
            updatedAt: revokedAt,
          })
          .where(
            and(
              eq(relayEnvironmentLinks.userId, input.userId),
              eq(relayEnvironmentLinks.environmentId, input.environmentId),
              isNull(relayEnvironmentLinks.revokedAt),
            ),
          )
          .returning({ environmentId: relayEnvironmentLinks.environmentId });
        return rows.length > 0;
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),

    renewForUser: Effect.fn("relay.environment_links.renew_for_user")(
      function* (input) {
        const nowDateTime = yield* DateTime.now;
        const updatedAt = DateTime.formatIso(nowDateTime);
        const leaseExpiresAt = environmentLeaseExpiry(nowDateTime);
        const rows = yield* db
          .update(relayEnvironmentLinks)
          .set({ leaseExpiresAt, updatedAt })
          .where(
            and(
              eq(relayEnvironmentLinks.userId, input.userId),
              eq(relayEnvironmentLinks.environmentId, input.environmentId),
              isNull(relayEnvironmentLinks.revokedAt),
              isNull(relayEnvironmentLinks.cleanupClaimedAt),
            ),
          )
          .returning({ environmentId: relayEnvironmentLinks.environmentId });
        return rows.length > 0 ? leaseExpiresAt : null;
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),

    claimExpired: Effect.fn("relay.environment_links.claim_expired")(
      function* () {
        const claimedAt = DateTime.formatIso(yield* DateTime.now);
        const rows = yield* db
          .update(relayEnvironmentLinks)
          .set({
            cleanupClaimedAt: claimedAt,
            cleanupAttemptToken: null,
            cleanupAttemptExpiresAt: null,
            updatedAt: claimedAt,
          })
          .where(
            and(
              isNull(relayEnvironmentLinks.revokedAt),
              isNull(relayEnvironmentLinks.cleanupClaimedAt),
              lt(relayEnvironmentLinks.leaseExpiresAt, claimedAt),
            ),
          )
          .returning({
            environmentId: relayEnvironmentLinks.environmentId,
            environmentPublicKey: relayEnvironmentLinks.environmentPublicKey,
            userId: relayEnvironmentLinks.userId,
            cleanupClaimedAt: relayEnvironmentLinks.cleanupClaimedAt,
            managedEndpointAllocationId: relayEnvironmentLinks.managedEndpointAllocationId,
          });
        return rows.map((row) => ({ ...row, cleanupClaimedAt: row.cleanupClaimedAt ?? claimedAt }));
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),

    acquireCleanupAttempts: Effect.fn("relay.environment_links.acquire_cleanup_attempts")(
      function* (input) {
        const nowDateTime = yield* DateTime.now;
        const now = DateTime.formatIso(nowDateTime);
        const expiresAt = DateTime.formatIso(
          DateTime.add(nowDateTime, { milliseconds: ENVIRONMENT_CLEANUP_ATTEMPT_DURATION_MS }),
        );
        const rows = yield* db
          .update(relayEnvironmentLinks)
          .set({
            cleanupAttemptToken: input.attemptToken,
            cleanupAttemptExpiresAt: expiresAt,
            updatedAt: now,
          })
          .where(
            and(
              isNull(relayEnvironmentLinks.revokedAt),
              isNotNull(relayEnvironmentLinks.cleanupClaimedAt),
              or(
                isNull(relayEnvironmentLinks.cleanupAttemptToken),
                lt(relayEnvironmentLinks.cleanupAttemptExpiresAt, now),
              ),
            ),
          )
          .returning({
            environmentId: relayEnvironmentLinks.environmentId,
            environmentPublicKey: relayEnvironmentLinks.environmentPublicKey,
            userId: relayEnvironmentLinks.userId,
            cleanupClaimedAt: relayEnvironmentLinks.cleanupClaimedAt,
            managedEndpointAllocationId: relayEnvironmentLinks.managedEndpointAllocationId,
          });
        return rows.flatMap((row) =>
          row.cleanupClaimedAt === null
            ? []
            : [
                {
                  ...row,
                  cleanupClaimedAt: row.cleanupClaimedAt,
                  attemptToken: input.attemptToken,
                },
              ],
        );
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),

    ownsCleanupAttempt: Effect.fn("relay.environment_links.owns_cleanup_attempt")(
      function* (input) {
        const nowDateTime = yield* DateTime.now;
        const now = DateTime.formatIso(nowDateTime);
        const expiresAt = DateTime.formatIso(
          DateTime.add(nowDateTime, { milliseconds: ENVIRONMENT_CLEANUP_ATTEMPT_DURATION_MS }),
        );
        const rows = yield* db
          .update(relayEnvironmentLinks)
          .set({ cleanupAttemptExpiresAt: expiresAt, updatedAt: now })
          .where(
            and(
              eq(relayEnvironmentLinks.userId, input.userId),
              eq(relayEnvironmentLinks.environmentId, input.environmentId),
              eq(relayEnvironmentLinks.cleanupClaimedAt, input.cleanupClaimedAt),
              eq(relayEnvironmentLinks.cleanupAttemptToken, input.attemptToken),
              gt(relayEnvironmentLinks.cleanupAttemptExpiresAt, now),
              isNull(relayEnvironmentLinks.revokedAt),
            ),
          )
          .returning({ environmentId: relayEnvironmentLinks.environmentId });
        return rows.length > 0;
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),

    releaseCleanupAttempt: Effect.fn("relay.environment_links.release_cleanup_attempt")(
      function* (input) {
        yield* db
          .update(relayEnvironmentLinks)
          .set({ cleanupAttemptToken: null, cleanupAttemptExpiresAt: null })
          .where(
            and(
              eq(relayEnvironmentLinks.userId, input.userId),
              eq(relayEnvironmentLinks.environmentId, input.environmentId),
              eq(relayEnvironmentLinks.cleanupClaimedAt, input.cleanupClaimedAt),
              eq(relayEnvironmentLinks.cleanupAttemptToken, input.attemptToken),
              isNull(relayEnvironmentLinks.revokedAt),
            ),
          );
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),

    completeCleanupAttempt: Effect.fn("relay.environment_links.complete_cleanup_attempt")(
      function* (input) {
        const revokedAt = DateTime.formatIso(yield* DateTime.now);
        const rows = yield* db
          .update(relayEnvironmentLinks)
          .set({
            revokedAt,
            cleanupAttemptToken: null,
            cleanupAttemptExpiresAt: null,
            updatedAt: revokedAt,
          })
          .where(
            and(
              eq(relayEnvironmentLinks.userId, input.userId),
              eq(relayEnvironmentLinks.environmentId, input.environmentId),
              eq(relayEnvironmentLinks.cleanupClaimedAt, input.cleanupClaimedAt),
              eq(relayEnvironmentLinks.cleanupAttemptToken, input.attemptToken),
              gt(relayEnvironmentLinks.cleanupAttemptExpiresAt, revokedAt),
              isNull(relayEnvironmentLinks.revokedAt),
            ),
          )
          .returning({ environmentId: relayEnvironmentLinks.environmentId });
        return rows.length > 0;
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),

    purgeRevokedBefore: Effect.fn("relay.environment_links.purge_revoked_before")(
      function* (cutoff) {
        const rows = yield* db
          .delete(relayEnvironmentLinks)
          .where(
            and(
              isNotNull(relayEnvironmentLinks.revokedAt),
              lt(relayEnvironmentLinks.revokedAt, cutoff),
            ),
          )
          .returning({ environmentId: relayEnvironmentLinks.environmentId });
        return rows.length;
      },
      Effect.mapError((cause) => new EnvironmentLinkRevokePersistenceError({ cause })),
    ),
  });
});

export const layer = Layer.effect(EnvironmentLinks, make);
