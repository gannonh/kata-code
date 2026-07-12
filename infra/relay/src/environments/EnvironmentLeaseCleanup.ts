import * as Effect from "effect/Effect";

import {
  EnvironmentCredentialRevokePersistenceError,
  EnvironmentCredentials,
} from "./EnvironmentCredentials.ts";
import { EnvironmentLinks } from "./EnvironmentLinks.ts";
import { ManagedEndpointProvider } from "./ManagedEndpointProvider.ts";

/** Claims expired links and completes their external cleanup before revocation.
 * Claimed, unrevoked links remain eligible for retry after any partial failure. */
export const cleanupExpiredEnvironmentLinks = Effect.gen(function* () {
  const links = yield* EnvironmentLinks;
  const credentials = yield* EnvironmentCredentials;
  const endpoints = yield* ManagedEndpointProvider;

  yield* links.claimExpired();
  const expired = yield* links.listExpired();
  yield* Effect.forEach(
    expired,
    (record) =>
      endpoints
        .deprovision({
          userId: record.userId,
          environmentId: record.environmentId,
        })
        .pipe(
          Effect.andThen(
            credentials
              .revokeForEnvironmentPublicKey({
                environmentId: record.environmentId,
                environmentPublicKey: record.environmentPublicKey,
              })
              .pipe(
                Effect.filterOrFail(
                  (cleaned) => cleaned,
                  () =>
                    new EnvironmentCredentialRevokePersistenceError({
                      cause: "Credential remains protected by an active environment link.",
                    }),
                ),
              ),
          ),
          Effect.andThen(
            links.revokeForUser({
              userId: record.userId,
              environmentId: record.environmentId,
            }),
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Expired environment cleanup was incomplete", {
              environmentId: record.environmentId,
              cause,
            }),
          ),
        ),
    { concurrency: 4 },
  );
});
