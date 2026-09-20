import {
  RelayApi,
  RelayAuthInvalidError,
  RelayClientPrincipal,
  RelayEnvironmentPrincipal,
  RelayInternalError,
  RelayLinearOAuthNotConfiguredError,
  RelayLinearOAuthReauthorizationRequiredError,
} from "@kata-sh/code-contracts/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiError from "effect/unstable/httpapi/HttpApiError";

import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LinearOAuth from "../linear/LinearOAuth.ts";
import * as LinearOAuthBroker from "../linear/LinearOAuthBroker.ts";
import { mapErrorTags, mapRelayCommonApiErrors, safeAuthFailureReason } from "./Api.ts";

const notConfigured = (_error: LinearOAuth.LinearOAuthNotConfigured, traceId: string) =>
  new RelayLinearOAuthNotConfiguredError({ code: "linear_oauth_not_configured", traceId });

const notAuthorized = (_error: unknown, traceId: string) =>
  new RelayAuthInvalidError({ code: "auth_invalid", reason: "not_authorized", traceId });

const internalError = (_error: unknown, traceId: string) =>
  new RelayInternalError({ code: "internal_error", reason: "internal_error", traceId });

const upstreamUnavailable = (_error: unknown, traceId: string) =>
  new RelayInternalError({ code: "internal_error", reason: "upstream_unavailable", traceId });

export const linearClientApi = HttpApiBuilder.group(
  RelayApi,
  "linearClient",
  Effect.fnUntraced(function* (handlers) {
    const broker = yield* LinearOAuthBroker.LinearOAuthBroker;
    return handlers
      .handle(
        "linearOAuthStart",
        Effect.fn("relay.api.linearClient.linearOAuthStart")(
          function* (args) {
            const { userId } = yield* RelayClientPrincipal;
            return { authorizeUrl: yield* broker.begin({ userId, ...args.payload }) };
          },
          mapErrorTags({
            LinearOAuthNotConfigured: notConfigured,
            LinearOAuthEnvironmentNotLinked: notAuthorized,
            PlatformError: internalError,
          }),
          mapRelayCommonApiErrors("not_authorized"),
        ),
      )
      .handle(
        "linearOAuthRevoke",
        Effect.fn("relay.api.linearClient.linearOAuthRevoke")(
          function* (args) {
            const { userId } = yield* RelayClientPrincipal;
            const result = yield* broker.revoke({ userId, ...args.payload });
            return { ok: result !== "owner-mismatch" };
          },
          mapErrorTags({
            LinearOAuthNotConfigured: notConfigured,
            LinearOAuthRequestFailed: upstreamUnavailable,
          }),
          mapRelayCommonApiErrors("not_authorized"),
        ),
      );
  }),
);

export const linearServerApi = HttpApiBuilder.group(
  RelayApi,
  "linearServer",
  Effect.fnUntraced(function* (handlers) {
    const broker = yield* LinearOAuthBroker.LinearOAuthBroker;
    const links = yield* EnvironmentLinks.EnvironmentLinks;
    return handlers
      .handle(
        "linearOAuthStart",
        Effect.fn("relay.api.linearServer.linearOAuthStart")(
          function* (args) {
            const principal = yield* RelayEnvironmentPrincipal;
            if (principal.environmentId !== args.params.environmentId) {
              return yield* new HttpApiError.Unauthorized({});
            }
            const link = yield* links.getForUser({
              userId: args.payload.userId,
              environmentId: args.params.environmentId,
            });
            if (link?.environmentPublicKey !== principal.environmentPublicKey) {
              return yield* new HttpApiError.Unauthorized({});
            }
            return {
              authorizeUrl: yield* broker.begin({
                userId: args.payload.userId,
                environmentId: args.params.environmentId,
                connectionId: args.payload.connectionId,
              }),
            };
          },
          mapErrorTags({
            EnvironmentLinkLookupPersistenceError: internalError,
            LinearOAuthNotConfigured: notConfigured,
            LinearOAuthEnvironmentNotLinked: notAuthorized,
            PlatformError: internalError,
          }),
          mapRelayCommonApiErrors("not_authorized"),
        ),
      )
      .handle(
        "linearOAuthRefresh",
        Effect.fn("relay.api.linearServer.linearOAuthRefresh")(
          function* (args) {
            const principal = yield* RelayEnvironmentPrincipal;
            if (principal.environmentId !== args.params.environmentId) {
              return yield* new HttpApiError.Unauthorized({});
            }
            return yield* broker.refresh({
              environmentId: args.params.environmentId,
              connectionId: args.payload.connectionId,
            });
          },
          mapErrorTags({
            LinearOAuthNotConfigured: notConfigured,
            LinearOAuthConnectionNotFound: notAuthorized,
            LinearOAuthRequestFailed: (error, traceId) =>
              error.reason === "rejected"
                ? new RelayLinearOAuthReauthorizationRequiredError({
                    code: "linear_oauth_reauthorization_required",
                    traceId,
                  })
                : upstreamUnavailable(error, traceId),
          }),
          mapRelayCommonApiErrors("not_authorized"),
        ),
      );
  }),
);

// Every message is fixed text; the one interpolated value passes through
// `safeAuthFailureReason`, which admits no HTML-significant character.
const callbackPage = (status: number, message: string) =>
  Effect.succeed(
    HttpServerResponse.setStatus(
      HttpServerResponse.html(
        `<!doctype html><html><head><meta charset="utf-8"><title>Kata Code</title></head><body><p>${message}</p></body></html>`,
      ),
      status,
    ),
  );

// This link is single use, so every recovery starts a new authorization.
const RETRY_MESSAGE =
  "Could not complete the Linear connection. Connect Linear again from Kata Code.";

/**
 * Exported as an effect, not a route: the worker provides the runtime layer
 * inside the handler so the route layer carries no requirements that a
 * plain-route `Layer.provide` can silently drop.
 */
export const relayLinearOAuthCallbackHandler = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) {
    return yield* callbackPage(400, "This Linear authorization link is invalid.");
  }
  const params = url.value.searchParams;
  const rejection = params.get("error");
  if (rejection !== null) {
    return yield* callbackPage(
      400,
      `Linear rejected the authorization (${safeAuthFailureReason(rejection)}).`,
    );
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return yield* callbackPage(400, "This Linear authorization link is missing its code or state.");
  }
  const broker = yield* LinearOAuthBroker.LinearOAuthBroker;
  return yield* broker.complete({ code, state }).pipe(
    Effect.andThen(
      callbackPage(200, "Kata Code is connected to Linear. You can close this window."),
    ),
    Effect.catchTags({
      LinearOAuthStateRejected: () =>
        callbackPage(400, "This Linear authorization link is invalid, expired, or already used."),
      LinearOAuthNotConfigured: () =>
        callbackPage(503, "Kata Code Connect is not configured to connect to Linear."),
      LinearOAuthRequestFailed: (error) =>
        error.reason === "rejected"
          ? callbackPage(400, "Linear rejected the authorization request.")
          : callbackPage(
              502,
              "Could not reach Linear to finish connecting. Connect Linear again from Kata Code.",
            ),
      LinearOAuthDeliveryFailed: () =>
        callbackPage(
          502,
          "Kata Code could not reach the environment, so Linear was not connected. Check that the environment is online, then connect Linear again from Kata Code.",
        ),
      LinearOAuthStateConsumePersistenceError: () => callbackPage(500, RETRY_MESSAGE),
      LinearTokenLookupPersistenceError: () => callbackPage(500, RETRY_MESSAGE),
      LinearTokenSavePersistenceError: () => callbackPage(500, RETRY_MESSAGE),
    }),
  );
});
