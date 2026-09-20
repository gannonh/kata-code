import type { RelayLinearAccessToken } from "@kata-sh/code-contracts/relay";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as EnvironmentConnector from "../environments/EnvironmentConnector.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LinearOAuth from "./LinearOAuth.ts";
import * as LinearOAuthStates from "./LinearOAuthStates.ts";
import * as LinearTokens from "./LinearTokens.ts";

export class LinearOAuthEnvironmentNotLinked extends Schema.TaggedError<LinearOAuthEnvironmentNotLinked>()(
  "LinearOAuthEnvironmentNotLinked",
  { environmentId: Schema.String },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' is not linked to this user`;
  }
}

export class LinearOAuthConnectionNotFound extends Schema.TaggedError<LinearOAuthConnectionNotFound>()(
  "LinearOAuthConnectionNotFound",
  { environmentId: Schema.String, connectionId: Schema.String },
) {
  override get message(): string {
    return `No Linear authorization is stored for connection '${this.connectionId}'`;
  }
}

/**
 * The environment did not accept the delivered token. The grant is revoked
 * and discarded before this fails, so no token is left that nobody holds.
 */
export class LinearOAuthDeliveryFailed extends Schema.TaggedError<LinearOAuthDeliveryFailed>()(
  "LinearOAuthDeliveryFailed",
  { environmentId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not deliver the Linear authorization to environment '${this.environmentId}'`;
  }
}

type Connection = {
  readonly userId: string;
  readonly environmentId: string;
  readonly connectionId: string;
};

type LinearOAuthFailure =
  | LinearOAuth.LinearOAuthRequestFailed
  | LinearOAuth.LinearOAuthNotConfigured;
export type LinearOAuthRevokeResult = "revoked" | "absent" | "owner-mismatch";

export class LinearOAuthBroker extends Context.Service<
  LinearOAuthBroker,
  {
    /** Creates single-use PKCE state for a linked environment and returns the authorize URL. */
    readonly begin: (
      input: Connection,
    ) => Effect.Effect<
      string,
      | LinearOAuth.LinearOAuthNotConfigured
      | LinearOAuthEnvironmentNotLinked
      | EnvironmentLinks.EnvironmentLinkLookupPersistenceError
      | LinearOAuthStates.LinearOAuthStateCreatePersistenceError
      | PlatformError.PlatformError
    >;
    /** Consumes the state, exchanges the code, stores the bundle, and delivers the access token. */
    readonly complete: (input: {
      readonly code: string;
      readonly state: string;
    }) => Effect.Effect<
      void,
      | LinearOAuthFailure
      | LinearOAuthStates.LinearOAuthStateRejected
      | LinearOAuthStates.LinearOAuthStateConsumePersistenceError
      | LinearTokens.LinearTokenLookupPersistenceError
      | LinearTokens.LinearTokenSavePersistenceError
      | LinearOAuthDeliveryFailed
    >;
    /** Rotates the stored grant and returns only the access token. */
    readonly refresh: (
      input: Omit<Connection, "userId">,
    ) => Effect.Effect<
      RelayLinearAccessToken,
      | LinearOAuthFailure
      | LinearOAuthConnectionNotFound
      | LinearTokens.LinearTokenLookupPersistenceError
      | LinearTokens.LinearTokenSavePersistenceError
    >;
    /** Discards the stored bundle and ends the grant at Linear. */
    readonly revoke: (
      input: Connection,
    ) => Effect.Effect<
      LinearOAuthRevokeResult,
      | LinearOAuthFailure
      | LinearTokens.LinearTokenLookupPersistenceError
      | LinearTokens.LinearTokenDeletePersistenceError
    >;
    /** Discards and revokes every bundle the user authorized for an environment. */
    readonly revokeForEnvironment: (
      input: Omit<Connection, "connectionId">,
    ) => Effect.Effect<void, LinearTokens.LinearTokenDeletePersistenceError>;
  }
>()("kata-code-relay/linear/LinearOAuthBroker") {}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const links = yield* EnvironmentLinks.EnvironmentLinks;
  const oauth = yield* LinearOAuth.LinearOAuth;
  const states = yield* LinearOAuthStates.LinearOAuthStates;
  const tokens = yield* LinearTokens.LinearTokens;
  const connector = yield* EnvironmentConnector.EnvironmentConnector;

  // The row is already gone, so a failed revocation cannot be retried from
  // stored state. Record it; Linear expires the access token on its own.
  const revokeDiscarded = (bundle: LinearOAuth.LinearTokenBundle & Connection) =>
    oauth.revoke(bundle).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Linear OAuth grant was discarded without revocation", {
          environmentId: bundle.environmentId,
          connectionId: bundle.connectionId,
          reason: error._tag === "LinearOAuthRequestFailed" ? error.reason : error._tag,
        }),
      ),
    );

  return LinearOAuthBroker.of({
    begin: Effect.fn("relay.linear_oauth_broker.begin")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      yield* oauth.ensureConfigured;
      const link = yield* links.getForUser(input);
      if (link === null) {
        return yield* new LinearOAuthEnvironmentNotLinked({ environmentId: input.environmentId });
      }
      const codeVerifier = Encoding.encodeBase64Url(yield* crypto.randomBytes(32));
      const codeChallenge = Encoding.encodeBase64Url(
        yield* crypto.digest("SHA-256", new TextEncoder().encode(codeVerifier)),
      );
      const { state } = yield* states.create({
        ...input,
        codeVerifier,
        now: yield* DateTime.now,
      });
      return yield* oauth.authorizeUrl({ state, codeChallenge });
    }),

    complete: Effect.fn("relay.linear_oauth_broker.complete")(function* (input) {
      const binding = yield* states.consume({ state: input.state, now: yield* DateTime.now });
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": binding.environmentId });
      const bundle = yield* oauth.exchangeCode({
        code: input.code,
        codeVerifier: binding.codeVerifier,
      });
      const connection = {
        userId: binding.userId,
        environmentId: binding.environmentId,
        connectionId: binding.connectionId,
      };
      // Reauthorizing replaces the stored grant; end the one it replaces.
      const replaced = yield* tokens.get(connection);
      const discard = revokeDiscarded({ ...connection, ...bundle });
      yield* tokens.save({ ...connection, ...bundle }).pipe(Effect.tapError(() => discard));
      if (replaced !== null) {
        yield* revokeDiscarded(replaced);
      }
      const discardUndelivered = tokens
        .delete(connection)
        .pipe(Effect.ignore, Effect.andThen(discard));
      yield* connector
        .deliverLinearOAuth({
          ...connection,
          token: {
            accessToken: bundle.accessToken,
            expiresAt: bundle.expiresAt,
            scope: bundle.scope,
          },
        })
        .pipe(
          Effect.onInterrupt(() => discardUndelivered),
          Effect.catch((cause) =>
            discardUndelivered.pipe(
              Effect.andThen(
                Effect.fail(
                  new LinearOAuthDeliveryFailed({ environmentId: binding.environmentId, cause }),
                ),
              ),
            ),
          ),
        );
    }),

    refresh: Effect.fn("relay.linear_oauth_broker.refresh")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      const record = yield* tokens.get(input);
      if (record === null) {
        return yield* new LinearOAuthConnectionNotFound(input);
      }
      // Linear replays a rotation for 30 minutes, so overlapping refreshes of
      // one grant receive the same successor and the last save is correct.
      const refreshed = yield* oauth.refresh({ refreshToken: record.refreshToken });
      yield* tokens.save({ ...record, ...refreshed });
      return {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
        scope: refreshed.scope,
      };
    }),

    revoke: Effect.fn("relay.linear_oauth_broker.revoke")(function* (input) {
      yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
      const record = yield* tokens.get(input);
      if (record === null) return "absent";
      if (record.userId !== input.userId) return "owner-mismatch";
      // Revoke while the relay still holds the token, then discard it. A
      // failed revocation keeps the row so the caller can retry.
      yield* oauth.revoke(record);
      yield* tokens.delete(input);
      return "revoked";
    }),

    revokeForEnvironment: Effect.fn("relay.linear_oauth_broker.revoke_for_environment")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({ "relay.environment_id": input.environmentId });
        const discarded = yield* tokens.deleteForEnvironment(input);
        yield* Effect.forEach(discarded, revokeDiscarded, { discard: true });
      },
    ),
  });
});

export const layer = Layer.effect(LinearOAuthBroker, make);
