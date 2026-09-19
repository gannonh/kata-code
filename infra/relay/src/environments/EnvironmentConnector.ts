import {
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  EnvironmentHttpForbiddenError,
  EnvironmentHttpInternalServerError,
  EnvironmentHttpUnauthorizedError,
} from "@kata-sh/code-contracts";
import { makeEnvironmentHttpApiClient } from "@kata-sh/code-client-runtime/rpc";
import {
  RelayCloudEnvironmentHealthProofPayload,
  RelayCloudLinearOAuthDeliveryProofPayload,
  RelayEnvironmentHealthResponse,
  RelayEnvironmentHealthResponseProofPayload,
  RelayEnvironmentMintResponse,
  RelayEnvironmentMintResponseProofPayload,
  RelayCloudMintCredentialProofPayload,
  RelayEnvironmentConnectNotAuthorizedReason,
  type RelayEnvironmentConnectResponse,
  type RelayLinearAccessToken,
  type RelayEnvironmentStatusResponse,
} from "@kata-sh/code-contracts/relay";
import { wireEnvironmentIssuer } from "@kata-sh/code-contracts/wireIdentity";
import {
  normalizeRelayIssuer,
  RELAY_HEALTH_REQUEST_TYP,
  RELAY_HEALTH_RESPONSE_TYP,
  RELAY_LINEAR_OAUTH_DELIVERY_TYP,
  RELAY_MINT_REQUEST_TYP,
  RELAY_MINT_RESPONSE_TYP,
  signRelayJwt,
  verifyRelayJwt,
} from "@kata-sh/code-shared/relayJwt";
import { stableStringify } from "@kata-sh/code-shared/relaySigning";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientError from "effect/unstable/http/HttpClientError";

import * as EnvironmentLinks from "./EnvironmentLinks.ts";
import * as ManagedEndpointAllocations from "./ManagedEndpointAllocations.ts";
import * as RelayConfiguration from "../Config.ts";
import { isManagedEndpointHostname } from "../deploymentConfig.ts";

function environmentConnectNotAuthorizedReasonMessage(
  reason: RelayEnvironmentConnectNotAuthorizedReason,
): string {
  switch (reason) {
    case "client_proof_key_thumbprint_missing":
      return "the client proof key thumbprint is missing";
    case "environment_link_not_found":
      return "no active environment link was found";
    case "endpoint_provider_not_managed":
      return "the linked endpoint is not relay-managed";
    case "managed_endpoint_allocation_not_found":
      return "no managed endpoint allocation was found";
    case "managed_endpoint_base_domain_not_configured":
      return "the managed endpoint base domain is not configured";
    case "managed_endpoint_allocation_not_ready":
      return "the managed endpoint allocation is incomplete";
    case "managed_endpoint_hostname_invalid":
      return "the managed endpoint hostname is invalid";
    case "managed_endpoint_mismatch":
      return "the linked endpoint does not match its managed allocation";
  }
}

const EnvironmentConnectorOperation = Schema.Literals([
  "connect",
  "status",
  "linear-oauth-delivery",
]);
type EnvironmentConnectorOperation = typeof EnvironmentConnectorOperation.Type;

export class EnvironmentConnectNotAuthorized extends Schema.TaggedError<EnvironmentConnectNotAuthorized>()(
  "EnvironmentConnectNotAuthorized",
  {
    environmentId: Schema.String,
    operation: EnvironmentConnectorOperation,
    reason: RelayEnvironmentConnectNotAuthorizedReason,
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' is not authorized for ${this.operation}: ${environmentConnectNotAuthorizedReasonMessage(this.reason)}`;
  }
}

export class EnvironmentMintRequestFailed extends Schema.TaggedError<EnvironmentMintRequestFailed>()(
  "EnvironmentMintRequestFailed",
  {
    environmentId: Schema.String,
    operation: EnvironmentConnectorOperation,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' ${this.operation} request failed`;
  }
}

export class EnvironmentMintRequestTimedOut extends Schema.TaggedError<EnvironmentMintRequestTimedOut>()(
  "EnvironmentMintRequestTimedOut",
  {
    environmentId: Schema.String,
    timeoutMs: Schema.Number,
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' mint request timed out after ${this.timeoutMs}ms`;
  }
}

export class EnvironmentMintResponseInvalid extends Schema.TaggedError<EnvironmentMintResponseInvalid>()(
  "EnvironmentMintResponseInvalid",
  {
    environmentId: Schema.String,
    operation: EnvironmentConnectorOperation,
  },
) {
  override get message(): string {
    return `Environment '${this.environmentId}' returned an invalid ${this.operation} response`;
  }
}

export type EnvironmentConnectorError =
  | EnvironmentConnectNotAuthorized
  | EnvironmentMintRequestFailed
  | EnvironmentMintRequestTimedOut
  | EnvironmentMintResponseInvalid
  | EnvironmentLinks.EnvironmentLinkLookupPersistenceError
  | ManagedEndpointAllocations.ManagedEndpointAllocationPersistenceError;

export const ENVIRONMENT_MINT_REQUEST_TIMEOUT_MS = 10_000;
// A delivery runs inside the browser's callback request, after the Linear code
// exchange, so it must fail well inside the relay request deadline.
export const LINEAR_OAUTH_DELIVERY_TIMEOUT_MS = 5_000;
const ENVIRONMENT_HEALTH_CLOCK_SKEW_MILLIS = 60 * 1_000;

export class EnvironmentConnector extends Context.Service<
  EnvironmentConnector,
  {
    readonly connect: (input: {
      readonly userId: string;
      readonly environmentId: string;
      readonly clientProofKeyThumbprint: string;
      readonly deviceId?: string;
    }) => Effect.Effect<RelayEnvironmentConnectResponse, EnvironmentConnectorError>;
    readonly status: (input: {
      readonly userId: string;
      readonly environmentId: string;
    }) => Effect.Effect<RelayEnvironmentStatusResponse, EnvironmentConnectorError>;
    readonly deliverLinearOAuth: (input: {
      readonly userId: string;
      readonly environmentId: string;
      readonly connectionId: string;
      readonly token: RelayLinearAccessToken;
    }) => Effect.Effect<void, EnvironmentConnectorError>;
  }
>()("kata-code-relay/environments/EnvironmentConnector") {}

const decodeMintResponseProof = Schema.decodeUnknownEffect(
  RelayEnvironmentMintResponseProofPayload,
);
const decodeHealthResponseProof = Schema.decodeUnknownEffect(
  RelayEnvironmentHealthResponseProofPayload,
);
const isEnvironmentHealthError = Schema.is(
  Schema.Union([
    EnvironmentHttpBadRequestError,
    EnvironmentHttpUnauthorizedError,
    EnvironmentHttpForbiddenError,
    EnvironmentHttpConflictError,
    EnvironmentHttpInternalServerError,
  ]),
);

function environmentHealthRequestFailureMessage(cause: unknown): string {
  return isEnvironmentHealthError(cause)
    ? `Managed endpoint health request failed: ${cause.message}`
    : "Managed endpoint health request failed.";
}

function environmentHealthRequestFailureReason(cause: unknown): string {
  if (isEnvironmentHealthError(cause)) {
    return cause._tag;
  }
  if (HttpClientError.isHttpClientError(cause)) {
    return cause.reason._tag;
  }
  if (Schema.isSchemaError(cause)) {
    return "SchemaError";
  }
  return cause instanceof Error && cause.name ? cause.name : "Unknown";
}

const currentTraceId = Effect.currentSpan.pipe(
  Effect.map((span) => span.traceId),
  Effect.orElseSucceed(() => "unavailable"),
);

const withoutRedirects = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }));

const verifyWithEnvironmentKeys = Effect.fnUntraced(function* <A, E>(input: {
  readonly token: string;
  readonly typ: string;
  readonly issuer: string;
  readonly audience: string;
  readonly nowEpochSeconds: number;
  readonly environmentPublicKeys: ReadonlyArray<string>;
  readonly decodePayload: (input: unknown) => Effect.Effect<A, E>;
}) {
  const { decodePayload, ...rest } = input;
  for (const publicKey of input.environmentPublicKeys) {
    const proof = yield* verifyRelayJwt({ ...rest, publicKey }).pipe(
      Effect.flatMap(decodePayload),
      Effect.option,
    );
    if (Option.isSome(proof)) {
      return proof.value;
    }
    // A linked environment can have rotated keys; try the remaining active keys.
  }
  return null;
});

function verifyEnvironmentResponse(input: {
  readonly response: RelayEnvironmentMintResponse;
  readonly environmentId: string;
  readonly requestNonce: string;
  readonly clientProofKeyThumbprint: string;
  readonly environmentPublicKeys: ReadonlyArray<string>;
  readonly relayIssuer: string;
  readonly nowEpochSeconds: number;
}) {
  return verifyWithEnvironmentKeys({
    token: input.response.proof,
    typ: RELAY_MINT_RESPONSE_TYP,
    issuer: wireEnvironmentIssuer(input.environmentId),
    audience: normalizeRelayIssuer(input.relayIssuer),
    nowEpochSeconds: input.nowEpochSeconds,
    environmentPublicKeys: input.environmentPublicKeys,
    decodePayload: decodeMintResponseProof,
  }).pipe(
    Effect.map(
      (proof) =>
        proof !== null &&
        proof.environmentId === input.environmentId &&
        proof.requestNonce === input.requestNonce &&
        proof.clientProofKeyThumbprint === input.clientProofKeyThumbprint &&
        proof.credential === input.response.credential &&
        Option.match(DateTime.make(input.response.expiresAt), {
          onNone: () => false,
          onSome: (expiresAt) => Math.floor(expiresAt.epochMilliseconds / 1_000) === proof.exp,
        }),
    ),
  );
}

function verifyEnvironmentHealthResponse(input: {
  readonly response: RelayEnvironmentHealthResponse;
  readonly environmentId: string;
  readonly requestNonce: string;
  readonly requestIssuedAt: DateTime.DateTime;
  readonly environmentPublicKeys: ReadonlyArray<string>;
  readonly relayIssuer: string;
  readonly now: DateTime.DateTime;
}) {
  return verifyWithEnvironmentKeys({
    token: input.response.proof,
    typ: RELAY_HEALTH_RESPONSE_TYP,
    issuer: wireEnvironmentIssuer(input.environmentId),
    audience: normalizeRelayIssuer(input.relayIssuer),
    nowEpochSeconds: Math.floor(input.now.epochMilliseconds / 1_000),
    environmentPublicKeys: input.environmentPublicKeys,
    decodePayload: decodeHealthResponseProof,
  }).pipe(
    Effect.map((proof) => {
      if (
        proof === null ||
        input.response.environmentId !== input.environmentId ||
        proof.environmentId !== input.environmentId ||
        proof.requestNonce !== input.requestNonce ||
        proof.status !== input.response.status ||
        proof.checkedAt !== input.response.checkedAt ||
        stableStringify(proof.descriptor) !== stableStringify(input.response.descriptor)
      ) {
        return false;
      }
      const checkedAt = DateTime.make(input.response.checkedAt);
      if (Option.isNone(checkedAt)) {
        return false;
      }
      return (
        checkedAt.value.epochMilliseconds >=
          input.requestIssuedAt.epochMilliseconds - ENVIRONMENT_HEALTH_CLOCK_SKEW_MILLIS &&
        checkedAt.value.epochMilliseconds <=
          input.now.epochMilliseconds + ENVIRONMENT_HEALTH_CLOCK_SKEW_MILLIS
      );
    }),
  );
}

const make = Effect.gen(function* () {
  const links = yield* EnvironmentLinks.EnvironmentLinks;
  const allocations = yield* ManagedEndpointAllocations.ManagedEndpointAllocations;
  const settings = yield* RelayConfiguration.RelayConfiguration;
  const httpClient = yield* HttpClient.HttpClient;
  const crypto = yield* Crypto.Crypto;
  const relayIssuer = normalizeRelayIssuer(settings.relayIssuer);
  const makeEnvironmentClient = (httpBaseUrl: string) =>
    makeEnvironmentHttpApiClient(httpBaseUrl).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );
  const resolveManagedEndpoint = Effect.fn("relay.environment_connector.resolve_managed_endpoint")(
    function* (input: {
      readonly operation: EnvironmentConnectorOperation;
      readonly link: EnvironmentLinks.RelayLinkedEnvironmentRecord;
      readonly allocation: ManagedEndpointAllocations.ManagedEndpointAllocation | null;
    }) {
      if (input.link.endpoint.providerKind !== "cloudflare_tunnel") {
        yield* Effect.annotateCurrentSpan({
          "relay.authorization.endpoint_provider_kind": input.link.endpoint.providerKind,
        });
        return yield* new EnvironmentConnectNotAuthorized({
          environmentId: input.link.environmentId,
          operation: input.operation,
          reason: "endpoint_provider_not_managed",
        });
      }
      if (!input.allocation) {
        return yield* new EnvironmentConnectNotAuthorized({
          environmentId: input.link.environmentId,
          operation: input.operation,
          reason: "managed_endpoint_allocation_not_found",
        });
      }
      const allocationAttributes = {
        "relay.authorization.allocation_hostname": input.allocation.hostname,
        "relay.authorization.allocation_has_ready_at": input.allocation.readyAt !== null,
        "relay.authorization.allocation_has_tunnel_id": input.allocation.tunnelId !== null,
        "relay.authorization.allocation_has_dns_record_id": input.allocation.dnsRecordId !== null,
      } as const;
      if (!settings.managedEndpointBaseDomain) {
        yield* Effect.annotateCurrentSpan(allocationAttributes);
        return yield* new EnvironmentConnectNotAuthorized({
          environmentId: input.link.environmentId,
          operation: input.operation,
          reason: "managed_endpoint_base_domain_not_configured",
        });
      }
      if (
        input.allocation.readyAt === null ||
        input.allocation.tunnelId === null ||
        input.allocation.dnsRecordId === null
      ) {
        yield* Effect.annotateCurrentSpan(allocationAttributes);
        return yield* new EnvironmentConnectNotAuthorized({
          environmentId: input.link.environmentId,
          operation: input.operation,
          reason: "managed_endpoint_allocation_not_ready",
        });
      }
      if (
        !isManagedEndpointHostname(input.allocation.hostname, settings.managedEndpointBaseDomain)
      ) {
        yield* Effect.annotateCurrentSpan({
          ...allocationAttributes,
          "relay.authorization.managed_endpoint_base_domain": settings.managedEndpointBaseDomain,
        });
        return yield* new EnvironmentConnectNotAuthorized({
          environmentId: input.link.environmentId,
          operation: input.operation,
          reason: "managed_endpoint_hostname_invalid",
        });
      }
      const endpoint = ManagedEndpointAllocations.resolveReadyManagedEndpoint({
        allocation: input.allocation,
        baseDomain: settings.managedEndpointBaseDomain,
      });
      if (
        endpoint === null ||
        endpoint.httpBaseUrl !== input.link.endpoint.httpBaseUrl ||
        endpoint.wsBaseUrl !== input.link.endpoint.wsBaseUrl
      ) {
        yield* Effect.annotateCurrentSpan({
          ...allocationAttributes,
          "relay.authorization.linked_http_base_url": input.link.endpoint.httpBaseUrl,
          "relay.authorization.linked_ws_base_url": input.link.endpoint.wsBaseUrl,
          ...(endpoint
            ? {
                "relay.authorization.resolved_http_base_url": endpoint.httpBaseUrl,
                "relay.authorization.resolved_ws_base_url": endpoint.wsBaseUrl,
              }
            : {}),
        });
        return yield* new EnvironmentConnectNotAuthorized({
          environmentId: input.link.environmentId,
          operation: input.operation,
          reason: "managed_endpoint_mismatch",
        });
      }
      return endpoint;
    },
  );

  const requestFailed =
    (operation: EnvironmentConnectorOperation, environmentId: string) => (cause: unknown) =>
      new EnvironmentMintRequestFailed({ environmentId, operation, cause });

  // Every relay-to-environment call is addressed to the user's linked managed
  // endpoint and carries a short-lived proof with these registered claims.
  const prepareRequest = Effect.fnUntraced(function* (input: {
    readonly operation: EnvironmentConnectorOperation;
    readonly userId: string;
    readonly environmentId: string;
  }) {
    const { link, allocation } = yield* Effect.all(
      {
        link: links.getForUser(input),
        allocation: allocations.get(input),
      },
      { concurrency: 2 },
    );
    if (!link) {
      return yield* new EnvironmentConnectNotAuthorized({
        environmentId: input.environmentId,
        operation: input.operation,
        reason: "environment_link_not_found",
      });
    }
    const endpoint = yield* resolveManagedEndpoint({
      operation: input.operation,
      link,
      allocation,
    });
    const now = yield* DateTime.now;
    const uuid = crypto.randomUUIDv4.pipe(
      Effect.mapError(requestFailed(input.operation, input.environmentId)),
    );
    const nonce = yield* uuid;
    return {
      link,
      endpoint,
      now,
      nonce,
      claims: {
        iss: relayIssuer,
        aud: wireEnvironmentIssuer(link.environmentId),
        sub: input.userId,
        jti: yield* uuid,
        iat: Math.floor(now.epochMilliseconds / 1_000),
        exp: Math.floor(DateTime.add(now, { minutes: 2 }).epochMilliseconds / 1_000),
        environmentId: link.environmentId,
        nonce,
      },
    };
  });

  const signProof = (input: {
    readonly operation: EnvironmentConnectorOperation;
    readonly environmentId: string;
    readonly typ: Parameters<typeof signRelayJwt>[0]["typ"];
    readonly payload: Parameters<typeof signRelayJwt>[0]["payload"];
  }) =>
    signRelayJwt({
      privateKey: Redacted.value(settings.cloudMintPrivateKey),
      typ: input.typ,
      payload: input.payload,
    }).pipe(Effect.mapError(requestFailed(input.operation, input.environmentId)));

  const failAfter =
    (environmentId: string, timeoutMs: number) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.timeoutOption(Duration.millis(timeoutMs)),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(new EnvironmentMintRequestTimedOut({ environmentId, timeoutMs })),
            onSome: Effect.succeed,
          }),
        ),
      );

  return EnvironmentConnector.of({
    status: Effect.fn("relay.environment_connector.status")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.environment_id": input.environmentId,
        "relay.operation": "status",
      });
      const { link, endpoint, now, nonce, claims } = yield* prepareRequest({
        operation: "status",
        ...input,
      });
      const proof = yield* signProof({
        operation: "status",
        environmentId: input.environmentId,
        typ: RELAY_HEALTH_REQUEST_TYP,
        payload: {
          ...claims,
          scope: ["environment:status"],
        } satisfies RelayCloudEnvironmentHealthProofPayload,
      });
      const checkedAt = DateTime.formatIso(now);
      const traceId = yield* currentTraceId;
      const environmentClient = yield* makeEnvironmentClient(endpoint.httpBaseUrl);
      const responseOption = yield* environmentClient.connect.health({ payload: { proof } }).pipe(
        withoutRedirects,
        Effect.match({
          onFailure: (cause) => ({ _tag: "Failure" as const, cause }),
          onSuccess: (response) => ({ _tag: "Success" as const, response }),
        }),
        Effect.timeoutOption(Duration.millis(ENVIRONMENT_MINT_REQUEST_TIMEOUT_MS)),
      );
      if (Option.isNone(responseOption)) {
        yield* Effect.annotateCurrentSpan({
          "relay.environment_health.outcome": "timeout",
          "relay.environment_health.trace_id": traceId,
        });
        yield* Effect.logWarning("Managed endpoint health request timed out", {
          environmentId: link.environmentId,
          endpoint: endpoint.httpBaseUrl,
          traceId,
        });
        return {
          environmentId: link.environmentId,
          endpoint,
          status: "offline" as const,
          checkedAt,
          error: "Managed endpoint health request timed out.",
          traceId,
        };
      }
      if (responseOption.value._tag === "Failure") {
        const failureReason = environmentHealthRequestFailureReason(responseOption.value.cause);
        yield* Effect.annotateCurrentSpan({
          "relay.environment_health.outcome": "failure",
          "relay.environment_health.failure_reason": failureReason,
          "relay.environment_health.trace_id": traceId,
        });
        yield* Effect.logWarning("Managed endpoint health request failed", {
          environmentId: link.environmentId,
          endpoint: endpoint.httpBaseUrl,
          failureReason,
          traceId,
        });
        return {
          environmentId: link.environmentId,
          endpoint,
          status: "offline" as const,
          checkedAt,
          error: environmentHealthRequestFailureMessage(responseOption.value.cause),
          traceId,
        };
      }
      const decoded = responseOption.value.response;
      const verified = yield* verifyEnvironmentHealthResponse({
        response: decoded,
        environmentId: input.environmentId,
        requestNonce: nonce,
        requestIssuedAt: now,
        environmentPublicKeys: [link.environmentPublicKey],
        relayIssuer,
        now: yield* DateTime.now,
      });
      if (!verified) {
        return yield* new EnvironmentMintResponseInvalid({
          environmentId: input.environmentId,
          operation: "status",
        });
      }
      return {
        environmentId: link.environmentId,
        endpoint,
        status: "online" as const,
        checkedAt: decoded.checkedAt,
        descriptor: decoded.descriptor,
      };
    }),
    connect: Effect.fn("relay.environment_connector.connect")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.environment_id": input.environmentId,
        "relay.operation": "connect",
        "relay.connect.has_device_id": input.deviceId !== undefined,
        ...(input.deviceId ? { "relay.mobile.device_id": input.deviceId } : {}),
      });
      if (input.clientProofKeyThumbprint.trim().length === 0) {
        return yield* new EnvironmentConnectNotAuthorized({
          environmentId: input.environmentId,
          operation: "connect",
          reason: "client_proof_key_thumbprint_missing",
        });
      }
      const { link, endpoint, now, nonce, claims } = yield* prepareRequest({
        operation: "connect",
        userId: input.userId,
        environmentId: input.environmentId,
      });
      const proof = yield* signProof({
        operation: "connect",
        environmentId: input.environmentId,
        typ: RELAY_MINT_REQUEST_TYP,
        payload: {
          ...claims,
          clientProofKeyThumbprint: input.clientProofKeyThumbprint,
          cnf: { jkt: input.clientProofKeyThumbprint },
          ...(input.deviceId ? { deviceId: input.deviceId } : {}),
          scope: ["environment:connect"],
        } satisfies RelayCloudMintCredentialProofPayload,
      });
      const environmentClient = yield* makeEnvironmentClient(endpoint.httpBaseUrl);
      const decoded = yield* environmentClient.connect
        .kataConnectMintCredential({ payload: { proof } })
        .pipe(
          withoutRedirects,
          Effect.mapError(requestFailed("connect", input.environmentId)),
          failAfter(input.environmentId, ENVIRONMENT_MINT_REQUEST_TIMEOUT_MS),
        );
      const verified = yield* verifyEnvironmentResponse({
        response: decoded,
        environmentId: input.environmentId,
        requestNonce: nonce,
        clientProofKeyThumbprint: input.clientProofKeyThumbprint,
        environmentPublicKeys: [link.environmentPublicKey],
        relayIssuer,
        nowEpochSeconds: Math.floor(now.epochMilliseconds / 1_000),
      });
      if (!verified) {
        return yield* new EnvironmentMintResponseInvalid({
          environmentId: input.environmentId,
          operation: "connect",
        });
      }
      return {
        environmentId: link.environmentId,
        endpoint,
        credential: decoded.credential,
        expiresAt: decoded.expiresAt,
      };
    }),
    deliverLinearOAuth: Effect.fn("relay.environment_connector.deliver_linear_oauth")(
      function* (input) {
        yield* Effect.annotateCurrentSpan({
          "relay.environment_id": input.environmentId,
          "relay.operation": "linear-oauth-delivery",
          "relay.linear.connection_id": input.connectionId,
        });
        const { endpoint, claims } = yield* prepareRequest({
          operation: "linear-oauth-delivery",
          userId: input.userId,
          environmentId: input.environmentId,
        });
        const proof = yield* signProof({
          operation: "linear-oauth-delivery",
          environmentId: input.environmentId,
          typ: RELAY_LINEAR_OAUTH_DELIVERY_TYP,
          payload: {
            ...claims,
            connectionId: input.connectionId,
            token: input.token,
          } satisfies RelayCloudLinearOAuthDeliveryProofPayload,
        });
        const environmentClient = yield* makeEnvironmentClient(endpoint.httpBaseUrl);
        const decoded = yield* environmentClient.connect
          .linearOAuthDelivery({ payload: { proof } })
          .pipe(
            withoutRedirects,
            Effect.mapError(requestFailed("linear-oauth-delivery", input.environmentId)),
            failAfter(input.environmentId, LINEAR_OAUTH_DELIVERY_TIMEOUT_MS),
          );
        if (!decoded.ok) {
          return yield* new EnvironmentMintResponseInvalid({
            environmentId: input.environmentId,
            operation: "linear-oauth-delivery",
          });
        }
      },
    ),
  });
});

export const layer = Layer.effect(EnvironmentConnector, make);
