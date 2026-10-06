import { RelayProtectedError } from "@kata-sh/code-contracts/relay";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { isHttpClientError } from "effect/http/HttpClientError";

/**
 * A relay request that did not succeed. `unavailable` means it may succeed on
 * retry; the relay refused the other kinds. The description is safe to show:
 * it carries the relay's own explanation and trace ID, never request details.
 */
export class RelayRequestError extends Schema.TaggedError<RelayRequestError>()(
  "RelayRequestError",
  {
    rejection: Schema.Literals(["unauthorized", "forbidden", "rejected", "unavailable"]),
    description: Schema.String,
    /**
     * The relay refused the bearer credential itself (`invalid_bearer`), as
     * opposed to refusing a request the credential authenticated. Only an
     * `unauthorized` rejection sets it; credential refresh acts on it.
     */
    bearerRejected: Schema.optional(Schema.Boolean),
  },
) {
  override get message(): string {
    return this.description;
  }
}

const isRelayRequestError = Schema.is(RelayRequestError);

export function relayRequestError(cause: unknown): RelayRequestError {
  return isRelayRequestError(cause)
    ? cause
    : new RelayRequestError({
        rejection: "unavailable",
        description: `Could not complete the Kata Code Connect relay request. ${isHttpClientError(cause) ? `The relay request failed (${cause.reason._tag}).` : "The relay returned an unexpected response."} Check this machine's network connection and relay availability, then retry.`,
      });
}

/** Whether the relay refused the stored bearer credential itself (`invalid_bearer`). */
export const isRelayBearerRejected = (error: unknown): error is RelayRequestError =>
  isRelayRequestError(error) && error.rejection === "unauthorized" && error.bearerRejected === true;

/** Whether a failure may succeed on retry: anything but a relay refusal. */
export const shouldRetryRelayRequest = (error: unknown): boolean =>
  !isRelayRequestError(error) || error.rejection === "unavailable";

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

/** Preserve relay diagnostics before converting permanent rejections into non-retryable errors. */
export const filterRelayResponse = Effect.fn("cloud.filter_relay_response")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.status >= 200 && response.status < 300) return response;
  const decoded = yield* HttpClientResponse.schemaBodyJson(RelayProtectedError)(response).pipe(
    Effect.option,
  );
  const ray = response.headers["cf-ray"];
  const requestId = ray && /^[a-zA-Z0-9-]{1,128}$/.test(ray) ? ` Cloudflare Ray ID: ${ray}.` : "";
  const description = Option.isSome(decoded)
    ? `Kata Code Connect: ${decoded.value.message}. ${recoveryHint(decoded.value)} Trace ID: ${decoded.value.traceId}.`
    : `Kata Code Connect relay returned HTTP ${response.status} without a recognized error response. Check relay access and any proxy or firewall restrictions, then restart Kata Code.${requestId}`;

  if (response.status === 401) {
    const bearerRejected =
      Option.isSome(decoded) &&
      decoded.value._tag === "RelayAuthInvalidError" &&
      decoded.value.reason === "invalid_bearer";
    return yield* new RelayRequestError({
      rejection: "unauthorized",
      description,
      ...(bearerRejected ? { bearerRejected } : {}),
    });
  }
  if (response.status === 403) {
    return yield* new RelayRequestError({ rejection: "forbidden", description });
  }
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  ) {
    return yield* new RelayRequestError({ rejection: "rejected", description });
  }
  return yield* new RelayRequestError({ rejection: "unavailable", description });
});
