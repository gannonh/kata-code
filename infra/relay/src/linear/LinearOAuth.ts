import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { normalizeRelayIssuer } from "@kata-sh/code-shared/relayJwt";

import * as RelayConfiguration from "../Config.ts";

export const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
export const LINEAR_REVOKE_ENDPOINT = "https://api.linear.app/oauth/revoke";
// Below the relay request deadline, so a stalled Linear call fails as unavailable.
export const LINEAR_OAUTH_REQUEST_TIMEOUT_MS = 5_000;
export const LINEAR_OAUTH_SCOPES = "read,admin";
export const LINEAR_OAUTH_CALLBACK_PATH = "/v1/oauth/linear/callback";

const linearOAuthRedirectUri = (relayIssuer: string): string =>
  `${normalizeRelayIssuer(relayIssuer)}${LINEAR_OAUTH_CALLBACK_PATH}`;

export interface LinearTokenBundle {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope: string;
}

export class LinearOAuthRequestFailed extends Schema.TaggedError<LinearOAuthRequestFailed>()(
  "LinearOAuthRequestFailed",
  {
    operation: Schema.Literals(["code exchange", "token refresh", "token revocation"]),
    reason: Schema.Literals(["rejected", "unavailable", "invalid_response"]),
    status: Schema.optionalKey(Schema.Number),
  },
) {
  override get message(): string {
    return `Linear OAuth ${this.operation} failed as ${this.reason}${this.status === undefined ? "" : ` (status ${this.status})`}`;
  }
}

export class LinearOAuthNotConfigured extends Schema.TaggedError<LinearOAuthNotConfigured>()(
  "LinearOAuthNotConfigured",
  {},
) {
  override get message(): string {
    return "Linear OAuth is not configured on this relay";
  }
}

const LinearTokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optionalKey(Schema.String),
  expires_in: Schema.Finite,
  scope: Schema.optionalKey(Schema.String),
});

type TokenGrant =
  | {
      readonly grantType: "authorization_code";
      readonly code: string;
      readonly codeVerifier: string;
    }
  | { readonly grantType: "refresh_token"; readonly refreshToken: string };

export interface LinearOAuthShape {
  /** Fails when the relay holds no Linear client credentials, before any state is stored. */
  readonly ensureConfigured: Effect.Effect<void, LinearOAuthNotConfigured>;
  readonly authorizeUrl: (input: {
    readonly state: string;
    readonly codeChallenge: string;
  }) => Effect.Effect<string, LinearOAuthNotConfigured>;
  readonly exchangeCode: (input: {
    readonly code: string;
    readonly codeVerifier: string;
  }) => Effect.Effect<LinearTokenBundle, LinearOAuthRequestFailed | LinearOAuthNotConfigured>;
  readonly refresh: (input: {
    readonly refreshToken: string;
  }) => Effect.Effect<LinearTokenBundle, LinearOAuthRequestFailed | LinearOAuthNotConfigured>;
  /** Ends the grant at Linear. A token Linear no longer recognizes counts as revoked. */
  readonly revoke: (input: {
    readonly accessToken: string;
    readonly refreshToken: string;
  }) => Effect.Effect<void, LinearOAuthRequestFailed | LinearOAuthNotConfigured>;
}

export function makeLinearOAuth(dependencies: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly fetch: typeof fetch;
}): LinearOAuthShape {
  // workerd requires the ambient fetch receiver to stay undefined or globalThis.
  const executeFetch = dependencies.fetch;
  const post = (
    operation: LinearOAuthRequestFailed["operation"],
    endpoint: string,
    form: URLSearchParams,
  ) =>
    Effect.tryPromise({
      // The signal aborts the request when the relay deadline interrupts the handler.
      try: (signal) =>
        executeFetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: form.toString(),
          signal,
        }),
      catch: () => new LinearOAuthRequestFailed({ operation, reason: "unavailable" }),
    }).pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(LINEAR_OAUTH_REQUEST_TIMEOUT_MS),
        orElse: () =>
          Effect.fail(new LinearOAuthRequestFailed({ operation, reason: "unavailable" })),
      }),
      Effect.filterOrFail(
        (response) => response.status < 500,
        (response) =>
          new LinearOAuthRequestFailed({
            operation,
            reason: "unavailable",
            status: response.status,
          }),
      ),
    );

  const requestToken = (grant: TokenGrant) =>
    Effect.gen(function* () {
      const operation =
        grant.grantType === "authorization_code" ? "code exchange" : "token refresh";
      const form = new URLSearchParams({
        client_id: dependencies.clientId,
        client_secret: dependencies.clientSecret,
        grant_type: grant.grantType,
      });
      if (grant.grantType === "authorization_code") {
        form.set("code", grant.code);
        form.set("redirect_uri", dependencies.redirectUri);
        form.set("code_verifier", grant.codeVerifier);
      } else {
        form.set("refresh_token", grant.refreshToken);
      }
      const response = yield* post(operation, LINEAR_TOKEN_ENDPOINT, form);
      if (!response.ok) {
        return yield* new LinearOAuthRequestFailed({
          operation,
          reason: "rejected",
          status: response.status,
        });
      }
      const invalidResponse = () =>
        new LinearOAuthRequestFailed({ operation, reason: "invalid_response" });
      const payload = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: invalidResponse,
      });
      const decoded = yield* Schema.decodeUnknownEffect(LinearTokenResponse)(payload).pipe(
        Effect.mapError(invalidResponse),
      );
      // A refresh may omit the refresh token when Linear does not rotate it. A
      // code exchange without one leaves nothing to renew the grant with.
      const refreshToken =
        decoded.refresh_token ??
        (grant.grantType === "refresh_token" ? grant.refreshToken : undefined);
      if (!refreshToken) {
        return yield* invalidResponse();
      }
      const now = yield* DateTime.now;
      return {
        accessToken: decoded.access_token,
        refreshToken,
        expiresAt: now.epochMilliseconds + decoded.expires_in * 1_000,
        scope: decoded.scope ?? "",
      };
    });

  const revokeToken = (token: string, hint: "access_token" | "refresh_token") =>
    post(
      "token revocation",
      LINEAR_REVOKE_ENDPOINT,
      new URLSearchParams({ token, token_type_hint: hint }),
    ).pipe(
      // 400 means Linear could not revoke it, which includes already revoked.
      Effect.filterOrFail(
        (response) => response.ok || response.status === 400,
        (response) =>
          new LinearOAuthRequestFailed({
            operation: "token revocation",
            reason: "rejected",
            status: response.status,
          }),
      ),
      Effect.asVoid,
    );

  return {
    ensureConfigured: Effect.void,
    authorizeUrl: (input) =>
      Effect.sync(() => {
        const url = new URL(LINEAR_AUTHORIZE_URL);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", dependencies.clientId);
        url.searchParams.set("redirect_uri", dependencies.redirectUri);
        url.searchParams.set("scope", LINEAR_OAUTH_SCOPES);
        url.searchParams.set("actor", "user");
        url.searchParams.set("prompt", "consent");
        url.searchParams.set("state", input.state);
        url.searchParams.set("code_challenge", input.codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
        return url.toString();
      }),
    exchangeCode: (input) =>
      requestToken({
        grantType: "authorization_code",
        code: input.code,
        codeVerifier: input.codeVerifier,
      }),
    refresh: (input) =>
      requestToken({ grantType: "refresh_token", refreshToken: input.refreshToken }),
    revoke: (input) =>
      Effect.all(
        [
          revokeToken(input.refreshToken, "refresh_token"),
          revokeToken(input.accessToken, "access_token"),
        ],
        { discard: true },
      ),
  };
}

export class LinearOAuth extends Context.Service<LinearOAuth, LinearOAuthShape>()(
  "kata-code-relay/linear/LinearOAuth",
) {}

export const layer = Layer.effect(
  LinearOAuth,
  Effect.gen(function* () {
    const settings = yield* RelayConfiguration.RelayConfiguration;
    const configured = settings.linearOAuth;
    if (configured === null) {
      const notConfigured = () => Effect.fail(new LinearOAuthNotConfigured());
      return LinearOAuth.of({
        ensureConfigured: notConfigured(),
        authorizeUrl: notConfigured,
        exchangeCode: notConfigured,
        refresh: notConfigured,
        revoke: notConfigured,
      });
    }
    return LinearOAuth.of(
      makeLinearOAuth({
        clientId: configured.clientId,
        clientSecret: Redacted.value(configured.clientSecret),
        redirectUri: linearOAuthRedirectUri(settings.relayIssuer),
        fetch: globalThis.fetch,
      }),
    );
  }),
);
