import {
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
  EnvironmentHttpUnauthorizedError,
} from "@kata-sh/code-contracts";
import { RelayProtectedError } from "@kata-sh/code-contracts/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import { isHttpClientError } from "effect/unstable/http/HttpClientError";

const isRelayResponseError = Schema.is(
  Schema.Union([
    EnvironmentHttpBadRequestError,
    EnvironmentHttpForbiddenError,
    EnvironmentHttpInternalServerError,
    EnvironmentHttpUnauthorizedError,
  ]),
);

export function relayRequestError(cause: unknown) {
  return isRelayResponseError(cause)
    ? cause
    : new EnvironmentHttpInternalServerError({
        message: `Could not complete the Kata Code Connect relay request. ${isHttpClientError(cause) ? `The relay request failed (${cause.reason._tag}).` : "The relay returned an unexpected response."} Check this machine's network connection and relay availability, then retry.`,
      });
}

/**
 * The relay refused the bearer credential itself (`invalid_bearer`), as opposed
 * to refusing a request the credential authenticated. Server-local: callers
 * that do not act on the difference see it as EnvironmentHttpUnauthorizedError.
 */
export class RelayBearerRejectedError extends Schema.TaggedError<RelayBearerRejectedError>()(
  "RelayBearerRejectedError",
  { message: Schema.String },
) {}

export const isRelayBearerRejectedError = Schema.is(RelayBearerRejectedError);

export const rejectedBearerAsUnauthorized = (error: RelayBearerRejectedError) =>
  Effect.fail(new EnvironmentHttpUnauthorizedError({ message: error.message }));

const isPermanentCloudLinkError = Schema.is(
  Schema.Union([
    RelayBearerRejectedError,
    EnvironmentHttpBadRequestError,
    EnvironmentHttpForbiddenError,
    EnvironmentHttpUnauthorizedError,
    EnvironmentHttpConflictError,
  ]),
);

export const shouldRetryCloudLink = (error: unknown): boolean => !isPermanentCloudLinkError(error);

function recoveryHint(error: RelayProtectedError): string {
  switch (error._tag) {
    case "RelayEnvironmentLinkLimitExceededError":
      return "Unlink an unused environment in Kata Code Connect, then restart Kata Code on this machine.";
    case "RelayAuthInvalidError":
      return "Run `katacode connect login` to check this machine's authorization. If the stored credential was revoked, sign out with `katacode connect logout`, then run `katacode connect` again. Restart Kata Code after signing in.";
    case "RelayEnvironmentLinkProofExpiredError":
    case "RelayEnvironmentLinkProofInvalidError":
      return "Check this machine's date and time, update Kata Code, then restart it.";
    default:
      return "Retry when the relay is available. If this continues, include the trace ID when reporting it.";
  }
}

/** Like filterRelayResponse, but reports a rejected bearer credential as RelayBearerRejectedError. */
export const filterRelayResponseReportingRejectedBearer = Effect.fn("cloud.filter_relay_response")(
  function* (response: HttpClientResponse.HttpClientResponse) {
    if (response.status >= 200 && response.status < 300) return response;
    const decoded = yield* HttpClientResponse.schemaBodyJson(RelayProtectedError)(response).pipe(
      Effect.option,
    );
    const ray = response.headers["cf-ray"];
    const requestId = ray && /^[a-zA-Z0-9-]{1,128}$/.test(ray) ? ` Cloudflare Ray ID: ${ray}.` : "";
    const message = Option.isSome(decoded)
      ? `Kata Code Connect: ${decoded.value.message}. ${recoveryHint(decoded.value)} Trace ID: ${decoded.value.traceId}.`
      : `Kata Code Connect relay returned HTTP ${response.status} without a recognized error response. Check relay access and any proxy or firewall restrictions, then restart Kata Code.${requestId}`;

    if (response.status === 401) {
      return Option.isSome(decoded) &&
        decoded.value._tag === "RelayAuthInvalidError" &&
        decoded.value.reason === "invalid_bearer"
        ? yield* new RelayBearerRejectedError({ message })
        : yield* new EnvironmentHttpUnauthorizedError({ message });
    }
    if (response.status === 403) return yield* new EnvironmentHttpForbiddenError({ message });
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    ) {
      return yield* new EnvironmentHttpBadRequestError({ message });
    }
    return yield* new EnvironmentHttpInternalServerError({ message });
  },
);

/** Preserve relay diagnostics before converting permanent rejections into non-retryable errors. */
export const filterRelayResponse = (response: HttpClientResponse.HttpClientResponse) =>
  filterRelayResponseReportingRejectedBearer(response).pipe(
    Effect.catchTag("RelayBearerRejectedError", rejectedBearerAsUnauthorized),
  );
