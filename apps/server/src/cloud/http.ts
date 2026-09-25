import * as NodeCrypto from "node:crypto";
import {
  AuthRelayReadScope,
  AuthRelayWriteScope,
  AuthStandardClientScopes,
  EnvironmentCloudEndpointUnavailableError,
  EnvironmentCloudLinkStateResult,
  EnvironmentCloudRelayConfigResult,
  EnvironmentHttpApi,
  EnvironmentHttpBadRequestError,
  EnvironmentHttpConflictError,
  EnvironmentHttpInternalServerError,
  EnvironmentHttpUnauthorizedError,
  DESKTOP_UPDATE_RESTART_MARKER_FILE,
} from "@kata-sh/code-contracts";
import {
  RelayCloudEnvironmentHealthProofPayload,
  RelayCloudEnvironmentHealthRequest,
  RelayCloudLinearOAuthDeliveryProofPayload,
  RelayCloudLinearOAuthDeliveryRequest,
  RelayCloudMintCredentialProofPayload,
  RelayCloudMintCredentialRequest,
  RelayEnvironmentHealthResponseProofPayload,
  type RelayEnvironmentHealthResponse as RelayEnvironmentHealthResponseShape,
  RelayEnvironmentConfigRequest,
  type RelayEnvironmentCredentialRefreshProofPayload,
  RelayEnvironmentCredentialRefreshResponse,
  RelayEnvironmentLinkChallengeResponse,
  RelayEnvironmentLinkResponse,
  RelayEnvironmentMintResponseProofPayload,
  type RelayEnvironmentMintResponse as RelayEnvironmentMintResponseShape,
  RelayEnvironmentLinkProof,
  RelayEnvironmentLinkProofPayload,
  RelayLinkProofRequest,
  RelayManagedEndpointOrigin,
  RelayManagedEndpointRecoveryProofPayload,
  RelayManagedEndpointRecoveryRegistrationResponse,
  RelayManagedEndpointRecoveryResponse,
  type RelayManagedEndpointRuntimeConfig,
  RelayOkResponse,
} from "@kata-sh/code-contracts/relay";
import { wireEnvironmentIssuer } from "@kata-sh/code-contracts/wireIdentity";
import { withRelayClientTracing } from "@kata-sh/code-shared/relayTracing";
import {
  normalizeRelayIssuer,
  RELAY_ENVIRONMENT_CREDENTIAL_REFRESH_TYP,
  RELAY_HEALTH_REQUEST_TYP,
  RELAY_HEALTH_RESPONSE_TYP,
  RELAY_LINEAR_OAUTH_DELIVERY_TYP,
  RELAY_LINK_PROOF_TYP,
  RELAY_MANAGED_TUNNEL_RECOVERY_TYP,
  RELAY_MINT_REQUEST_TYP,
  RELAY_MINT_RESPONSE_TYP,
  signRelayJwt,
  verifyRelayJwt,
} from "@kata-sh/code-shared/relayJwt";
import { isSecureRelayUrl, normalizeSecureRelayUrl } from "@kata-sh/code-shared/relayUrl";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Crypto from "effect/Crypto";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpServer from "effect/unstable/http/HttpServer";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { saveLinearAccessToken } from "../routines/LinearOAuth.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";
import {
  SERVICE_STATE_FILE,
  SERVICE_STOP_MARKER_FILE,
  serviceStateHasPendingUpdate,
} from "./serviceProtocol.ts";
import {
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  CLOUD_ENDPOINT_CONFIRMED_ORIGIN,
  decodeConfirmedOrigin,
  CLOUD_LINKED_USER_ID,
  CLOUD_MANAGED_ENDPOINT_URL,
  CLOUD_MINT_PUBLIC_KEY,
  decodeRuntimeConfig,
  encodeEndpointRuntimeConfigJson,
  encodeConfirmedOriginJson,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "./config.ts";
import { relayUrlConfig } from "./publicConfig.ts";
import {
  readCliDesiredCloudLink,
  readCliDesiredLinkMode,
  setCliDesiredCloudLink,
} from "./CliState.ts";
import * as CliTokenManager from "./CliTokenManager.ts";
import { getOrCreateEnvironmentKeyPairFromSecretStore } from "./environmentKeys.ts";
import { traceRelayRequest } from "./traceRelayRequest.ts";
import {
  filterRelayResponse,
  filterRelayResponseReportingRejectedBearer,
  isRelayBearerRejectedError,
  rejectedBearerAsUnauthorized,
  relayRequestError,
  shouldRetryCloudLink,
} from "./relayResponse.ts";

const CLOUD_PROOF_MAX_LIFETIME_SECONDS = 5 * 60;
const CLOUD_PROOF_CLOCK_SKEW_SECONDS = 60;
// The desktop app stops its backends within seconds of writing the marker.
const DESKTOP_UPDATE_RESTART_MARKER_TTL = Duration.minutes(1);
const MANAGED_ENDPOINT_PROVISION_REQUEST_TIMEOUT = Duration.minutes(2);
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const CLOUD_CREDENTIAL_RESPONSE_HEADERS = {
  "cache-control": "no-store",
  pragma: "no-cache",
} as const;

const appendCloudCredentialResponseHeaders = HttpEffect.appendPreResponseHandler(
  (_request, response) =>
    Effect.succeed(HttpServerResponse.setHeaders(response, CLOUD_CREDENTIAL_RESPONSE_HEADERS)),
);

const failEnvironmentCloudInternalError =
  (message: string) =>
  (cause: unknown): Effect.Effect<never, EnvironmentHttpInternalServerError> =>
    Effect.logError(message, { cause }).pipe(
      Effect.flatMap(() => Effect.fail(new EnvironmentHttpInternalServerError({ message }))),
    );

const failCloudCliTokenManagerError = (error: CliTokenManager.CloudCliTokenManagerError) =>
  failEnvironmentCloudInternalError(error.message)(error);

const requireRelayUrl = relayUrlConfig.pipe(
  Effect.mapError(
    () =>
      new EnvironmentHttpInternalServerError({
        message: "KATACODE_RELAY_URL must be configured as a secure absolute HTTPS origin.",
      }),
  ),
);

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function stringToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function consumeCloudReplayGuards(input: {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly names: ReadonlyArray<string>;
  readonly value: Uint8Array;
}) {
  return Effect.forEach(
    input.names,
    (name) =>
      input.secrets.create(name, input.value).pipe(
        Effect.as(true),
        Effect.catchIf(ServerSecretStore.isSecretStoreError, (error) =>
          ServerSecretStore.isSecretAlreadyExistsError(error)
            ? Effect.succeed(false)
            : Effect.fail(error),
        ),
      ),
    { concurrency: input.names.length },
  ).pipe(Effect.map((created) => created.every(Boolean)));
}

function normalizePemForSignedPayload(value: string): string {
  return value.trim();
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
}

function validateCloudMintPublicKey(
  publicKey: string,
): Effect.Effect<void, EnvironmentHttpBadRequestError> {
  return Effect.try({
    try: () => NodeCrypto.createPublicKey(publicKey.replace(/\\n/g, "\n")),
    catch: () =>
      new EnvironmentHttpBadRequestError({
        message: "Cloud mint public key must be a valid Ed25519 public key.",
      }),
  }).pipe(
    Effect.flatMap((key) =>
      key.asymmetricKeyType === "ed25519"
        ? Effect.void
        : Effect.fail(
            new EnvironmentHttpBadRequestError({
              message: "Cloud mint public key must be a valid Ed25519 public key.",
            }),
          ),
    ),
  );
}

function validateRelayConfigPayload(
  payload: RelayEnvironmentConfigRequest,
): Effect.Effect<void, EnvironmentHttpBadRequestError> {
  if (!isSecureRelayUrl(payload.relayUrl)) {
    return Effect.fail(
      new EnvironmentHttpBadRequestError({
        message: "Relay URL must be a secure absolute HTTPS URL.",
      }),
    );
  }
  if (payload.relayIssuer !== undefined && !isSecureRelayUrl(payload.relayIssuer)) {
    return Effect.fail(
      new EnvironmentHttpBadRequestError({
        message: "Relay issuer must be a secure absolute HTTPS URL.",
      }),
    );
  }
  if (payload.environmentCredential.trim().length === 0) {
    return Effect.fail(
      new EnvironmentHttpBadRequestError({
        message: "Relay environment credential is required.",
      }),
    );
  }
  if (payload.cloudUserId.trim().length === 0) {
    return Effect.fail(
      new EnvironmentHttpBadRequestError({
        message: "Cloud user id is required.",
      }),
    );
  }
  return Effect.void;
}

function managedCallbackOrigin(
  payload: RelayEnvironmentConfigRequest,
): Effect.Effect<string | null, EnvironmentHttpBadRequestError> {
  const runtime = payload.endpointRuntime;
  const disagree = new EnvironmentHttpBadRequestError({
    message: "Managed endpoint and runtime configuration must agree.",
  });
  if (runtime !== null && payload.endpoint.providerKind !== runtime.providerKind) {
    return Effect.fail(disagree);
  }
  if (payload.endpoint.providerKind !== "cloudflare_tunnel") {
    return Effect.succeed(null);
  }
  const origin = normalizeSecureRelayUrl(payload.endpoint.httpBaseUrl);
  if (origin === null) {
    return Effect.fail(
      new EnvironmentHttpBadRequestError({
        message: "Managed callback URL must be a secure HTTPS origin.",
      }),
    );
  }
  return Effect.succeed(origin);
}

function validateLinkedCloudUser(input: {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly cloudUserId: string;
}): Effect.Effect<void, EnvironmentAuth.ServerAuthInternalError | EnvironmentHttpConflictError> {
  return input.secrets.get(CLOUD_LINKED_USER_ID).pipe(
    Effect.mapError(
      (cause) =>
        new EnvironmentAuth.ServerAuthLinkedCloudAccountVerificationError({
          cause,
        }),
    ),
    Effect.flatMap((existing) => {
      if (Option.isNone(existing)) {
        return Effect.void;
      }
      const existingCloudUserId = bytesToString(existing.value);
      return existingCloudUserId === input.cloudUserId
        ? Effect.void
        : Effect.fail(
            new EnvironmentHttpConflictError({
              message:
                "This environment is already linked to a different cloud account. Unlink it before switching accounts.",
            }),
          );
    }),
  );
}

function readInstalledCloudUserId(
  secrets: ServerSecretStore.ServerSecretStore["Service"],
): Effect.Effect<string, EnvironmentAuth.ServerAuthInternalError> {
  return secrets.get(CLOUD_LINKED_USER_ID).pipe(
    Effect.mapError(
      (cause) =>
        new EnvironmentAuth.ServerAuthLinkedCloudAccountReadError({
          cause,
        }),
    ),
    Effect.flatMap((bytes) =>
      Option.isSome(bytes)
        ? Effect.succeed(bytesToString(bytes.value))
        : Effect.fail(new EnvironmentAuth.ServerAuthLinkedCloudAccountMissingError({})),
    ),
  );
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function firstForwardedHeaderValue(value: string | undefined): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

function requestAbsoluteUrl(request: HttpServerRequest.HttpServerRequest): string | null {
  try {
    return new URL(request.originalUrl).href;
  } catch {
    const host = firstForwardedHeaderValue(request.headers.host) ?? "127.0.0.1";
    try {
      return new URL(request.originalUrl, `http://${host}`).href;
    } catch {
      return null;
    }
  }
}

function hasForwardedAuthorityHeaders(request: HttpServerRequest.HttpServerRequest): boolean {
  return (
    firstForwardedHeaderValue(request.headers["x-forwarded-host"]) !== undefined ||
    firstForwardedHeaderValue(request.headers["x-forwarded-proto"]) !== undefined
  );
}

function endpointRequestPort(url: URL): number {
  return Number(url.port || (url.protocol === "https:" ? 443 : 80));
}

export function parseManagedEndpointLocalOrigin(localOrigin: string) {
  const url = new URL(localOrigin);
  if (
    localOrigin !== localOrigin.trim() ||
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    localOrigin.includes("?") ||
    localOrigin.includes("#")
  ) {
    throw new Error("Invalid local origin");
  }
  const wsUrl = new URL(url.origin);
  wsUrl.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return {
    httpBaseUrl: url.origin,
    wsBaseUrl: wsUrl.origin,
    origin: {
      localHttpHost: url.hostname,
      localHttpPort: endpointRequestPort(url),
    } satisfies RelayManagedEndpointOrigin,
  };
}

function isAllowedEndpointOrigin(input: {
  readonly origin: RelayManagedEndpointOrigin;
  readonly requestUrl: string;
  readonly connectorPort?: number;
}): boolean {
  if (!isLoopbackHostname(input.origin.localHttpHost)) {
    return false;
  }

  const url = new URL(input.requestUrl);
  if (!isLoopbackHostname(url.hostname)) {
    return false;
  }

  return (
    input.origin.localHttpPort === endpointRequestPort(url) ||
    input.origin.localHttpPort === input.connectorPort
  );
}

// A managed (Cloudflare tunnel) endpoint is provisioned by the relay and must
// point at a loopback origin. A manual endpoint is reached out of band (e.g.
// Tailscale) or not advertised at all for publish-only links, so it is not
// tied to the managed-tunnel scope.
export function isSupportedLinkProviderKind(request: RelayLinkProofRequest): boolean {
  return (
    request.endpoint.providerKind === "cloudflare_tunnel" ||
    request.endpoint.providerKind === "manual"
  );
}

export function linkProofScopes(
  request: RelayLinkProofRequest,
): RelayEnvironmentLinkProofPayload["scopes"] {
  return request.endpoint.providerKind === "cloudflare_tunnel"
    ? ["agent_activity_notifications", "managed_tunnels"]
    : ["agent_activity_notifications"];
}

function hasExactScope(input: {
  readonly scopes: ReadonlyArray<string>;
  readonly expected: string;
}): boolean {
  return input.scopes.length === 1 && input.scopes[0] === input.expected;
}

function hasBoundedCloudProofLifetime(input: {
  readonly iat: number;
  readonly exp: number;
  readonly nowSeconds: number;
}): boolean {
  return (
    input.exp > input.iat &&
    input.exp - input.iat <= CLOUD_PROOF_MAX_LIFETIME_SECONDS &&
    input.iat <= input.nowSeconds + CLOUD_PROOF_CLOCK_SKEW_SECONDS
  );
}

const decodeCloudHealthProof = Schema.decodeUnknownEffect(RelayCloudEnvironmentHealthProofPayload);
const decodeCloudMintProof = Schema.decodeUnknownEffect(RelayCloudMintCredentialProofPayload);
const decodeCloudLinearOAuthDeliveryProof = Schema.decodeUnknownEffect(
  RelayCloudLinearOAuthDeliveryProofPayload,
);

interface CloudHttpDependencies {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly environment: ServerEnvironment.ServerEnvironment["Service"];
  readonly endpointRuntime: ManagedEndpointRuntime.CloudManagedEndpointRuntime["Service"];
  readonly environmentAuth: EnvironmentAuth.EnvironmentAuth["Service"];
  readonly cliTokenManager: CliTokenManager.CloudCliTokenManager["Service"];
  readonly httpClient: HttpClient.HttpClient;
}

const cloudHttpDependencies = Effect.gen(function* () {
  return {
    secrets: yield* ServerSecretStore.ServerSecretStore,
    environment: yield* ServerEnvironment.ServerEnvironment,
    endpointRuntime: yield* ManagedEndpointRuntime.CloudManagedEndpointRuntime,
    environmentAuth: yield* EnvironmentAuth.EnvironmentAuth,
    cliTokenManager: yield* CliTokenManager.CloudCliTokenManager,
    httpClient: yield* HttpClient.HttpClient,
  } satisfies CloudHttpDependencies;
});

const makeCloudLinkProof = Effect.fn("environment.cloud.makeLinkProof")(function* (
  dependencies: CloudHttpDependencies,
  request: RelayLinkProofRequest,
  requestUrl: string,
) {
  const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(dependencies.secrets);
  const config = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  if (
    !isSupportedLinkProviderKind(request) ||
    !isAllowedEndpointOrigin({
      origin: request.origin,
      requestUrl,
      ...(Option.isSome(config) ? { connectorPort: config.value.port } : {}),
    })
  ) {
    return yield* new EnvironmentHttpBadRequestError({
      message: "Invalid managed endpoint origin.",
    });
  }
  const now = yield* DateTime.now;
  const expiresAt = DateTime.add(now, { minutes: 5 });
  const nowSeconds = Math.floor(now.epochMilliseconds / 1_000);
  const descriptor = yield* dependencies.environment.getDescriptor;
  const payload = {
    iss: wireEnvironmentIssuer(descriptor.environmentId),
    aud: normalizeRelayIssuer(request.relayIssuer),
    sub: descriptor.environmentId,
    jti: yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4)),
    iat: nowSeconds,
    exp: Math.floor(expiresAt.epochMilliseconds / 1_000),
    challenge: request.challenge,
    descriptor,
    environmentId: descriptor.environmentId,
    environmentPublicKey: normalizePemForSignedPayload(keyPair.publicKey),
    endpoint: request.endpoint,
    origin: request.origin,
    scopes: linkProofScopes(request),
  } satisfies RelayEnvironmentLinkProofPayload;
  return yield* signRelayJwt({
    privateKey: keyPair.privateKey,
    typ: RELAY_LINK_PROOF_TYP,
    payload,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new EnvironmentAuth.ServerAuthCloudLinkJwtSigningError({
          cause,
        }),
    ),
  );
});

const cloudLinkProofHandler = Effect.fn("environment.cloud.linkProof")(
  function* (dependencies: CloudHttpDependencies, request: RelayLinkProofRequest) {
    yield* requireEnvironmentScope(AuthRelayWriteScope);
    const httpRequest = yield* HttpServerRequest.HttpServerRequest;
    const requestUrl = requestAbsoluteUrl(httpRequest);
    if (requestUrl === null || hasForwardedAuthorityHeaders(httpRequest)) {
      return yield* new EnvironmentHttpBadRequestError({
        message: "Invalid managed endpoint origin.",
      });
    }
    const proof = yield* makeCloudLinkProof(dependencies, request, requestUrl);
    yield* appendCloudCredentialResponseHeaders;
    return proof satisfies RelayEnvironmentLinkProof;
  },
  Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
    failEnvironmentCloudInternalError(error.message)(error),
  ),
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not generate environment link proof."),
  ),
  Effect.catchTag(
    "PlatformError",
    failEnvironmentCloudInternalError("Could not generate environment link proof."),
  ),
);

const rollbackManagedEndpoint = (dependencies: CloudHttpDependencies) =>
  Effect.all(
    [
      Effect.ignore(dependencies.endpointRuntime.applyConfig(null)),
      Effect.ignore(dependencies.secrets.remove(CLOUD_ENDPOINT_RUNTIME_CONFIG)),
      Effect.ignore(dependencies.secrets.remove(CLOUD_MANAGED_ENDPOINT_URL)),
    ],
    { concurrency: 1 },
  ).pipe(Effect.asVoid);

function managedEndpointRuntimeConfigsMatch(
  left: RelayManagedEndpointRuntimeConfig,
  right: RelayManagedEndpointRuntimeConfig,
): boolean {
  return (
    left.providerKind === right.providerKind &&
    left.connectorToken === right.connectorToken &&
    left.tunnelId === right.tunnelId &&
    left.tunnelName === right.tunnelName
  );
}

const activateManagedTunnel = Effect.fn("environment.cloud.activateManagedTunnel")(function* (
  dependencies: CloudHttpDependencies,
  input: {
    readonly config: RelayManagedEndpointRuntimeConfig;
    readonly configJson: string;
    readonly origin: RelayManagedEndpointOrigin;
  },
) {
  return yield* dependencies.endpointRuntime.withLinkStateLock(
    Effect.gen(function* () {
      const currentConfig = yield* dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG);
      if (Option.isNone(currentConfig) || bytesToString(currentConfig.value) !== input.configJson) {
        return null;
      }
      const status = yield* dependencies.endpointRuntime.applyConfig(input.config);
      if (status.status !== "running") {
        return yield* new EnvironmentCloudEndpointUnavailableError({
          message: "Managed endpoint runtime could not be started.",
          endpointRuntimeStatus: status,
        });
      }
      const marker = yield* encodeConfirmedOriginJson({
        config: input.config,
        origin: input.origin,
      });
      yield* dependencies.secrets.set(CLOUD_ENDPOINT_CONFIRMED_ORIGIN, stringToBytes(marker));
      return status;
    }),
  );
});

const activateManagedTunnelWithRetry = (
  dependencies: CloudHttpDependencies,
  input: {
    readonly config: RelayManagedEndpointRuntimeConfig;
    readonly configJson: string;
    readonly origin: RelayManagedEndpointOrigin;
  },
  retryRuntimeFailures: boolean,
) => {
  const activate = activateManagedTunnel(dependencies, input);
  return retryRuntimeFailures
    ? activate.pipe(
        Effect.retry({
          while: (error) =>
            error._tag === "EnvironmentCloudEndpointUnavailableError" &&
            ManagedEndpointRuntime.isRetryableManagedEndpointRuntimeStatus(
              error.endpointRuntimeStatus,
            ),
          schedule: Schedule.exponential("1 second").pipe(
            Schedule.modifyDelay(({ duration }) =>
              Effect.succeed(Duration.min(duration, Duration.seconds(30))),
            ),
            Schedule.jittered,
          ),
        }),
      )
    : activate;
};

export const startManagedCloudTunnelIfOriginConfirmed = Effect.fn(
  "environment.cloud.startManagedCloudTunnelIfOriginConfirmed",
)(function* (localOrigin: string, options?: { readonly requireConfirmedOrigin?: boolean }) {
  const dependencies = yield* cloudHttpDependencies;
  const requireConfirmedOrigin = options?.requireConfirmedOrigin ?? true;
  const parsedOrigin = yield* Effect.try({
    try: () => parseManagedEndpointLocalOrigin(localOrigin),
    catch: () =>
      new EnvironmentHttpBadRequestError({
        message: "Could not resolve local environment origin.",
      }),
  });
  return yield* dependencies.endpointRuntime.withLinkStateLock(
    Effect.gen(function* () {
      const [runtimeBytes, markerBytes] = yield* Effect.all([
        dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG),
        dependencies.secrets.get(CLOUD_ENDPOINT_CONFIRMED_ORIGIN),
      ]);
      if (Option.isNone(runtimeBytes)) return false;
      const config = Option.getOrNull(decodeRuntimeConfig(bytesToString(runtimeBytes.value)));
      if (config === null || config.providerKind !== "cloudflare_tunnel") return false;
      // With the marker required, only a config the relay already confirmed on
      // this port may start. Without it, startup is falling back after the
      // relay stayed unreachable: an unconfirmed origin may send traffic to a
      // stale port, but that beats no remote access at all.
      if (requireConfirmedOrigin) {
        if (Option.isNone(markerBytes)) return false;
        const marker = Option.getOrNull(decodeConfirmedOrigin(bytesToString(markerBytes.value)));
        if (
          marker === null ||
          !managedEndpointRuntimeConfigsMatch(marker.config, config) ||
          marker.origin.localHttpHost !== parsedOrigin.origin.localHttpHost ||
          marker.origin.localHttpPort !== parsedOrigin.origin.localHttpPort
        ) {
          return false;
        }
      }
      const status = yield* dependencies.endpointRuntime.applyConfig(config);
      if (status.status !== "running") {
        return yield* new EnvironmentCloudEndpointUnavailableError({
          message: "Managed endpoint runtime could not be started.",
          endpointRuntimeStatus: status,
        });
      }
      return true;
    }),
  );
});

const applyCloudRelayConfig = Effect.fn("environment.cloud.applyRelayConfig")(function* (
  dependencies: CloudHttpDependencies,
  payload: RelayEnvironmentConfigRequest,
  options?: {
    readonly lockHeld?: boolean;
    readonly confirmedOrigin?: RelayManagedEndpointOrigin;
  },
) {
  const apply = Effect.gen(function* () {
    yield* validateRelayConfigPayload(payload);
    const callbackOrigin = yield* managedCallbackOrigin(payload);
    yield* validateLinkedCloudUser({
      secrets: dependencies.secrets,
      cloudUserId: payload.cloudUserId,
    });
    yield* validateCloudMintPublicKey(payload.cloudMintPublicKey);
    // Reject unsupported runtimes before touching the connector so a bad
    // payload cannot stop a healthy tunnel on its way to a 503.
    if (
      payload.endpointRuntime !== null &&
      payload.endpointRuntime.providerKind !== "cloudflare_tunnel"
    ) {
      return yield* new EnvironmentCloudEndpointUnavailableError({
        message: "Managed endpoint runtime could not be started.",
        endpointRuntimeStatus: {
          status: "unsupported",
          providerKind: payload.endpointRuntime.providerKind,
        },
      });
    }
    yield* dependencies.endpointRuntime.applyConfig(null);
    yield* dependencies.secrets.remove(CLOUD_ENDPOINT_CONFIRMED_ORIGIN);

    yield* Effect.gen(function* () {
      yield* dependencies.secrets.set(RELAY_URL_SECRET, stringToBytes(payload.relayUrl));
      yield* dependencies.secrets.set(
        RELAY_ISSUER_SECRET,
        stringToBytes(payload.relayIssuer ?? payload.relayUrl),
      );
      yield* dependencies.secrets.set(CLOUD_LINKED_USER_ID, stringToBytes(payload.cloudUserId));
      yield* dependencies.secrets.set(
        RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
        stringToBytes(payload.environmentCredential),
      );
      yield* dependencies.secrets.set(
        CLOUD_MINT_PUBLIC_KEY,
        stringToBytes(payload.cloudMintPublicKey),
      );
      if (payload.endpointRuntime) {
        const endpointRuntimeJson = yield* encodeEndpointRuntimeConfigJson(payload.endpointRuntime);
        yield* dependencies.secrets.set(
          CLOUD_ENDPOINT_RUNTIME_CONFIG,
          stringToBytes(endpointRuntimeJson),
        );
      } else {
        yield* dependencies.secrets.remove(CLOUD_ENDPOINT_RUNTIME_CONFIG);
      }
      if (callbackOrigin === null) {
        yield* dependencies.secrets.remove(CLOUD_MANAGED_ENDPOINT_URL);
      } else {
        yield* dependencies.secrets.set(CLOUD_MANAGED_ENDPOINT_URL, stringToBytes(callbackOrigin));
      }
    }).pipe(
      Effect.catch((error) =>
        rollbackManagedEndpoint(dependencies).pipe(Effect.andThen(Effect.fail(error))),
      ),
    );
    if (payload.endpointRuntime === null || options?.confirmedOrigin === undefined) {
      return {
        ok: true,
        endpointRuntimeStatus: { status: "disabled" },
      } satisfies EnvironmentCloudRelayConfigResult;
    }
    const endpointRuntimeStatus = yield* dependencies.endpointRuntime.applyConfig(
      payload.endpointRuntime,
    );
    if (endpointRuntimeStatus.status !== "running") {
      return yield* new EnvironmentCloudEndpointUnavailableError({
        message: "Managed endpoint runtime could not be started.",
        endpointRuntimeStatus,
      });
    }
    const marker = yield* encodeConfirmedOriginJson({
      config: payload.endpointRuntime,
      origin: options.confirmedOrigin,
    });
    yield* dependencies.secrets.set(CLOUD_ENDPOINT_CONFIRMED_ORIGIN, stringToBytes(marker));
    return { ok: true, endpointRuntimeStatus } satisfies EnvironmentCloudRelayConfigResult;
  });
  return yield* options?.lockHeld ? apply : dependencies.endpointRuntime.withLinkStateLock(apply);
});

const cloudRelayConfigHandler = Effect.fn("environment.cloud.relayConfig")(
  function* (dependencies: CloudHttpDependencies, payload: RelayEnvironmentConfigRequest) {
    yield* requireEnvironmentScope(AuthRelayWriteScope);
    const result = yield* applyCloudRelayConfig(dependencies, payload);
    if (payload.endpointRuntime?.providerKind === "cloudflare_tunnel") {
      const server = yield* HttpServer.HttpServer;
      const address = server.address;
      if (typeof address === "string" || !("port" in address)) {
        return yield* new EnvironmentHttpInternalServerError({
          message: "Could not resolve the local server origin.",
        });
      }
      const registration = yield* registerManagedCloudTunnelRecovery(
        `http://127.0.0.1:${address.port}`,
      ).pipe(
        Effect.retry({
          times: 2,
          while: (error) =>
            shouldRetryCloudLink(error) &&
            error._tag !== "EnvironmentCloudEndpointUnavailableError",
        }),
      );
      if (registration.status === "superseded") {
        return yield* new EnvironmentHttpConflictError({
          message: "The managed tunnel configuration changed during registration.",
        });
      }
      if (registration.status === "recovery_required") {
        yield* dependencies.endpointRuntime.requestRecovery(registration.config);
      }
      if (registration.status !== "ready") {
        return yield* new EnvironmentCloudEndpointUnavailableError({
          message: "Managed endpoint origin could not be confirmed.",
          endpointRuntimeStatus: { status: "disabled" },
        });
      }
      return {
        ok: true,
        endpointRuntimeStatus: registration.endpointRuntimeStatus,
      } satisfies EnvironmentCloudRelayConfigResult;
    }
    return result;
  },
  Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
    failEnvironmentCloudInternalError(error.message)(error),
  ),
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not persist environment relay configuration."),
  ),
  Effect.catchTags({
    SchemaError: failEnvironmentCloudInternalError(
      "Could not persist environment relay configuration.",
    ),
    PlatformError: failEnvironmentCloudInternalError(
      "Could not register the managed endpoint origin.",
    ),
  }),
);

interface RelayClientRequestInput<A> {
  readonly url: string;
  readonly token: string;
  readonly payload: unknown;
  readonly schema: Schema.Decoder<A>;
  readonly timeout?: Duration.Input;
}

const relayClientRequestReportingRejectedBearer = <A>(
  dependencies: CloudHttpDependencies,
  input: RelayClientRequestInput<A>,
) =>
  HttpClientRequest.post(input.url).pipe(
    HttpClientRequest.bearerToken(input.token),
    HttpClientRequest.bodyJson(input.payload),
    Effect.flatMap(dependencies.httpClient.execute),
    Effect.flatMap(filterRelayResponseReportingRejectedBearer),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(input.schema)),
    Effect.timeout(input.timeout ?? "10 seconds"),
    Effect.mapError((cause) =>
      isRelayBearerRejectedError(cause) ? cause : relayRequestError(cause),
    ),
    withRelayClientTracing,
  );

const relayClientRequest = <A>(
  dependencies: CloudHttpDependencies,
  input: RelayClientRequestInput<A>,
) =>
  relayClientRequestReportingRejectedBearer(dependencies, input).pipe(
    Effect.catchTag("RelayBearerRejectedError", rejectedBearerAsUnauthorized),
  );

const reconcileDesiredCloudLinkWith = Effect.fn("environment.cloud.reconcileDesiredLinkWith")(
  function* (dependencies: CloudHttpDependencies, localOrigin: string) {
    const parsedOrigin = yield* Effect.try({
      try: () => parseManagedEndpointLocalOrigin(localOrigin),
      catch: () =>
        new EnvironmentHttpBadRequestError({
          message: "Could not resolve local environment origin.",
        }),
    });
    const token = yield* dependencies.cliTokenManager.getExisting.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new EnvironmentHttpUnauthorizedError({
                message: "Run `katacode connect link` to authorize this environment.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    const mode = yield* readCliDesiredLinkMode;
    const managedTunnelsEnabled = mode !== "publish_only";
    const relayUrl = yield* requireRelayUrl;
    const challenge = yield* relayClientRequest(dependencies, {
      url: `${relayUrl}/v1/client/environment-link-challenges`,
      token: token.accessToken,
      payload: {
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled,
      },
      schema: RelayEnvironmentLinkChallengeResponse,
    });
    const proof = yield* makeCloudLinkProof(
      dependencies,
      {
        challenge: challenge.challenge,
        relayIssuer: relayUrl,
        endpoint: {
          httpBaseUrl: parsedOrigin.httpBaseUrl,
          wsBaseUrl: parsedOrigin.wsBaseUrl,
          providerKind: managedTunnelsEnabled ? "cloudflare_tunnel" : "manual",
        },
        origin: parsedOrigin.origin,
      },
      parsedOrigin.httpBaseUrl,
    );
    const link = yield* relayClientRequest(dependencies, {
      url: `${relayUrl}/v1/client/environment-links`,
      token: token.accessToken,
      payload: {
        proof,
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled,
      },
      schema: RelayEnvironmentLinkResponse,
      timeout: MANAGED_ENDPOINT_PROVISION_REQUEST_TIMEOUT,
    });
    yield* setCliDesiredCloudLink(true, mode);
    yield* applyCloudRelayConfig(
      dependencies,
      {
        relayUrl,
        relayIssuer: link.relayIssuer,
        cloudUserId: link.cloudUserId,
        environmentCredential: link.environmentCredential,
        cloudMintPublicKey: link.cloudMintPublicKey,
        endpoint: link.endpoint,
        endpointRuntime: link.endpointRuntime,
      },
      {
        lockHeld: true,
        confirmedOrigin: parsedOrigin.origin,
      },
    );
    // Callers decide on managed tunnel recovery from the mode this link
    // actually used, not from a value read before the relay round trip.
    return mode;
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not persist desired Kata Code Connect link state."),
  ),
  Effect.catchTags({
    CloudCliCredentialRemovalError: failCloudCliTokenManagerError,
    CloudCliCredentialRefreshError: failCloudCliTokenManagerError,
    CloudCliCredentialReadError: failCloudCliTokenManagerError,
    CloudCliAuthorizationError: failCloudCliTokenManagerError,
    CloudCliAuthorizationTimeoutError: failCloudCliTokenManagerError,
  }),
);

export const reconcileDesiredCloudLink = Effect.fn("environment.cloud.reconcileDesiredLink")(
  function* (localOrigin: string) {
    const dependencies = yield* cloudHttpDependencies;
    return yield* dependencies.endpointRuntime.withLinkStateLock(
      reconcileDesiredCloudLinkWith(dependencies, localOrigin),
    );
  },
);

export const reconcileDesiredCloudLinkIfStillDesired = Effect.fn(
  "environment.cloud.reconcileDesiredLinkIfStillDesired",
)(function* (localOrigin: string) {
  const dependencies = yield* cloudHttpDependencies;
  return yield* dependencies.endpointRuntime.withLinkStateLock(
    Effect.gen(function* () {
      if (!(yield* readCliDesiredCloudLink)) {
        return null;
      }
      return yield* reconcileDesiredCloudLinkWith(dependencies, localOrigin);
    }),
  );
});

type ManagedTunnelRecoveryProofInput = {
  readonly environmentId: RelayManagedEndpointRecoveryProofPayload["environmentId"];
  readonly cloudUserId: string;
  readonly relayUrl: string;
} & (
  | {
      readonly action: "register";
      readonly tunnelId: string;
      readonly origin: RelayManagedEndpointOrigin;
    }
  | { readonly action: "recover"; readonly origin: RelayManagedEndpointOrigin }
);

const environmentRelayProofClaims = Effect.fn("environment.cloud.environmentRelayProofClaims")(
  function* (
    dependencies: CloudHttpDependencies,
    input: {
      readonly environmentId: RelayEnvironmentCredentialRefreshProofPayload["environmentId"];
      readonly cloudUserId: string;
      readonly relayUrl: string;
    },
  ) {
    const configuredIssuer = yield* dependencies.secrets.get(RELAY_ISSUER_SECRET);
    const now = yield* DateTime.now;
    const issuedAt = Math.floor(now.epochMilliseconds / 1_000);
    return {
      iss: wireEnvironmentIssuer(input.environmentId),
      aud: normalizeRelayIssuer(
        Option.isSome(configuredIssuer) ? bytesToString(configuredIssuer.value) : input.relayUrl,
      ),
      sub: input.environmentId,
      jti: yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4)),
      iat: issuedAt,
      exp: issuedAt + 60,
      environmentId: input.environmentId,
      cloudUserId: input.cloudUserId,
    } satisfies RelayEnvironmentCredentialRefreshProofPayload;
  },
);

const makeManagedTunnelRecoveryProof = Effect.fn(
  "environment.cloud.makeManagedTunnelRecoveryProof",
)(function* (dependencies: CloudHttpDependencies, input: ManagedTunnelRecoveryProofInput) {
  const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(dependencies.secrets);
  const claims = yield* environmentRelayProofClaims(dependencies, input);
  const payload =
    input.action === "register"
      ? {
          ...claims,
          action: "register" as const,
          tunnelId: input.tunnelId,
          origin: input.origin,
        }
      : { ...claims, action: "recover" as const, origin: input.origin };

  return yield* signRelayJwt({
    privateKey: keyPair.privateKey,
    typ: RELAY_MANAGED_TUNNEL_RECOVERY_TYP,
    payload,
  }).pipe(
    Effect.mapError(
      () =>
        new EnvironmentHttpInternalServerError({
          message: "Could not sign the managed tunnel recovery request.",
        }),
    ),
  );
});

const registerManagedTunnelReportingRejectedCredential = Effect.fn(
  "environment.cloud.registerManagedCloudTunnelRecovery",
)(function* (localOrigin: string, options?: { readonly retryRuntimeFailures?: boolean }) {
  const dependencies = yield* cloudHttpDependencies;
  const [runtimeConfig, relayUrl, cloudUserId, environmentCredential] = yield* Effect.all([
    dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG),
    dependencies.secrets.get(RELAY_URL_SECRET),
    dependencies.secrets.get(CLOUD_LINKED_USER_ID),
    dependencies.secrets.get(RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
  ]);
  if (
    Option.isNone(runtimeConfig) ||
    Option.isNone(relayUrl) ||
    Option.isNone(cloudUserId) ||
    Option.isNone(environmentCredential)
  ) {
    return { status: "not_linked" as const };
  }

  const config = Option.getOrNull(decodeRuntimeConfig(bytesToString(runtimeConfig.value)));
  if (config?.providerKind !== "cloudflare_tunnel") {
    return { status: "not_linked" as const };
  }

  const parsedOrigin = yield* Effect.try({
    try: () => parseManagedEndpointLocalOrigin(localOrigin),
    catch: () =>
      new EnvironmentHttpBadRequestError({
        message: "Could not resolve local environment origin.",
      }),
  });
  if (config.tunnelId === undefined) {
    return { status: "recovery_required" as const, config };
  }
  const origin = parsedOrigin.origin;
  const environmentId = yield* dependencies.environment.getEnvironmentId;
  const relayUrlValue = bytesToString(relayUrl.value);
  const cloudUserIdValue = bytesToString(cloudUserId.value);
  const proof = yield* makeManagedTunnelRecoveryProof(dependencies, {
    action: "register",
    environmentId,
    cloudUserId: cloudUserIdValue,
    relayUrl: relayUrlValue,
    tunnelId: config.tunnelId,
    origin,
  });
  const registered = yield* relayClientRequestReportingRejectedBearer(dependencies, {
    url: `${relayUrlValue}/v1/environments/${encodeURIComponent(environmentId)}/tunnel/recovery`,
    token: bytesToString(environmentCredential.value),
    payload: {
      cloudUserId: cloudUserIdValue,
      tunnelId: config.tunnelId,
      origin,
      proof,
    },
    schema: RelayManagedEndpointRecoveryRegistrationResponse,
  });
  if (registered.status === "recovery_required") {
    return { status: registered.status, config };
  }
  const endpointRuntimeStatus = yield* activateManagedTunnelWithRetry(
    dependencies,
    {
      config,
      configJson: bytesToString(runtimeConfig.value),
      origin,
    },
    options?.retryRuntimeFailures === true,
  );
  return endpointRuntimeStatus === null
    ? { status: "superseded" as const }
    : { status: "ready" as const, endpointRuntimeStatus };
});

export const registerManagedCloudTunnelRecovery = (
  localOrigin: string,
  options?: { readonly retryRuntimeFailures?: boolean },
) =>
  registerManagedTunnelReportingRejectedCredential(localOrigin, options).pipe(
    Effect.catchTag("RelayBearerRejectedError", rejectedBearerAsUnauthorized),
  );

// Replaces an environment credential the relay no longer accepts, using the
// CLI authorization. Relinking would do the same but provisions a new tunnel.
const refreshCloudEnvironmentCredential = Effect.fn(
  "environment.cloud.refreshEnvironmentCredential",
)(
  function* (dependencies: CloudHttpDependencies) {
    const token = yield* dependencies.cliTokenManager.getExisting.pipe(
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new EnvironmentHttpUnauthorizedError({
                message: "Run `katacode connect link` to authorize this environment.",
              }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
    yield* dependencies.endpointRuntime.withLinkStateLock(
      Effect.gen(function* () {
        const [relayUrl, cloudUserId] = yield* Effect.all([
          dependencies.secrets.get(RELAY_URL_SECRET),
          dependencies.secrets.get(CLOUD_LINKED_USER_ID),
        ]);
        // Unlinked since registration failed; the retried registration
        // reports not_linked and startup reconciles from there.
        if (Option.isNone(relayUrl) || Option.isNone(cloudUserId)) {
          return;
        }
        const environmentId = yield* dependencies.environment.getEnvironmentId;
        const relayUrlValue = bytesToString(relayUrl.value);
        const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(dependencies.secrets);
        const claims = yield* environmentRelayProofClaims(dependencies, {
          environmentId,
          cloudUserId: bytesToString(cloudUserId.value),
          relayUrl: relayUrlValue,
        });
        const proof = yield* signRelayJwt({
          privateKey: keyPair.privateKey,
          typ: RELAY_ENVIRONMENT_CREDENTIAL_REFRESH_TYP,
          payload: claims,
        }).pipe(
          Effect.mapError(
            () =>
              new EnvironmentHttpInternalServerError({
                message: "Could not sign the environment credential refresh request.",
              }),
          ),
        );
        const refreshed = yield* relayClientRequest(dependencies, {
          url: `${relayUrlValue}/v1/client/environment-links/${encodeURIComponent(environmentId)}/credential`,
          token: token.accessToken,
          payload: { proof },
          schema: RelayEnvironmentCredentialRefreshResponse,
        });
        yield* dependencies.secrets.set(
          RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
          stringToBytes(refreshed.environmentCredential),
        );
      }),
    );
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not persist the refreshed environment credential."),
  ),
  Effect.catchTags({
    CloudCliCredentialRemovalError: failCloudCliTokenManagerError,
    CloudCliCredentialRefreshError: failCloudCliTokenManagerError,
    CloudCliCredentialReadError: failCloudCliTokenManagerError,
    CloudCliAuthorizationError: failCloudCliTokenManagerError,
    CloudCliAuthorizationTimeoutError: failCloudCliTokenManagerError,
  }),
);

// Startup registration policy. When the relay rejects the stored environment
// credential itself (invalid_bearer) and a CLI link is desired, the host
// replaces the credential and registers once more. Every other failure,
// including a 401 for a request the credential authenticated, propagates.
export const registerManagedCloudTunnelRecoveryWithCredentialRefresh = Effect.fn(
  "environment.cloud.registerManagedCloudTunnelRecoveryWithCredentialRefresh",
)(function* (
  localOrigin: string,
  options: {
    readonly retryRuntimeFailures?: boolean;
    readonly refreshRejectedCredential: boolean;
  },
) {
  const register = registerManagedTunnelReportingRejectedCredential(localOrigin, options);
  const dependencies = yield* cloudHttpDependencies;
  const registration = options.refreshRejectedCredential
    ? register.pipe(
        Effect.catchTag("RelayBearerRejectedError", (rejection) =>
          Effect.logWarning(
            "Kata Code Connect rejected the environment credential; refreshing it",
            { cause: rejection },
          ).pipe(
            Effect.andThen(refreshCloudEnvironmentCredential(dependencies)),
            Effect.andThen(register),
          ),
        ),
      )
    : register;
  return yield* registration.pipe(
    Effect.catchTag("RelayBearerRejectedError", rejectedBearerAsUnauthorized),
  );
});

export const recoverManagedCloudTunnel = Effect.fn("environment.cloud.recoverManagedCloudTunnel")(
  function* (
    localOrigin: string,
    expectedConfig?: RelayManagedEndpointRuntimeConfig,
    options?: { readonly retryRuntimeFailures?: boolean },
  ) {
    const dependencies = yield* cloudHttpDependencies;
    const [runtimeConfig, relayUrl, cloudUserId, environmentCredential] = yield* Effect.all([
      dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG),
      dependencies.secrets.get(RELAY_URL_SECRET),
      dependencies.secrets.get(CLOUD_LINKED_USER_ID),
      dependencies.secrets.get(RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
    ]);
    if (
      Option.isNone(runtimeConfig) ||
      Option.isNone(relayUrl) ||
      Option.isNone(cloudUserId) ||
      Option.isNone(environmentCredential)
    ) {
      return false;
    }
    if (expectedConfig !== undefined) {
      const current = Option.getOrNull(decodeRuntimeConfig(bytesToString(runtimeConfig.value)));
      if (
        current === null ||
        current.providerKind !== expectedConfig.providerKind ||
        current.connectorToken !== expectedConfig.connectorToken ||
        current.tunnelId !== expectedConfig.tunnelId ||
        current.tunnelName !== expectedConfig.tunnelName
      ) {
        return false;
      }
    }

    const parsedOrigin = yield* Effect.try({
      try: () => parseManagedEndpointLocalOrigin(localOrigin),
      catch: () =>
        new EnvironmentHttpBadRequestError({
          message: "Could not resolve local environment origin.",
        }),
    });

    const environmentId = yield* dependencies.environment.getEnvironmentId;
    const relayUrlValue = bytesToString(relayUrl.value);
    const cloudUserIdValue = bytesToString(cloudUserId.value);
    const origin = parsedOrigin.origin;
    const proof = yield* makeManagedTunnelRecoveryProof(dependencies, {
      action: "recover",
      environmentId,
      cloudUserId: cloudUserIdValue,
      relayUrl: relayUrlValue,
      origin,
    });
    const recovered = yield* relayClientRequest(dependencies, {
      url: `${relayUrlValue}/v1/environments/${encodeURIComponent(environmentId)}/tunnel`,
      token: bytesToString(environmentCredential.value),
      payload: {
        cloudUserId: cloudUserIdValue,
        origin,
        proof,
      },
      schema: RelayManagedEndpointRecoveryResponse,
      timeout: MANAGED_ENDPOINT_PROVISION_REQUEST_TIMEOUT,
    });
    if (recovered.endpointRuntime.providerKind !== "cloudflare_tunnel") {
      return yield* new EnvironmentHttpInternalServerError({
        message: "Kata Code Connect returned an unsupported managed tunnel configuration.",
      });
    }

    const encoded = yield* encodeEndpointRuntimeConfigJson(recovered.endpointRuntime).pipe(
      Effect.mapError(
        () =>
          new EnvironmentHttpInternalServerError({
            message: "Could not persist the recovered managed tunnel configuration.",
          }),
      ),
    );
    // A recovered tunnel can come back on a new public hostname, so routine
    // webhooks must follow the endpoint the relay just returned.
    const callbackOrigin =
      recovered.endpoint.providerKind === "cloudflare_tunnel"
        ? normalizeSecureRelayUrl(recovered.endpoint.httpBaseUrl)
        : null;
    const stored = yield* dependencies.endpointRuntime.withLinkStateLock(
      Effect.gen(function* () {
        const currentConfig = yield* dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG);
        if (
          Option.isNone(currentConfig) ||
          bytesToString(currentConfig.value) !== bytesToString(runtimeConfig.value)
        ) {
          return false;
        }
        yield* dependencies.secrets.set(CLOUD_ENDPOINT_RUNTIME_CONFIG, stringToBytes(encoded));
        yield* dependencies.secrets.remove(CLOUD_ENDPOINT_CONFIRMED_ORIGIN);
        if (callbackOrigin === null) {
          yield* dependencies.secrets.remove(CLOUD_MANAGED_ENDPOINT_URL);
        } else {
          yield* dependencies.secrets.set(
            CLOUD_MANAGED_ENDPOINT_URL,
            stringToBytes(callbackOrigin),
          );
        }
        return true;
      }),
    );
    if (!stored) return false;
    const status = yield* activateManagedTunnelWithRetry(
      dependencies,
      {
        config: recovered.endpointRuntime,
        configJson: encoded,
        origin,
      },
      options?.retryRuntimeFailures === true,
    );
    return status !== null;
  },
);

// The launcher owns this durable state, so read it directly both when a trial
// decides whether it owns pre-activation cleanup and while a server tears down.
export const pendingServiceUpdateExists = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeDir = path.join(config.baseDir, "runtime");
  const stateText = yield* fs
    .readFileString(path.join(runtimeDir, SERVICE_STATE_FILE))
    .pipe(Effect.option);
  return Option.isSome(stateText) && serviceStateHasPendingUpdate(stateText.value);
});

// A pending update alone is not proof a replacement server is coming: an
// explicit launcher stop (`katacode service uninstall`, `systemctl stop`,
// `launchctl bootout`) during
// the pending window also tears this server down. The launcher marks that case
// just before it signals the child, so pending + no marker is the handoff.
const pendingUpdateHandoffExists = Effect.gen(function* () {
  if (!(yield* pendingServiceUpdateExists)) {
    return false;
  }
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runtimeDir = path.join(config.baseDir, "runtime");
  const stopping = yield* fs
    .exists(path.join(runtimeDir, SERVICE_STOP_MARKER_FILE))
    .pipe(Effect.orElseSucceed(() => false));
  return !stopping;
});

// The desktop app writes its marker right before it stops this server to
// install an update, whether a remote client or the local app started it.
// Reading consumes it, so shutdown checks it first. Only a fresh marker counts,
// so a marker the server never read (a hard kill) cannot keep the tunnel on a
// later quit.
const desktopUpdateRestartPending = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const markerPath = path.join(config.baseDir, "runtime", DESKTOP_UPDATE_RESTART_MARKER_FILE);
  const marker = yield* fs.stat(markerPath).pipe(Effect.option);
  if (Option.isNone(marker)) {
    return false;
  }
  yield* fs.remove(markerPath).pipe(Effect.ignore);
  const now = yield* Clock.currentTimeMillis;
  return Option.match(marker.value.mtime, {
    onNone: () => false,
    onSome: (writtenAt) =>
      now - writtenAt.getTime() < Duration.toMillis(DESKTOP_UPDATE_RESTART_MARKER_TTL),
  });
});

// Cloudflare bills per provisioned tunnel, so an environment that goes offline
// must not leave its tunnel behind. Releasing deletes only the tunnel — the
// relay keeps the link and its hostname reservation, and the next startup's
// link reconcile provisions a replacement tunnel under the same URL.
export const releaseManagedTunnelOnShutdown = Effect.fn(
  "environment.cloud.releaseManagedTunnelOnShutdown",
)(function* () {
  const dependencies = yield* cloudHttpDependencies;
  // Only a managed link stores a runtime config; publish-only links have no
  // tunnel to release.
  const runtimeConfig = yield* dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG);
  if (Option.isNone(runtimeConfig)) {
    return false;
  }
  // Only CLI-desired managed links release eagerly because this request uses
  // CLI authorization. Web/mobile links register startup recovery with their
  // environment credential, and the relay reaper removes them after they are
  // down for the configured grace period. Unlink still deletes either kind.
  if (!(yield* readCliDesiredCloudLink) || (yield* readCliDesiredLinkMode) !== "managed") {
    return false;
  }
  // A shutdown that hands off to a pending update is not the environment
  // going offline: the service launcher or the desktop app immediately brings
  // a server back (the new version, or the old one after a rollback). Deleting
  // the tunnel here forces that server to provision a replacement UUID, and the
  // public hostname's route to the new tunnel takes 1-2 minutes to propagate —
  // the dominant cost of an update restart. Keep the tunnel instead: the next
  // boot respawns the connector from the stored config and is reachable as
  // soon as it connects, and the reconcile confirms the still-live tunnel
  // without replacing it.
  if ((yield* desktopUpdateRestartPending) || (yield* pendingUpdateHandoffExists)) {
    yield* Effect.logInfo("Keeping the managed tunnel across the update restart");
    return false;
  }
  const token = yield* dependencies.cliTokenManager.getExisting;
  if (Option.isNone(token)) {
    return false;
  }
  // The link belongs to the relay it was installed against, so target the
  // persisted URL: KATACODE_RELAY_URL may have changed since the link was made.
  const relayUrl = yield* dependencies.secrets.get(RELAY_URL_SECRET);
  if (Option.isNone(relayUrl)) {
    return false;
  }
  const environmentId = yield* dependencies.environment.getEnvironmentId;
  // Stop the local connector before the relay deletes the tunnel it serves.
  yield* dependencies.endpointRuntime.applyConfig(null);
  const response = yield* HttpClientRequest.delete(
    `${bytesToString(relayUrl.value)}/v1/client/environment-links/${encodeURIComponent(environmentId)}/tunnel`,
  ).pipe(
    HttpClientRequest.bearerToken(token.value.accessToken),
    dependencies.httpClient.execute,
    Effect.flatMap(filterRelayResponse),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(RelayOkResponse)),
    withRelayClientTracing,
  );
  // ok:false means the relay skipped deletion because a concurrent provision
  // owns the recorded tunnel now — leave the stored config alone.
  if (!response.ok) {
    return false;
  }
  // The connector token died with the tunnel. Drop the stored config so the
  // next start waits for the link reconcile instead of respawning the relay
  // client with a dead token. Kept when the release request fails: the tunnel
  // still exists, so the stored token keeps working across the restart.
  // Only dropped while it is still the config this shutdown released — a fast
  // restart may already have reconciled and stored a fresh config for its
  // replacement tunnel, and that one must survive this finalizer.
  const storedConfig = yield* dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG);
  if (
    Option.isSome(storedConfig) &&
    bytesToString(storedConfig.value) === bytesToString(runtimeConfig.value)
  ) {
    yield* dependencies.secrets.remove(CLOUD_ENDPOINT_RUNTIME_CONFIG);
    yield* dependencies.secrets.remove(CLOUD_ENDPOINT_CONFIRMED_ORIGIN);
  }
  return true;
});

const readCloudLinkState = Effect.fn("environment.cloud.readLinkState")(function* (
  dependencies: CloudHttpDependencies,
) {
  const [
    cloudUserId,
    relayUrl,
    relayIssuer,
    endpointRuntimeConfig,
    managedEndpointUrl,
    publishAgentActivity,
  ] = yield* Effect.all(
    [
      dependencies.secrets.get(CLOUD_LINKED_USER_ID),
      dependencies.secrets.get(RELAY_URL_SECRET),
      dependencies.secrets.get(RELAY_ISSUER_SECRET),
      dependencies.secrets.get(CLOUD_ENDPOINT_RUNTIME_CONFIG),
      dependencies.secrets.get(CLOUD_MANAGED_ENDPOINT_URL),
      dependencies.secrets.get(PUBLISH_AGENT_ACTIVITY_SECRET),
    ],
    { concurrency: 6 },
  );
  const managedTunnelActive = Option.isSome(endpointRuntimeConfig);
  const runtimeStatus = yield* dependencies.endpointRuntime.getStatus;
  return {
    linked: Option.isSome(cloudUserId),
    cloudUserId: Option.isSome(cloudUserId) ? bytesToString(cloudUserId.value) : null,
    relayUrl: Option.isSome(relayUrl) ? bytesToString(relayUrl.value) : null,
    relayIssuer: Option.isSome(relayIssuer) ? bytesToString(relayIssuer.value) : null,
    // The managed tunnel runtime config is only stored for managed links; a
    // publish-only link leaves it absent.
    managedTunnelActive,
    // The stored config survives a failed connector start so startup can retry
    // it, so the callback reads as ready only while the connector is running.
    // RoutineConnections applies the same rule before registering webhooks.
    managedCallbackReady:
      managedTunnelActive &&
      Option.isSome(managedEndpointUrl) &&
      runtimeStatus.status === "running",
    publishAgentActivity: Option.isSome(publishAgentActivity)
      ? bytesToString(publishAgentActivity.value) === "true"
      : false,
  } satisfies EnvironmentCloudLinkStateResult;
});

const cloudLinkStateHandler = Effect.fn("environment.cloud.linkState")(
  function* (dependencies: CloudHttpDependencies) {
    yield* requireEnvironmentScope(AuthRelayReadScope);
    return yield* readCloudLinkState(dependencies);
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not read environment relay configuration."),
  ),
);

const cloudUnlinkHandler = Effect.fn("environment.cloud.unlink")(
  function* (dependencies: CloudHttpDependencies) {
    yield* requireEnvironmentScope(AuthRelayWriteScope);
    return yield* dependencies.endpointRuntime.withLinkStateLock(
      Effect.gen(function* () {
        const endpointRuntimeStatus = yield* dependencies.endpointRuntime.applyConfig(null);
        yield* Effect.all(
          [
            dependencies.secrets.remove(CLOUD_LINKED_USER_ID),
            dependencies.secrets.remove(RELAY_URL_SECRET),
            dependencies.secrets.remove(RELAY_ISSUER_SECRET),
            dependencies.secrets.remove(RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
            dependencies.secrets.remove(CLOUD_MINT_PUBLIC_KEY),
            dependencies.secrets.remove(CLOUD_ENDPOINT_RUNTIME_CONFIG),
            dependencies.secrets.remove(CLOUD_MANAGED_ENDPOINT_URL),
            dependencies.secrets.remove(CLOUD_ENDPOINT_CONFIRMED_ORIGIN),
            dependencies.secrets.remove(PUBLISH_AGENT_ACTIVITY_SECRET),
          ],
          { concurrency: 9 },
        );
        yield* setCliDesiredCloudLink(false);
        return { ok: true, endpointRuntimeStatus } satisfies EnvironmentCloudRelayConfigResult;
      }),
    );
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not remove environment relay configuration."),
  ),
);

const cloudPreferencesHandler = Effect.fn("environment.cloud.preferences")(
  function* (
    dependencies: CloudHttpDependencies,
    payload: { readonly publishAgentActivity: boolean },
  ) {
    yield* requireEnvironmentScope(AuthRelayWriteScope);
    yield* dependencies.secrets.set(
      PUBLISH_AGENT_ACTIVITY_SECRET,
      stringToBytes(String(payload.publishAgentActivity)),
    );
    return yield* readCloudLinkState(dependencies);
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not persist environment cloud preferences."),
  ),
);

/**
 * Verifies a relay-signed cloud proof and consumes its replay guards. Every
 * relay-to-environment request passes the same gate: signed by the installed
 * relay for this environment, issued for the installed cloud user, short
 * lived, and used once. `accepts` adds the request-specific claims.
 */
const verifyCloudProof = Effect.fnUntraced(function* <
  Proof extends {
    readonly environmentId: string;
    readonly sub: string;
    readonly iat: number;
    readonly exp: number;
    readonly jti: string;
    readonly nonce: string;
  },
  E,
  R,
>(
  dependencies: CloudHttpDependencies,
  input: {
    readonly token: string;
    readonly typ: string;
    readonly decode: (payload: unknown) => Effect.Effect<Proof, E, R>;
    readonly accepts?: (proof: Proof) => boolean;
    readonly replayPrefix: string;
    readonly invalidMessage: string;
    readonly consumedMessage: string;
  },
) {
  const cloudMintPublicKey = yield* dependencies.secrets
    .get(CLOUD_MINT_PUBLIC_KEY)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isSome(bytes)
          ? Effect.succeed(bytesToString(bytes.value))
          : Effect.fail(new EnvironmentAuth.ServerAuthCloudMintPublicKeyMissingError({})),
      ),
    );
  const relayIssuer = yield* dependencies.secrets
    .get(RELAY_ISSUER_SECRET)
    .pipe(
      Effect.flatMap((bytes) =>
        Option.isSome(bytes)
          ? Effect.succeed(bytesToString(bytes.value))
          : dependencies.secrets
              .get(RELAY_URL_SECRET)
              .pipe(
                Effect.flatMap((fallbackBytes) =>
                  Option.isSome(fallbackBytes)
                    ? Effect.succeed(bytesToString(fallbackBytes.value))
                    : Effect.fail(new EnvironmentAuth.ServerAuthCloudRelayIssuerMissingError({})),
                ),
              ),
      ),
    );
  const environmentId = yield* dependencies.environment.getEnvironmentId;
  const linkedCloudUserId = yield* readInstalledCloudUserId(dependencies.secrets);
  const now = yield* DateTime.now;
  const nowSeconds = Math.floor(now.epochMilliseconds / 1_000);
  const proofOption = yield* verifyRelayJwt({
    publicKey: cloudMintPublicKey,
    token: input.token,
    typ: input.typ,
    issuer: normalizeRelayIssuer(relayIssuer),
    audience: wireEnvironmentIssuer(environmentId),
    nowEpochSeconds: nowSeconds,
  }).pipe(Effect.flatMap(input.decode), Effect.option);
  if (
    Option.isNone(proofOption) ||
    proofOption.value.environmentId !== environmentId ||
    proofOption.value.sub !== linkedCloudUserId ||
    !hasBoundedCloudProofLifetime({ ...proofOption.value, nowSeconds }) ||
    input.accepts?.(proofOption.value) === false
  ) {
    return yield* new EnvironmentHttpUnauthorizedError({ message: input.invalidMessage });
  }
  const proof = proofOption.value;
  const consumedReplayGuards = yield* consumeCloudReplayGuards({
    secrets: dependencies.secrets,
    names: [`${input.replayPrefix}-jti-${proof.jti}`, `${input.replayPrefix}-nonce-${proof.nonce}`],
    value: stringToBytes(DateTime.formatIso(now)),
  });
  if (!consumedReplayGuards) {
    return yield* new EnvironmentHttpConflictError({ message: input.consumedMessage });
  }
  return { proof, environmentId, relayIssuer, now, nowSeconds };
});

const cloudEnvironmentHealthHandler = Effect.fn("environment.cloud.health")(
  function* (dependencies: CloudHttpDependencies, request: RelayCloudEnvironmentHealthRequest) {
    const { proof, environmentId, relayIssuer, now, nowSeconds } = yield* verifyCloudProof(
      dependencies,
      {
        token: request.proof,
        typ: RELAY_HEALTH_REQUEST_TYP,
        decode: decodeCloudHealthProof,
        accepts: (proof) => hasExactScope({ scopes: proof.scope, expected: "environment:status" }),
        replayPrefix: "cloud-health",
        invalidMessage: "Invalid cloud health request.",
        consumedMessage: "Cloud health request was already consumed.",
      },
    );

    const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(dependencies.secrets);
    const descriptor = yield* dependencies.environment.getDescriptor;
    const responseExpiresAt = DateTime.add(now, { minutes: 5 });
    const responsePayload = {
      iss: wireEnvironmentIssuer(environmentId),
      aud: normalizeRelayIssuer(relayIssuer),
      sub: environmentId,
      jti: yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4)),
      iat: nowSeconds,
      exp: Math.floor(responseExpiresAt.epochMilliseconds / 1_000),
      environmentId,
      requestNonce: proof.nonce,
      status: "online",
      descriptor,
      checkedAt: DateTime.formatIso(now),
    } satisfies RelayEnvironmentHealthResponseProofPayload;
    const responseProof = yield* signRelayJwt({
      privateKey: keyPair.privateKey,
      typ: RELAY_HEALTH_RESPONSE_TYP,
      payload: responsePayload,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new EnvironmentAuth.ServerAuthCloudHealthJwtSigningError({
            cause,
          }),
      ),
    );
    const response = {
      environmentId,
      status: "online",
      descriptor,
      checkedAt: responsePayload.checkedAt,
      proof: responseProof,
    } satisfies RelayEnvironmentHealthResponseShape;

    yield* appendCloudCredentialResponseHeaders;
    return response;
  },
  Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
    failEnvironmentCloudInternalError(error.message)(error),
  ),
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not answer cloud health request."),
  ),
  Effect.catchTag(
    "PlatformError",
    failEnvironmentCloudInternalError("Could not answer cloud health request."),
  ),
);

const cloudMintCredentialHandler = Effect.fn("environment.cloud.mintCredential")(
  function* (dependencies: CloudHttpDependencies, request: RelayCloudMintCredentialRequest) {
    const { proof, environmentId, relayIssuer, nowSeconds } = yield* verifyCloudProof(
      dependencies,
      {
        token: request.proof,
        typ: RELAY_MINT_REQUEST_TYP,
        decode: decodeCloudMintProof,
        accepts: (proof) =>
          proof.cnf.jkt === proof.clientProofKeyThumbprint &&
          hasExactScope({ scopes: proof.scope, expected: "environment:connect" }),
        replayPrefix: "cloud-mint",
        invalidMessage: "Invalid cloud mint request.",
        consumedMessage: "Cloud mint request was already consumed.",
      },
    );

    const keyPair = yield* getOrCreateEnvironmentKeyPairFromSecretStore(dependencies.secrets);
    const issued = yield* dependencies.environmentAuth.createPairingLink({
      scopes: AuthStandardClientScopes,
      subject: "cloud-connect",
      ttl: Duration.minutes(2),
      label: "Kata Code Connect connect",
      proofKeyThumbprint: proof.clientProofKeyThumbprint,
    });
    const responsePayload = {
      iss: wireEnvironmentIssuer(environmentId),
      aud: normalizeRelayIssuer(relayIssuer),
      sub: environmentId,
      jti: yield* Crypto.Crypto.pipe(Effect.flatMap((crypto) => crypto.randomUUIDv4)),
      iat: nowSeconds,
      exp: Math.floor(issued.expiresAt.epochMilliseconds / 1_000),
      environmentId,
      clientProofKeyThumbprint: proof.clientProofKeyThumbprint,
      requestNonce: proof.nonce,
      credential: issued.credential,
    } satisfies RelayEnvironmentMintResponseProofPayload;
    const responseProof = yield* signRelayJwt({
      privateKey: keyPair.privateKey,
      typ: RELAY_MINT_RESPONSE_TYP,
      payload: responsePayload,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new EnvironmentAuth.ServerAuthCloudMintJwtSigningError({
            cause,
          }),
      ),
    );
    const response = {
      credential: issued.credential,
      expiresAt: DateTime.formatIso(issued.expiresAt),
      proof: responseProof,
    } satisfies RelayEnvironmentMintResponseShape;

    yield* appendCloudCredentialResponseHeaders;
    return response;
  },
  Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
    failEnvironmentCloudInternalError(error.message)(error),
  ),
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not issue cloud connection credential."),
  ),
  Effect.catchTag(
    "PlatformError",
    failEnvironmentCloudInternalError("Could not issue cloud connection credential."),
  ),
);

const cloudLinearOAuthDeliveryHandler = Effect.fn("environment.cloud.linearOAuthDelivery")(
  function* (dependencies: CloudHttpDependencies, request: RelayCloudLinearOAuthDeliveryRequest) {
    const { proof } = yield* verifyCloudProof(dependencies, {
      token: request.proof,
      typ: RELAY_LINEAR_OAUTH_DELIVERY_TYP,
      decode: decodeCloudLinearOAuthDeliveryProof,
      replayPrefix: "cloud-linear-oauth",
      invalidMessage: "Invalid Linear OAuth delivery.",
      consumedMessage: "Linear OAuth delivery was already consumed.",
    });

    yield* saveLinearAccessToken({
      secrets: dependencies.secrets,
      connectionId: proof.connectionId,
      token: proof.token,
    });
    yield* Effect.logInfo("Stored Linear access token", {
      connectionId: proof.connectionId,
      outcome: "stored",
    });
    return { ok: true } satisfies RelayOkResponse;
  },
  Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
    failEnvironmentCloudInternalError(error.message)(error),
  ),
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not store Linear OAuth delivery."),
  ),
  Effect.catchTag("RoutineError", (error) =>
    failEnvironmentCloudInternalError(error.message)(error),
  ),
);

export const connectHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "connect",
  Effect.fnUntraced(function* (handlers) {
    const dependencies = yield* cloudHttpDependencies;
    return handlers
      .handle("linkProof", ({ payload }) => cloudLinkProofHandler(dependencies, payload))
      .handle("relayConfig", ({ payload }) => cloudRelayConfigHandler(dependencies, payload))
      .handle("linkState", () => cloudLinkStateHandler(dependencies))
      .handle("unlink", () => cloudUnlinkHandler(dependencies))
      .handle("preferences", ({ payload }) => cloudPreferencesHandler(dependencies, payload))
      .handle("health", ({ payload }) => cloudEnvironmentHealthHandler(dependencies, payload))
      .handle("mintCredential", ({ payload }) => cloudMintCredentialHandler(dependencies, payload))
      .handle("kataConnectMintCredential", ({ payload }) =>
        traceRelayRequest(cloudMintCredentialHandler(dependencies, payload)),
      )
      .handle("linearOAuthDelivery", ({ payload }) =>
        cloudLinearOAuthDeliveryHandler(dependencies, payload),
      );
  }),
);
