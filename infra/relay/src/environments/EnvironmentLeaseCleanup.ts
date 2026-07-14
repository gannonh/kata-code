import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import {
  EnvironmentCredentialRevokePersistenceError,
  EnvironmentCredentials,
} from "./EnvironmentCredentials.ts";
import {
  type EnvironmentCleanupAttempt,
  EnvironmentLinkRevokePersistenceError,
  EnvironmentLinks,
} from "./EnvironmentLinks.ts";
import { ManagedEndpointProvider } from "./ManagedEndpointProvider.ts";

const CLEANUP_OPERATION_TIMEOUT = "30 seconds";

function cleanupAttemptLost() {
  return new EnvironmentLinkRevokePersistenceError({
    cause: "Environment cleanup attempt ownership expired or was replaced.",
  });
}

/** Claims expired links and completes their external cleanup under an exclusive,
 * bounded database lease. Every destructive step revalidates the exact claim
 * generation and attempt token. Failed attempts release ownership for retry;
 * crashed attempts become retryable when their database lease expires. */
export function cleanupExpiredEnvironmentLinksWithToken(attemptToken: string) {
  return Effect.gen(function* () {
    const links = yield* EnvironmentLinks;
    const credentials = yield* EnvironmentCredentials;
    const endpoints = yield* ManagedEndpointProvider;

    yield* links.claimExpired();
    const attempts = yield* links.acquireCleanupAttempts({ attemptToken });

    const ensureOwnership = (attempt: EnvironmentCleanupAttempt) =>
      links
        .ownsCleanupAttempt(attempt)
        .pipe(Effect.filterOrFail((owned) => owned, cleanupAttemptLost));

    yield* Effect.forEach(
      attempts,
      (attempt) => {
        const cleanup = Effect.gen(function* () {
          yield* ensureOwnership(attempt);
          yield* endpoints
            .deprovision({
              userId: attempt.userId,
              environmentId: attempt.environmentId,
              ...(attempt.managedEndpointAllocationId === null
                ? {}
                : { allocationId: attempt.managedEndpointAllocationId }),
            })
            .pipe(Effect.timeout(CLEANUP_OPERATION_TIMEOUT));

          yield* ensureOwnership(attempt);
          yield* credentials
            .revokeForEnvironmentPublicKey({
              environmentId: attempt.environmentId,
              environmentPublicKey: attempt.environmentPublicKey,
            })
            .pipe(
              Effect.timeout(CLEANUP_OPERATION_TIMEOUT),
              Effect.filterOrFail(
                (cleaned) => cleaned,
                () =>
                  new EnvironmentCredentialRevokePersistenceError({
                    cause: "Credential remains protected by an active environment link.",
                  }),
              ),
            );

          yield* ensureOwnership(attempt);
          yield* links
            .completeCleanupAttempt(attempt)
            .pipe(Effect.filterOrFail((completed) => completed, cleanupAttemptLost));
        });

        return cleanup.pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? links.releaseCleanupAttempt(attempt).pipe(Effect.ignore)
              : Effect.void,
          ),
          Effect.catchCause((cause) =>
            Effect.logWarning("Expired environment cleanup was incomplete", {
              environmentId: attempt.environmentId,
              cause,
            }),
          ),
        );
      },
      { concurrency: 4 },
    );
  });
}

export const cleanupExpiredEnvironmentLinks = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const attemptToken = yield* crypto.randomUUIDv4;
  return yield* cleanupExpiredEnvironmentLinksWithToken(attemptToken);
});
