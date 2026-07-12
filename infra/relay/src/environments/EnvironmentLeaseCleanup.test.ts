import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import {
  EnvironmentCredentialRevokePersistenceError,
  EnvironmentCredentials,
  type EnvironmentCredentialsShape,
} from "./EnvironmentCredentials.ts";
import { cleanupExpiredEnvironmentLinksWithToken } from "./EnvironmentLeaseCleanup.ts";
import { EnvironmentLinks, type EnvironmentLinksShape } from "./EnvironmentLinks.ts";
import {
  ManagedEndpointProvider,
  type ManagedEndpointProviderShape,
} from "./ManagedEndpointProvider.ts";

const baseRecord = {
  environmentId: "env-1",
  environmentPublicKey: "key-1",
  userId: "user-1",
  cleanupClaimedAt: "2026-07-12T20:00:00.000Z",
};

function makeLinkState() {
  let claimed = false;
  let revoked = false;
  let attemptToken: string | null = null;

  const service: EnvironmentLinksShape = {
    claimExpired: () =>
      Effect.sync(() => {
        if (!claimed && !revoked) claimed = true;
        return claimed && !revoked ? [baseRecord] : [];
      }),
    acquireCleanupAttempts: ({ attemptToken: requestedToken }) =>
      Effect.sync(() => {
        if (!claimed || revoked || attemptToken !== null) return [];
        attemptToken = requestedToken;
        return [{ ...baseRecord, attemptToken: requestedToken }];
      }),
    ownsCleanupAttempt: (attempt) =>
      Effect.sync(() => claimed && !revoked && attemptToken === attempt.attemptToken),
    releaseCleanupAttempt: (attempt) =>
      Effect.sync(() => {
        if (attemptToken === attempt.attemptToken && !revoked) attemptToken = null;
      }),
    completeCleanupAttempt: (attempt) =>
      Effect.sync(() => {
        if (attemptToken !== attempt.attemptToken || revoked) return false;
        revoked = true;
        attemptToken = null;
        return true;
      }),
    upsert: () =>
      Effect.sync(() => {
        if (!revoked || attemptToken !== null) return;
        claimed = false;
        revoked = false;
      }),
    revokeForUser: () => Effect.die("unused"),
    listUsersForEnvironment: () => Effect.die("unused"),
    listDeliveryUsersForEnvironment: () => Effect.die("unused"),
    listPublicKeysForEnvironment: () => Effect.die("unused"),
    listForUser: () => Effect.die("unused"),
    getForUser: () => Effect.die("unused"),
    renewForUser: () => Effect.die("unused"),
    purgeRevokedBefore: () => Effect.die("unused"),
  };

  return {
    service: EnvironmentLinks.of(service),
    isRevoked: () => revoked,
    activeAttempt: () => attemptToken,
  };
}

function services(input: {
  readonly links: EnvironmentLinksShape;
  readonly credentials: EnvironmentCredentialsShape;
  readonly endpoints: ManagedEndpointProviderShape;
}) {
  return Layer.mergeAll(
    Layer.succeed(EnvironmentLinks, input.links),
    Layer.succeed(EnvironmentCredentials, input.credentials),
    Layer.succeed(ManagedEndpointProvider, input.endpoints),
  );
}

describe("cleanupExpiredEnvironmentLinks", () => {
  it.effect("releases failed attempts so claimed cleanup can retry", () => {
    const links = makeLinkState();
    let credentialAttempts = 0;
    const layer = services({
      links: links.service,
      credentials: EnvironmentCredentials.of({
        create: () => Effect.die("unused"),
        authenticate: () => Effect.die("unused"),
        revokeForEnvironmentPublicKey: () => {
          credentialAttempts += 1;
          return credentialAttempts === 1
            ? Effect.fail(new EnvironmentCredentialRevokePersistenceError({ cause: "transient" }))
            : Effect.succeed(true);
        },
      }),
      endpoints: ManagedEndpointProvider.of({
        provision: () => Effect.die("unused"),
        deprovision: () => Effect.void,
      }),
    });

    return Effect.gen(function* () {
      yield* cleanupExpiredEnvironmentLinksWithToken("attempt-1");
      expect(links.isRevoked()).toBe(false);
      expect(links.activeAttempt()).toBeNull();

      yield* cleanupExpiredEnvironmentLinksWithToken("attempt-2");
      expect(links.isRevoked()).toBe(true);
      expect(credentialAttempts).toBe(2);
    }).pipe(Effect.provide(layer));
  });

  it.effect("gives overlapping cleanup runs one exclusive destructive attempt", () =>
    Effect.gen(function* () {
      const links = makeLinkState();
      const firstDeprovisionStarted = yield* Deferred.make<void>();
      const releaseFirstDeprovision = yield* Deferred.make<void>();
      let deprovisionAttempts = 0;
      let credentialAttempts = 0;

      const layer = services({
        links: links.service,
        credentials: EnvironmentCredentials.of({
          create: () => Effect.die("unused"),
          authenticate: () => Effect.die("unused"),
          revokeForEnvironmentPublicKey: () =>
            Effect.sync(() => {
              credentialAttempts += 1;
              return true;
            }),
        }),
        endpoints: ManagedEndpointProvider.of({
          provision: () => Effect.die("unused"),
          deprovision: () =>
            Effect.gen(function* () {
              deprovisionAttempts += 1;
              yield* Deferred.succeed(firstDeprovisionStarted, undefined);
              yield* Deferred.await(releaseFirstDeprovision);
            }),
        }),
      });

      const first = yield* Effect.forkChild(
        cleanupExpiredEnvironmentLinksWithToken("attempt-1").pipe(Effect.provide(layer)),
      );
      yield* Deferred.await(firstDeprovisionStarted);

      yield* cleanupExpiredEnvironmentLinksWithToken("attempt-2").pipe(Effect.provide(layer));
      expect(deprovisionAttempts).toBe(1);
      expect(credentialAttempts).toBe(0);

      yield* Deferred.succeed(releaseFirstDeprovision, undefined);
      yield* Fiber.join(first);
      expect(links.isRevoked()).toBe(true);
      expect(deprovisionAttempts).toBe(1);
      expect(credentialAttempts).toBe(1);

      yield* links.service.upsert({} as never);
      expect(links.isRevoked()).toBe(false);
      yield* Effect.yieldNow;
      expect(deprovisionAttempts).toBe(1);
      expect(credentialAttempts).toBe(1);
    }),
  );
});
