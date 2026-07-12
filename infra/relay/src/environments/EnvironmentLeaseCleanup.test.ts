import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  EnvironmentCredentialRevokePersistenceError,
  EnvironmentCredentials,
} from "./EnvironmentCredentials.ts";
import { cleanupExpiredEnvironmentLinks } from "./EnvironmentLeaseCleanup.ts";
import { EnvironmentLinks } from "./EnvironmentLinks.ts";
import { ManagedEndpointProvider } from "./ManagedEndpointProvider.ts";

const record = {
  environmentId: "env-1",
  environmentPublicKey: "key-1",
  userId: "user-1",
};

describe("cleanupExpiredEnvironmentLinks", () => {
  it.effect("keeps claimed links pending until credential cleanup succeeds", () => {
    let claimed = false;
    let revoked = false;
    let credentialAttempts = 0;
    let deprovisionAttempts = 0;

    const links = EnvironmentLinks.of({
      claimExpired: () =>
        Effect.sync(() => {
          claimed = true;
          return [record];
        }),
      listExpired: () => Effect.sync(() => (claimed && !revoked ? [record] : [])),
      revokeForUser: () =>
        Effect.sync(() => {
          revoked = true;
          return true;
        }),
      upsert: () => Effect.die("unused"),
      listUsersForEnvironment: () => Effect.die("unused"),
      listDeliveryUsersForEnvironment: () => Effect.die("unused"),
      listPublicKeysForEnvironment: () => Effect.die("unused"),
      listForUser: () => Effect.die("unused"),
      getForUser: () => Effect.die("unused"),
      renewForUser: () => Effect.die("unused"),
      purgeRevokedBefore: () => Effect.die("unused"),
    });
    const credentials = EnvironmentCredentials.of({
      create: () => Effect.die("unused"),
      authenticate: () => Effect.die("unused"),
      revokeForEnvironmentPublicKey: () => {
        credentialAttempts += 1;
        return credentialAttempts === 1
          ? Effect.fail(new EnvironmentCredentialRevokePersistenceError({ cause: "transient" }))
          : Effect.succeed(true);
      },
    });
    const endpoints = ManagedEndpointProvider.of({
      provision: () => Effect.die("unused"),
      deprovision: () =>
        Effect.sync(() => {
          deprovisionAttempts += 1;
        }),
    });
    const services = Layer.mergeAll(
      Layer.succeed(EnvironmentLinks, links),
      Layer.succeed(EnvironmentCredentials, credentials),
      Layer.succeed(ManagedEndpointProvider, endpoints),
    );

    return Effect.gen(function* () {
      yield* cleanupExpiredEnvironmentLinks;
      expect(revoked).toBe(false);
      expect(yield* links.listExpired()).toEqual([record]);

      yield* cleanupExpiredEnvironmentLinks;
      expect(revoked).toBe(true);
      expect(yield* links.listExpired()).toEqual([]);
      expect(credentialAttempts).toBe(2);
      expect(deprovisionAttempts).toBe(2);
    }).pipe(Effect.provide(services));
  });
});
