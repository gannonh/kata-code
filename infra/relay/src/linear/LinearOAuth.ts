import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { normalizeRelayIssuer } from "@kata-sh/code-shared/relayJwt";

import * as RelayConfiguration from "../Config.ts";

export const LINEAR_AUTHORIZE_URL = "https://linear.app/oauth/authorize";
export const LINEAR_TOKEN_ENDPOINT = "https://api.linear.app/oauth/token";
export const LINEAR_OAUTH_SCOPES = "read,admin";
export const LINEAR_OAUTH_CALLBACK_PATH = "/v1/oauth/linear/callback";

export const linearOAuthRedirectUri = (relayIssuer: string): string =>
  `${normalizeRelayIssuer(relayIssuer)}${LINEAR_OAUTH_CALLBACK_PATH}`;

export function buildLinearAuthorizeUrl(input: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}): string {
  const url = new URL(LINEAR_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", LINEAR_OAUTH_SCOPES);
  url.searchParams.set("actor", "application");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface LinearTokenBundle {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
  readonly scope: string;
}

export class LinearOAuthRejected extends Schema.TaggedError<LinearOAuthRejected>()(
  "linear_oauth_rejected",
  { message: Schema.String },
) {}

export class LinearOAuthUnavailable extends Schema.TaggedError<LinearOAuthUnavailable>()(
  "linear_oauth_unavailable",
  { message: Schema.String },
) {}

export class LinearOAuthInvalidResponse extends Schema.TaggedError<LinearOAuthInvalidResponse>()(
  "linear_oauth_invalid_response",
  { message: Schema.String },
) {}

export type LinearOAuthError =
  | LinearOAuthRejected
  | LinearOAuthUnavailable
  | LinearOAuthInvalidResponse;

export class LinearOAuthNotConfigured extends Schema.TaggedError<LinearOAuthNotConfigured>()(
  "linear_oauth_not_configured",
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

export function makeLinearOAuth(dependencies: {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly fetch: typeof fetch;
}): {
  readonly exchangeCode: (input: {
    code: string;
    codeVerifier: string;
  }) => Effect.Effect<LinearTokenBundle, LinearOAuthError>;
  readonly refresh: (input: {
    refreshToken: string;
  }) => Effect.Effect<LinearTokenBundle, LinearOAuthError>;
} {
  const formFor = (grant: TokenGrant): URLSearchParams => {
    const form = new URLSearchParams();
    form.set("client_id", dependencies.clientId);
    form.set("client_secret", dependencies.clientSecret);
    switch (grant.grantType) {
      case "authorization_code":
        form.set("grant_type", "authorization_code");
        form.set("code", grant.code);
        form.set("redirect_uri", dependencies.redirectUri);
        form.set("code_verifier", grant.codeVerifier);
        return form;
      case "refresh_token":
        form.set("grant_type", "refresh_token");
        form.set("refresh_token", grant.refreshToken);
        return form;
    }
  };

  const requestToken = (
    grant: TokenGrant,
    previousRefreshToken: string,
  ): Effect.Effect<LinearTokenBundle, LinearOAuthError> =>
    Effect.gen(function* () {
      const operation =
        grant.grantType === "authorization_code" ? "code exchange" : "token refresh";
      const response = yield* Effect.tryPromise({
        try: () =>
          dependencies.fetch(LINEAR_TOKEN_ENDPOINT, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: formFor(grant).toString(),
          }),
        catch: () =>
          new LinearOAuthUnavailable({
            message: `Linear OAuth ${operation} request failed before receiving a response`,
          }),
      });
      if (response.status >= 500) {
        return yield* new LinearOAuthUnavailable({
          message: `Linear OAuth ${operation} is unavailable (status ${response.status})`,
        });
      }
      if (!response.ok) {
        return yield* new LinearOAuthRejected({
          message: `Linear OAuth ${operation} was rejected (status ${response.status})`,
        });
      }
      const payload = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        catch: () =>
          new LinearOAuthInvalidResponse({
            message: `Linear OAuth ${operation} returned a non-JSON response`,
          }),
      });
      const decoded = yield* Schema.decodeUnknownEffect(LinearTokenResponse)(payload).pipe(
        Effect.mapError(
          () =>
            new LinearOAuthInvalidResponse({
              message: `Linear OAuth ${operation} returned an invalid token response`,
            }),
        ),
      );
      const now = yield* DateTime.now;
      return {
        accessToken: decoded.access_token,
        refreshToken: decoded.refresh_token ?? previousRefreshToken,
        expiresAt: now.epochMilliseconds + decoded.expires_in * 1_000,
        scope: decoded.scope ?? "",
      };
    });

  return {
    exchangeCode: (input) =>
      requestToken(
        { grantType: "authorization_code", code: input.code, codeVerifier: input.codeVerifier },
        "",
      ),
    refresh: (input) =>
      requestToken(
        { grantType: "refresh_token", refreshToken: input.refreshToken },
        input.refreshToken,
      ),
  };
}

export class LinearOAuth extends Context.Service<
  LinearOAuth,
  {
    readonly exchangeCode: (input: {
      readonly code: string;
      readonly codeVerifier: string;
    }) => Effect.Effect<LinearTokenBundle, LinearOAuthError | LinearOAuthNotConfigured>;
    readonly refresh: (input: {
      readonly refreshToken: string;
    }) => Effect.Effect<LinearTokenBundle, LinearOAuthError | LinearOAuthNotConfigured>;
  }
>()("kata-code-relay/linear/LinearOAuth") {}

export const layer = Layer.effect(
  LinearOAuth,
  Effect.gen(function* () {
    const settings = yield* RelayConfiguration.RelayConfiguration;
    const configured = settings.linearOAuth;
    if (!configured) {
      return LinearOAuth.of({
        exchangeCode: () => Effect.fail(new LinearOAuthNotConfigured()),
        refresh: () => Effect.fail(new LinearOAuthNotConfigured()),
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
