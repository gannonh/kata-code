import { RoutineError, type EnvironmentId } from "@kata-sh/code-contracts";
import {
  RelayApi,
  RelayAuthInvalidError,
  RelayLinearOAuthNotConfiguredError,
  RelayLinearOAuthReauthorizationRequiredError,
} from "@kata-sh/code-contracts/relay";
import { normalizeSecureRelayUrl } from "@kata-sh/code-shared/relayUrl";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import { RELAY_ENVIRONMENT_CREDENTIAL_SECRET, RELAY_URL_SECRET } from "./config.ts";

export interface LinearOAuthRelayShape {
  /** Environment-authenticated: starts an authorization for this environment. */
  readonly start: (input: {
    readonly environmentId: EnvironmentId;
    readonly connectionId: string;
  }) => Effect.Effect<{ readonly authorizeUrl: string }, RoutineError>;
  /** Environment-authenticated: obtains a fresh access token; the relay keeps the refresh token. */
  readonly refresh: (input: {
    readonly environmentId: EnvironmentId;
    readonly connectionId: string;
  }) => Effect.Effect<
    { readonly accessToken: string; readonly expiresAt: number; readonly scope: string },
    RoutineError
  >;
  /** Client-authenticated: revokes the stored Linear authorization. */
  readonly revoke: (input: {
    readonly environmentId: EnvironmentId;
    readonly connectionId: string;
  }) => Effect.Effect<void, RoutineError>;
}

export interface LinearOAuthRelayDependencies {
  readonly httpClient: HttpClient.HttpClient;
  readonly relayUrl: Effect.Effect<Option.Option<string>>;
  readonly clientAccessToken: Effect.Effect<Option.Option<string>>;
  readonly environmentCredential: Effect.Effect<Option.Option<string>>;
}

export class LinearOAuthRelay extends Context.Service<LinearOAuthRelay, LinearOAuthRelayShape>()(
  "@kata-sh/code-cli/cloud/LinearOAuthRelay",
) {}

const blocked = (message: string): RoutineError => new RoutineError({ code: "blocked", message });

const UNLINKED = "This environment is not linked to Kata Code Connect. Link it, then try again.";
const INVALID_RELAY_URL =
  "The stored Kata Code Connect relay URL is invalid. Relink this environment, then try again.";
const MISSING_CLIENT_CREDENTIAL =
  "No Kata Code Connect cloud credential is stored. Run `katacode connect login`, then try again.";
const MISSING_ENVIRONMENT_CREDENTIAL =
  "This environment has no Kata Code Connect relay credential. Link the environment, then try again.";

const isRelayAuthInvalidError = Schema.is(RelayAuthInvalidError);
const isRelayLinearOAuthNotConfiguredError = Schema.is(RelayLinearOAuthNotConfiguredError);
const isRelayLinearOAuthReauthorizationRequiredError = Schema.is(
  RelayLinearOAuthReauthorizationRequiredError,
);

const relayFailure =
  (action: "authorize" | "refresh" | "revoke") =>
  (cause: unknown): RoutineError => {
    if (isRelayAuthInvalidError(cause)) {
      return blocked(
        action === "revoke"
          ? "Kata Code Connect rejected this machine's cloud authorization. Run `katacode connect login`, then try again."
          : "Kata Code Connect rejected this environment's relay credential. Relink this environment, then try again.",
      );
    }
    if (isRelayLinearOAuthReauthorizationRequiredError(cause)) {
      return blocked(
        "Linear no longer accepts this connection's authorization. Connect Linear again.",
      );
    }
    if (isRelayLinearOAuthNotConfiguredError(cause)) {
      return blocked(
        "Kata Code Connect is not configured for Linear OAuth. Contact Kata Code support.",
      );
    }
    return blocked(
      action === "authorize"
        ? "Could not reach Kata Code Connect to authorize Linear. Check this machine's network connection, then try again."
        : action === "refresh"
          ? "Could not reach Kata Code Connect to refresh the Linear token. Check this machine's network connection, then try again."
          : "Could not reach Kata Code Connect to revoke the Linear authorization. Check this machine's network connection, then try again.",
    );
  };

const requireValue = (value: Effect.Effect<Option.Option<string>>, missing: string) =>
  value.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(blocked(missing)),
        onSome: Effect.succeed,
      }),
    ),
  );

const requireRelayUrl = (value: Effect.Effect<Option.Option<string>>) =>
  value.pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(blocked(UNLINKED)),
        onSome: (url) => {
          const normalized = normalizeSecureRelayUrl(url);
          return normalized === null
            ? Effect.fail(blocked(INVALID_RELAY_URL))
            : Effect.succeed(normalized);
        },
      }),
    ),
  );

const makeRelayClient = (input: {
  readonly httpClient: HttpClient.HttpClient;
  readonly relayUrl: string;
  readonly authorization: string | null;
}) => {
  const httpClient =
    input.authorization === null
      ? input.httpClient
      : HttpClient.mapRequest(
          HttpClientRequest.setHeader("authorization", `Bearer ${input.authorization}`),
        )(input.httpClient);
  return HttpApiClient.makeWith(RelayApi, { httpClient, baseUrl: input.relayUrl });
};

export function makeLinearOAuthRelay(
  dependencies: LinearOAuthRelayDependencies,
): LinearOAuthRelayShape {
  const start: LinearOAuthRelayShape["start"] = Effect.fn("LinearOAuthRelay.start")(
    function* (input) {
      const relayUrl = yield* requireRelayUrl(dependencies.relayUrl);
      const credential = yield* requireValue(
        dependencies.environmentCredential,
        MISSING_ENVIRONMENT_CREDENTIAL,
      );
      const client = yield* makeRelayClient({
        httpClient: dependencies.httpClient,
        relayUrl,
        authorization: credential,
      });
      return yield* client.linearServer
        .linearOAuthStart({
          params: { environmentId: input.environmentId },
          payload: { connectionId: input.connectionId },
        })
        .pipe(Effect.mapError(relayFailure("authorize")));
    },
  );

  const refresh: LinearOAuthRelayShape["refresh"] = Effect.fn("LinearOAuthRelay.refresh")(
    function* (input) {
      const relayUrl = yield* requireRelayUrl(dependencies.relayUrl);
      const credential = yield* requireValue(
        dependencies.environmentCredential,
        MISSING_ENVIRONMENT_CREDENTIAL,
      );
      const client = yield* makeRelayClient({
        httpClient: dependencies.httpClient,
        relayUrl,
        authorization: credential,
      });
      return yield* client.linearServer
        .linearOAuthRefresh({
          params: { environmentId: input.environmentId },
          payload: { connectionId: input.connectionId },
        })
        .pipe(Effect.mapError(relayFailure("refresh")));
    },
  );

  const revoke: LinearOAuthRelayShape["revoke"] = Effect.fn("LinearOAuthRelay.revoke")(
    function* (input) {
      const relayUrl = yield* requireRelayUrl(dependencies.relayUrl);
      const accessToken = yield* requireValue(
        dependencies.clientAccessToken,
        MISSING_CLIENT_CREDENTIAL,
      );
      const client = yield* makeRelayClient({
        httpClient: dependencies.httpClient,
        relayUrl,
        authorization: null,
      });
      yield* client.linearClient
        .linearOAuthRevoke({
          headers: { authorization: `Bearer ${accessToken}` },
          payload: { environmentId: input.environmentId, connectionId: input.connectionId },
        })
        .pipe(Effect.mapError(relayFailure("revoke")));
    },
  );

  return { start, refresh, revoke };
}

const readSecretString = (
  secrets: ServerSecretStore.ServerSecretStore["Service"],
  name: string,
): Effect.Effect<Option.Option<string>> =>
  secrets.get(name).pipe(
    Effect.map(Option.map((bytes) => new TextDecoder().decode(bytes))),
    Effect.orElseSucceed(() => Option.none()),
  );

export const LinearOAuthRelayLive: Layer.Layer<
  LinearOAuthRelay,
  never,
  ServerSecretStore.ServerSecretStore | CliTokenManager.CloudCliTokenManager | HttpClient.HttpClient
> = Layer.effect(
  LinearOAuthRelay,
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const cliTokenManager = yield* CliTokenManager.CloudCliTokenManager;
    const httpClient = yield* HttpClient.HttpClient;
    return makeLinearOAuthRelay({
      httpClient,
      relayUrl: readSecretString(secrets, RELAY_URL_SECRET),
      clientAccessToken: cliTokenManager.getExisting.pipe(
        Effect.map(Option.map((token) => token.accessToken)),
        Effect.orElseSucceed(() => Option.none()),
      ),
      environmentCredential: readSecretString(secrets, RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
    });
  }),
);
