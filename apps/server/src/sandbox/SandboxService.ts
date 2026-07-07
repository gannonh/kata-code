/**
 * `SandboxService` — server-side orchestration for sandbox environments.
 * Builds a `SandboxProviderRegistry` with the Docker driver registered,
 * materializes instances from settings, and implements the `sandbox.*` RPC
 * handlers: list, test connection (streaming), start session (provision +
 * Connect-register), dispose.
 *
 * Phase 1: the Docker driver over the raw Engine API. Connect auto-registration
 * (per-deployment link via `environmentKeys` + `reconcileDesiredCloudLink`) is
 * wired as a hook; the loopback endpoint is returned for the deploying desktop
 * regardless. The "second paired client reaches it via Connect" slice (AC-1.11)
 * is exercised via the relay managed-endpoint path and recorded as manual UAT.
 *
 * @module SandboxService
 */
import * as NodeCrypto from "node:crypto";
import * as os from "node:os";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import {
  AuthAccessTokenResult,
  AuthAccessTokenType,
  AuthAdministrativeScopes,
  AuthEnvironmentBootstrapTokenType,
  AuthTokenExchangeGrantType,
  type AdvertisedEndpoint,
  type AdvertisedEndpointProvider,
  type ExecutionEnvironmentDescriptor,
  ExecutionEnvironmentDescriptor as ExecutionEnvironmentDescriptorSchema,
  type ServerSettings,
} from "@kata-sh/code-contracts";
import { createAdvertisedEndpoint } from "@kata-sh/code-shared/advertisedEndpoint";
import { encodeOAuthScope } from "@kata-sh/code-shared/oauthScope";
import {
  type SandboxProviderInstanceConfigMap,
  SandboxProviderInstanceId,
} from "@kata-sh/code-contracts/sandboxProviderInstance";
import type {
  ProviderInstanceEnvironment,
  ProviderInstanceEnvironmentVariable,
} from "@kata-sh/code-contracts";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";
import { RepositoryCanonicalKey } from "@kata-sh/code-contracts";
import {
  type SandboxInstanceSummary,
  type SandboxProviderLoginEvent,
  type SandboxRenewSessionInput,
  type SandboxResumeSessionInput,
  type SandboxStartSessionInput,
  type SandboxTestConnectionProgressEvent,
  SandboxRpcError,
} from "@kata-sh/code-contracts/sandboxRpc";
import { SandboxProviderRegistry } from "@kata-sh/code-sandbox/registry";
import {
  SandboxProviderError,
  type SandboxHandle,
  type SandboxProvider,
} from "@kata-sh/code-sandbox/driver";
import {
  DEFAULT_DOCKER_CONFIG,
  DockerSandboxProvider,
  dockerConfigDecoder,
} from "@kata-sh/code-sandbox-docker";
import {
  VercelSandboxProvider,
  VERCEL_KIND,
  vercelConfigDecoder,
  mergeVercelAuthIntoConfig,
} from "@kata-sh/code-sandbox-vercel";
import {
  type RelayEnvironmentConfigRequest,
  RelayEnvironmentLinkChallengeResponse,
  RelayEnvironmentLinkResponse,
  type RelayLinkProofRequest,
  type RelayManagedEndpointProviderKind,
  RelayOkResponse,
} from "@kata-sh/code-contracts/relay";
import { WIRE_ENVIRONMENT_WELL_KNOWN_PATH } from "@kata-sh/code-contracts/wireIdentity";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { relayUrlConfig } from "../cloud/publicConfig.ts";
import { EnvironmentConfigLoadError, loadEnvironmentConfig } from "./environmentConfigLoader.ts";
import { buildCredentialSeedArchives } from "./credentialSeed.ts";
import { type SetupProcessRecord, SetupFailed, runSandboxSetup } from "./sandboxSetupRunner.ts";
import { type KeepaliveHandle, startSessionKeepalive } from "./sessionKeepalive.ts";
import { loadStoredSandboxCredentials } from "./storedSandboxCredentials.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import {
  startProviderLogin,
  submitProviderLoginCode,
  PROVIDER_LOGIN_SPECS,
} from "./providerLogin.ts";

/** A sandbox `AdvertisedEndpointProvider` (manual kind; container-sourced). */
const SANDBOX_ENDPOINT_PROVIDER: AdvertisedEndpointProvider = {
  id: "sandbox-container",
  label: "Container",
  kind: "manual",
  isAddon: false,
};

/** A Vercel Sandbox `AdvertisedEndpointProvider` (manual kind; public-sourced). */
const VERCEL_ENDPOINT_PROVIDER: AdvertisedEndpointProvider = {
  id: "sandbox-vercel",
  label: "Vercel Sandbox",
  kind: "manual",
  isAddon: false,
};

/** Deadline for Connect/container HTTP fetches (bootstrap token exchange,
 * well-known descriptor, relay link/config calls). A hung network call aborts
 * and surfaces as a `connect-failed` SandboxRpcError instead of pending. */
const SANDBOX_FETCH_TIMEOUT_MS = 30_000;

function buildRegistry(): SandboxProviderRegistry {
  const registry = new SandboxProviderRegistry();
  registry.register(DockerSandboxProvider, dockerConfigDecoder);
  registry.register(VercelSandboxProvider, vercelConfigDecoder);
  return registry;
}

/**
 * Merge materialized Vercel auth secrets into the driver config payload before
 * the registry decodes it. The trio flows through the generic `sandbox-env-*`
 * secret path (`materializeSandboxProviderEnvironmentSecrets`); the driver's
 * `validate` receives only the decoded config, so the server injects `auth`
 * here. Non-vercel envelopes pass through unchanged.
 */
function resolveInstanceEnvelope(
  config: SandboxProviderInstanceConfig,
): SandboxProviderInstanceConfig {
  return (config.driver as string) === (VERCEL_KIND as string)
    ? mergeVercelAuthIntoConfig(config)
    : config;
}

type Materialized = ReturnType<SandboxProviderRegistry["materializeOne"]>;

function toSummary(inst: Materialized): Effect.Effect<SandboxInstanceSummary, never> {
  if (inst.kind === "unavailable") {
    return Effect.succeed({
      kind: "unavailable",
      instanceId: inst.instanceId,
      reason: inst.reason,
      message: inst.message,
    });
  }
  return Effect.gen(function* () {
    const descriptor = yield* inst.driver.describe();
    const runningSession = runningSessions.get(inst.instanceId as string);
    return {
      kind: "available",
      instanceId: inst.instanceId,
      driver: descriptor.kind as string,
      reachabilityKind: descriptor.reachabilityKind,
      supportsSnapshot: descriptor.supportsSnapshot,
      supportsRenewTimeout: descriptor.supportsRenewTimeout,
      supportsResume: descriptor.supportsResume,
      ...(runningSession
        ? {
            runningSession: {
              environmentId: runningSession.environmentId,
              endpoint: runningSession.endpoint,
              status: runningSession.status,
              ...(runningSession.deadlineEpochMs !== undefined
                ? { deadlineEpochMs: runningSession.deadlineEpochMs }
                : {}),
              ...(runningSession.snapshotId !== undefined
                ? { snapshotId: runningSession.snapshotId }
                : {}),
              ...(runningSession.lapsedReason !== undefined
                ? { lapsedReason: runningSession.lapsedReason }
                : {}),
            },
          }
        : {}),
    };
  });
}

/**
 * Turn an effect into an Either-shaped `{ _tag: "Left"|"Right" }` value.
 * `Effect.either` is not exported in the installed Effect (4.0.0-beta.78);
 * `Effect.matchEffect` is the canonical primitive for collapsing the error
 * channel into a value. The explicit `_tag` union is what the `testConnection`
 * stream pipeline narrows on per step.
 */
function either<A, E>(
  eff: Effect.Effect<A, E>,
): Effect.Effect<{ _tag: "Left"; left: E } | { _tag: "Right"; right: A }, never> {
  return Effect.matchEffect(eff, {
    onFailure: (left) => Effect.succeed<{ _tag: "Left"; left: E }>({ _tag: "Left", left }),
    onSuccess: (right) => Effect.succeed<{ _tag: "Right"; right: A }>({ _tag: "Right", right }),
  });
}

/** Map a loader failure to the RPC error channel. */
function mapLoadError(e: EnvironmentConfigLoadError): SandboxRpcError {
  return new SandboxRpcError({ reason: "invalid-config", message: e.message });
}

/** Map a setup-runner failure to the RPC error channel. */
function mapSetupFailed(e: SetupFailed): SandboxRpcError {
  return new SandboxRpcError({
    reason: "provision-failed",
    message: `Setup failed (${e.stage}): ${e.message}`,
  });
}

/** Seed provider credentials (static config + auth) into the container home.
 *  Runs unconditionally after provision, before the repo seed. Returns void on
 *  success; failures map to SetupFailed/SandboxProviderError via the caller. */
function runCredentialSeed(
  driver: SandboxProvider,
  handle: SandboxHandle,
): Effect.Effect<void, SetupFailed | SandboxProviderError, ServerSecretStore> {
  return Effect.gen(function* () {
    const copyIntoCap = driver.copyInto;
    if (!copyIntoCap) return; // driver without copyInto — cloud drivers seed via their own mechanism
    // Load stored credentials (captured via the Sign-in flow) and merge them
    // into the credentials archive. Host-collected files win on collision.
    const storedCredentials = yield* loadStoredSandboxCredentials().pipe(
      Effect.catch(() => Effect.succeed([] as never)),
    );
    const archives = yield* buildCredentialSeedArchives({
      hostHome: os.homedir(),
      ...(storedCredentials.length > 0 ? { storedCredentials } : {}),
    }).pipe(
      Effect.mapError(
        (e) =>
          new SetupFailed({
            stage: "seed",
            message: `credential seed build failed: ${e.message}`,
            cause: e,
          }),
      ),
    );
    if (archives.static) {
      yield* copyIntoCap.copyInto(handle, archives.static, "/home/katacode").pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "seed",
              message: `credential static copyInto failed: ${e.message}`,
              cause: e,
            }),
        ),
      );
    }
    if (archives.credentials) {
      yield* copyIntoCap.copyInto(handle, archives.credentials, "/home/katacode").pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "seed",
              message: `credential auth copyInto failed: ${e.message}`,
              cause: e,
            }),
        ),
      );
    }
  });
}

/** Append a user-facing hint when a Connect registration error is caused by
 *  a stale or invalid relay bearer token (e.g. after a relay redeploy). The
 *  desktop UI passes a Clerk session token as `connectAuthToken`; signing out
 *  and back in refreshes it. */
function withConnectAuthHint(message: string): string {
  if (/invalid_bearer|RelayAuthInvalidError|auth_invalid/i.test(message)) {
    return `${message} — Sign out and back in to Kata Code Connect to refresh your session, then retry.`;
  }
  return message;
}

/** Collect provision env tuples and secret values for setup-output redaction. */
function buildProvisionEnvironment(input: {
  readonly bootstrapToken: string;
  readonly instanceEnvironment?: ProviderInstanceEnvironment | undefined;
  readonly savedEnvironment?: ProviderInstanceEnvironment | undefined;
}): {
  readonly env: ReadonlyArray<readonly [string, string]>;
  readonly secretValues: ReadonlyArray<string>;
} {
  const byName = new Map<string, ProviderInstanceEnvironmentVariable>();
  for (const variable of input.instanceEnvironment ?? []) {
    byName.set(variable.name, variable);
  }
  for (const variable of input.savedEnvironment ?? []) {
    byName.set(variable.name, variable);
  }
  const env: Array<readonly [string, string]> = [
    ["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", input.bootstrapToken],
  ];
  const secretValues: string[] = [input.bootstrapToken];
  for (const variable of byName.values()) {
    env.push([variable.name, variable.value]);
    if (variable.sensitive && variable.value.length > 0) {
      secretValues.push(variable.value);
    }
  }
  return { env, secretValues };
}

/** Dispose a provisioned sandbox after a post-provision failure. */
function disposeAfterFailure(
  sessionKey: string,
  driver: SandboxProvider,
  handle: SandboxHandle,
): Effect.Effect<void, never> {
  return Effect.sync(() => runningSessions.delete(sessionKey)).pipe(
    Effect.andThen(
      driver.dispose(handle).pipe(
        Effect.catch((disposeError) =>
          Effect.logWarning("Could not dispose sandbox after startSession failure", {
            cause: disposeError,
          }),
        ),
      ),
    ),
  );
}

/** Shared post-provision/resume finalization: reachability → endpoint →
 *  Connect registration → pairing credential → provider refresh. Returns the
 *  descriptor, admin token, relay info, pairing token, and endpoint so callers
 *  (startSession, resumeSession) can populate the RunningSession record. */
function registerAndFinalizeSession(input: {
  readonly sessionKey: string;
  readonly instanceId: SandboxProviderInstanceId;
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly config: SandboxProviderInstanceConfig;
  readonly bootstrapToken: string;
  readonly connectAuthToken: SandboxStartSessionInput["connectAuthToken"];
}): Effect.Effect<
  {
    readonly environmentId: string;
    readonly adminAccessToken: string;
    readonly relay: { readonly relayUrl: string; readonly bearerToken: string } | null;
    readonly pairingToken: string;
    readonly endpoint: AdvertisedEndpoint;
  },
  SandboxRpcError,
  CliTokenManager.CloudCliTokenManager
> {
  return Effect.gen(function* () {
    const driverConfig = input.config.config;
    const reach = yield* input.driver
      .reachability(input.handle, resolveSandboxPort(driverConfig))
      .pipe(
        Effect.mapError(mapDriverError),
        Effect.catch((error: SandboxRpcError) =>
          disposeAfterFailure(input.sessionKey, input.driver, input.handle).pipe(
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      );
    const isVercel = (input.driver.kind as string) === (VERCEL_KIND as string);
    const endpointProvider = isVercel ? VERCEL_ENDPOINT_PROVIDER : SANDBOX_ENDPOINT_PROVIDER;
    const endpoint: AdvertisedEndpoint = createAdvertisedEndpoint({
      id: `sandbox-${input.instanceId as string}`,
      label:
        input.config.displayName ??
        (isVercel
          ? `Vercel ${input.instanceId as string}`
          : `Container ${input.instanceId as string}`),
      provider: endpointProvider,
      httpBaseUrl: reach.httpBaseUrl,
      reachability: reach.reachabilityKind,
      source: "server",
    });
    const isLoopback = reach.reachabilityKind === "loopback";
    const connectBaseUrl = isLoopback
      ? reach.httpBaseUrl.replace("localhost", "127.0.0.1")
      : reach.httpBaseUrl;
    const connectUrl = new URL(connectBaseUrl);
    const connectOrigin = isLoopback
      ? { localHttpHost: "127.0.0.1", localHttpPort: Number(connectUrl.port || 80) }
      : { localHttpHost: connectUrl.hostname, localHttpPort: Number(connectUrl.port || 443) };
    const endpointProviderKind = (
      isLoopback ? "cloudflare_tunnel" : "manual"
    ) as RelayManagedEndpointProviderKind;
    const { descriptor, adminAccessToken, relay } = yield* registerSandboxWithConnect({
      httpBaseUrl: connectBaseUrl,
      bootstrapToken: input.bootstrapToken,
      connectAuthToken: input.connectAuthToken,
      endpointProviderKind,
      origin: connectOrigin,
    }).pipe(
      Effect.catch((error: SandboxRpcError) =>
        disposeAfterFailure(input.sessionKey, input.driver, input.handle).pipe(
          Effect.andThen(
            Effect.fail(
              new SandboxRpcError({
                reason: "connect-failed",
                message: withConnectAuthHint(`Connect auto-registration failed: ${error.message}`),
              }),
            ),
          ),
        ),
      ),
    );
    const pairingToken = yield* issueSandboxPairingCredential({
      httpBaseUrl: connectBaseUrl,
      adminAccessToken,
    }).pipe(
      Effect.catch((error: SandboxRpcError) =>
        disposeAfterFailure(input.sessionKey, input.driver, input.handle).pipe(
          Effect.andThen(
            Effect.fail(
              new SandboxRpcError({
                reason: "connect-failed",
                message: `Could not issue a sandbox pairing credential: ${error.message}`,
              }),
            ),
          ),
        ),
      ),
    );
    yield* refreshSandboxProviders({
      httpBaseUrl: connectBaseUrl,
      adminAccessToken,
    }).pipe(
      Effect.catchTag("SandboxRpcError", (error: SandboxRpcError) =>
        Effect.logWarning("Could not refresh sandbox providers after credential seed", {
          message: error.message,
        }).pipe(Effect.asVoid),
      ),
    );
    return {
      environmentId: descriptor.environmentId,
      adminAccessToken,
      relay: relay ?? null,
      pairingToken,
      endpoint,
    };
  });
}

/** Map a driver `SandboxProviderError` to the RPC `SandboxRpcError`. */
function mapDriverError(e: SandboxProviderError): SandboxRpcError {
  let reason: SandboxRpcError["reason"];
  switch (e.reason) {
    case "invalid-config":
      reason = "invalid-config";
      break;
    case "unreachable":
      reason = "unreachable";
      break;
    case "provision-failed":
    case "dispose-failed":
    case "exec-failed":
      reason = "provision-failed";
      break;
    default:
      reason = "internal";
  }
  return new SandboxRpcError({ reason, message: e.message });
}

/** Map a registry unavailable reason to an RPC error. `SandboxRpcError`
 * already lists every registry reason, so the reason is passed through verbatim
 * (a deliberately-disabled instance must surface as `disabled`, not
 * `invalid-config`). */
function registryError(
  reason: "unknown-driver" | "disabled" | "invalid-config",
  message: string,
): SandboxRpcError {
  return new SandboxRpcError({ reason, message });
}

/** Best-effort message from any error value (Connect/relay errors are a union). */
function errorToMessage(e: unknown): string {
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
}

/** Resolve the base image for a provision request from the decoded driver
 * config, falling back to the Docker default when the config omits one.
 * The driver treats `req.image` as authoritative, so passing the configured
 * image (rather than always the default) honors user-configured targets. */
function resolveProvisionImage(config: unknown): string {
  if (
    config !== null &&
    typeof config === "object" &&
    typeof (config as { image?: unknown }).image === "string"
  ) {
    return (config as { image: string }).image;
  }
  return DEFAULT_DOCKER_CONFIG.image;
}

/** Resolve the in-sandbox port the Kata server listens on from the decoded
 *  driver config (duck-typed `port` number). Falls back to 13773. */
function resolveSandboxPort(config: unknown): number {
  if (
    config !== null &&
    typeof config === "object" &&
    typeof (config as { port?: unknown }).port === "number"
  ) {
    return (config as { port: number }).port;
  }
  return 13773;
}

async function readResponseBody(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null && "message" in parsed) {
      return String((parsed as { message: unknown }).message);
    }
    if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
      const error = String((parsed as { error: unknown }).error);
      const description =
        "error_description" in parsed
          ? String((parsed as { error_description: unknown }).error_description)
          : "";
      return description ? `${error}: ${description}` : error;
    }
  } catch {
    // The raw response text is more useful than a JSON parse failure here.
  }
  return text;
}

async function fetchAndDecodeJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  init?: RequestInit,
): Promise<S["Type"]> {
  // Bound every Connect/container fetch so a hung network call fails loudly
  // instead of leaving startSession/testConnection pending indefinitely.
  // @effect-diagnostics-next-line globalFetch:off - probes another Kata server endpoint from the sandbox orchestrator.
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(SANDBOX_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${url} failed: ${await readResponseBody(response)}`);
  }
  return Schema.decodeUnknownSync(schema)(await response.json());
}

function fetchJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  init?: RequestInit,
): Effect.Effect<S["Type"], SandboxRpcError> {
  return Effect.tryPromise({
    try: () => fetchAndDecodeJson(schema, url, init),
    catch: (cause) =>
      new SandboxRpcError({
        reason: "connect-failed",
        message: errorToMessage(cause),
      }),
  });
}

function postJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  payload: unknown,
  bearerToken?: string,
): Effect.Effect<S["Type"], SandboxRpcError> {
  return fetchJson(schema, url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
}

function deleteJson<S extends Schema.Decoder<unknown>>(
  schema: S,
  url: string,
  bearerToken?: string,
): Effect.Effect<S["Type"], SandboxRpcError> {
  return fetchJson(schema, url, {
    method: "DELETE",
    headers: bearerToken ? { authorization: `Bearer ${bearerToken}` } : {},
  });
}

function exchangeBootstrapToken(input: {
  readonly httpBaseUrl: string;
  readonly bootstrapToken: string;
}): Effect.Effect<AuthAccessTokenResult, SandboxRpcError> {
  const body = new URLSearchParams({
    grant_type: AuthTokenExchangeGrantType,
    subject_token: input.bootstrapToken,
    subject_token_type: AuthEnvironmentBootstrapTokenType,
    requested_token_type: AuthAccessTokenType,
    scope: encodeOAuthScope(AuthAdministrativeScopes),
    client_label: "Kata Code sandbox environment",
    client_device_type: "desktop",
  });
  return fetchJson(AuthAccessTokenResult, `${input.httpBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function resolveConnectAuthToken(
  connectAuthToken: SandboxStartSessionInput["connectAuthToken"],
): Effect.Effect<string, SandboxRpcError, CliTokenManager.CloudCliTokenManager> {
  if (connectAuthToken) return Effect.succeed(connectAuthToken);
  return Effect.gen(function* () {
    const tokens = yield* CliTokenManager.CloudCliTokenManager;
    const token = yield* tokens.getExisting.pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Could not read Kata Code Connect authorization: ${cause.message}`,
          }),
      ),
    );
    return yield* Option.match(token, {
      onNone: () =>
        Effect.fail(
          new SandboxRpcError({
            reason: "connect-failed",
            message: "Sign in to Kata Code Connect before starting a deployment session.",
          }),
        ),
      onSome: (value) => Effect.succeed(value.accessToken),
    });
  });
}

function registerSandboxWithConnect(input: {
  readonly httpBaseUrl: string;
  readonly bootstrapToken: string;
  readonly connectAuthToken: SandboxStartSessionInput["connectAuthToken"];
  /** Relay endpoint provider kind: `cloudflare_tunnel` for loopback, `manual` for public. */
  readonly endpointProviderKind: RelayManagedEndpointProviderKind;
  /** Origin the relay reaches the sandbox at (loopback: 127.0.0.1 + port; public: hostname + 443). */
  readonly origin: { readonly localHttpHost: string; readonly localHttpPort: number };
}): Effect.Effect<
  {
    readonly descriptor: ExecutionEnvironmentDescriptor;
    readonly adminAccessToken: string;
    readonly relay?: { readonly relayUrl: string; readonly bearerToken: string } | null;
  },
  SandboxRpcError,
  CliTokenManager.CloudCliTokenManager
> {
  return Effect.gen(function* () {
    const relayUrl = yield* relayUrlConfig.pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `KATACODE_RELAY_URL is not configured for sandbox Connect registration: ${String(cause)}`,
          }),
      ),
    );
    const bearerToken = yield* resolveConnectAuthToken(input.connectAuthToken);
    const session = yield* exchangeBootstrapToken(input);
    const descriptor = yield* fetchJson(
      ExecutionEnvironmentDescriptorSchema,
      `${input.httpBaseUrl}${WIRE_ENVIRONMENT_WELL_KNOWN_PATH}`,
    );
    const endpoint = {
      httpBaseUrl: input.httpBaseUrl,
      wsBaseUrl: input.httpBaseUrl.replace(/^http/u, "ws"),
      providerKind: input.endpointProviderKind,
    };
    const challenge = yield* postJson(
      RelayEnvironmentLinkChallengeResponse,
      `${relayUrl}/v1/client/environment-link-challenges`,
      {
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled: true,
      },
      bearerToken,
    );
    const proofRequest: RelayLinkProofRequest = {
      challenge: challenge.challenge,
      relayIssuer: relayUrl,
      endpoint,
      origin: {
        localHttpHost: input.origin.localHttpHost,
        localHttpPort: input.origin.localHttpPort,
      },
    };
    const proof = yield* postJson(
      Schema.String,
      `${input.httpBaseUrl}/api/connect/link-proof`,
      proofRequest,
      session.access_token,
    );
    const link = yield* postJson(
      RelayEnvironmentLinkResponse,
      `${relayUrl}/v1/client/environment-links`,
      {
        proof,
        notificationsEnabled: true,
        liveActivitiesEnabled: true,
        managedTunnelsEnabled: true,
      },
      bearerToken,
    );
    if (link.environmentId !== descriptor.environmentId) {
      return yield* new SandboxRpcError({
        reason: "connect-failed",
        message: "Relay returned credentials for a different sandbox environment.",
      });
    }
    const relayConfig: RelayEnvironmentConfigRequest = {
      relayUrl,
      relayIssuer: link.relayIssuer,
      cloudUserId: link.cloudUserId,
      environmentCredential: link.environmentCredential,
      cloudMintPublicKey: link.cloudMintPublicKey,
      endpointRuntime: link.endpointRuntime,
    };
    yield* postJson(
      RelayConfigResponse,
      `${input.httpBaseUrl}/api/connect/relay-config`,
      relayConfig,
      session.access_token,
    );
    return {
      descriptor,
      adminAccessToken: session.access_token,
      relay: { relayUrl, bearerToken },
    };
  });
}

/** Wire shape of the pairing-token response. Decoded from raw JSON, so
 * `expiresAt` stays a string here (the full `AuthPairingCredentialResult`
 * schema expects a decoded DateTime). Only `credential` is used. */
const SandboxPairingCredentialWire = Schema.Struct({
  credential: Schema.String,
});

/** Mint a fresh pairing credential from the in-container server. The desktop
 * bootstrap token is single-use and is consumed by Connect registration, so
 * the deploying client needs its own credential to save the sandbox as an
 * environment. */
function issueSandboxPairingCredential(input: {
  readonly httpBaseUrl: string;
  readonly adminAccessToken: string;
}): Effect.Effect<string, SandboxRpcError> {
  return postJson(
    SandboxPairingCredentialWire,
    `${input.httpBaseUrl}/api/auth/pairing-token`,
    { label: "Deploying desktop" },
    input.adminAccessToken,
  ).pipe(Effect.map((credential) => credential.credential));
}

/** Re-probe all providers on the sandbox server via the `/api/providers/refresh`
 *  HTTP endpoint. Called after credentials are seeded via copyInto so the
 *  sandbox server re-probes with auth in place. The initial boot probe may
 *  have fired before credentials were in the container home. */
function refreshSandboxProviders(input: {
  readonly httpBaseUrl: string;
  readonly adminAccessToken: string;
}): Effect.Effect<void, SandboxRpcError> {
  // Best-effort: a 200 with any body is a successful refresh. The refreshed
  // provider statuses flow to clients via the WS serverConfig stream.
  return fetchJson(Schema.Unknown, `${input.httpBaseUrl}/api/providers/refresh`, {
    method: "POST",
    headers: { authorization: `Bearer ${input.adminAccessToken}` },
  }).pipe(Effect.asVoid);
}

const RelayConfigResponse = Schema.Struct({ ok: Schema.Boolean });

/** A running sandbox session: the provisioned handle plus the driver that
 * created it, so `disposeSession` routes to the correct driver rather than a
 * hardcoded one. Phase 1; not durable (server restart cannot reclaim these —
 * see deferred-work for a startup container sweep). */
interface RunningSession {
  handle: SandboxHandle;
  readonly driver: SandboxProvider;
  readonly setupProcesses: ReadonlyArray<SetupProcessRecord>;
  environmentId: string;
  endpoint: AdvertisedEndpoint;
  /** Relay link info for unlinking on dispose. */
  relay?: { readonly relayUrl: string; readonly bearerToken: string } | null;
  /** Phase 3b lifecycle. */
  status: "running" | "lapsed";
  deadlineEpochMs: number | undefined;
  lapsedReason: string | undefined;
  snapshotId: string | undefined;
  keepalive?: KeepaliveHandle | null;
  /** Cached resolved envelope for resume (rebuilds serve env without re-reading settings). */
  readonly instanceConfig: SandboxProviderInstanceConfig;
}

/** Mark a running session lapsed: stop keepalive, set status/reason. Keeps the
 *  relay link so resume re-registers over the same environment id. In-flight
 *  agent streams surface the endpoint-unreachable error the client already shows. */
function markSessionLapsed(sessionKey: string, reason: string): void {
  const record = runningSessions.get(sessionKey);
  if (record === undefined) return;
  record.keepalive?.stop();
  record.keepalive = null;
  record.status = "lapsed";
  record.lapsedReason = reason;
}

/** Resolve the configured timeout window (ms) from a decoded driver config. */
function resolveSandboxTimeoutMs(config: unknown): number {
  if (
    config !== null &&
    typeof config === "object" &&
    typeof (config as { timeoutMs?: unknown }).timeoutMs === "number"
  ) {
    return (config as { timeoutMs: number }).timeoutMs;
  }
  return 2_700_000;
}

/** In-memory map of running sessions (instanceId → handle + driver + endpoint). Phase 1; not durable. */
const runningSessions = new Map<string, RunningSession>();

/** In-flight provisioning reservations (instanceId). Prevents concurrent startSession
 * calls from racing past the runningSessions check and booting duplicate containers.
 * Cleared in an ensuring block after provision completes (success or failure). */
const startingSessions = new Set<string>();

/**
 * The live sandbox service. `startSession` requires the Kata Code Connect
 * service environment (read by `reconcileDesiredCloudLink`) in its context; the
 * other methods are self-contained. The `R` channel is inferred rather than
 * pinned so the Connect deps flow through to the ws handler runtime.
 */
export const SandboxServiceLive = {
  listInstances: (settings: ServerSettings) =>
    Effect.gen(function* () {
      const registry = buildRegistry();
      const rawMap = settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap;
      const resolvedMap: SandboxProviderInstanceConfigMap = Object.fromEntries(
        Object.entries(rawMap).map(([id, cfg]) => [
          id,
          resolveInstanceEnvelope(cfg as SandboxProviderInstanceConfig),
        ]),
      ) as SandboxProviderInstanceConfigMap;
      const materialized = registry.materialize(resolvedMap);
      return yield* Effect.forEach(materialized, toSummary, { concurrency: "unbounded" });
    }),

  testConnection: (instanceId: SandboxProviderInstanceId, settings: ServerSettings) =>
    Stream.fromEffect(
      Effect.gen(function* () {
        const registry = buildRegistry();
        const config = (settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap)[
          instanceId as SandboxProviderInstanceId
        ];
        if (config === undefined) {
          return yield* new SandboxRpcError({
            reason: "invalid-config",
            message: "instance not found",
          });
        }
        const inst = registry.materializeOne(instanceId, resolveInstanceEnvelope(config));
        if (inst.kind !== "available") {
          return yield* registryError(inst.reason, inst.message);
        }
        return inst;
      }),
    ).pipe(
      // Stream level 1 — resolve the instance from settings. Errors here are
      // terminal (raised as `SandboxRpcError`); per-step progress below uses
      // `either()` so a step failure is encoded as `{ ok: false }` and the
      // stream stops emitting further steps for that instance.
      Stream.flatMap((inst) => {
        const validate = Stream.fromEffect(
          either(inst.driver.validate(inst.config)).pipe(
            Effect.map(
              (v): SandboxTestConnectionProgressEvent => ({
                stage: "validate",
                ok: v._tag === "Right",
                ...(v._tag === "Left" ? { detail: v.left.message } : {}),
              }),
            ),
          ),
        );
        // Stream level 2 — if validate failed, emit just the validate event;
        // otherwise run provision and carry both the result and its event.
        return validate.pipe(
          Stream.flatMap((validateEvent) => {
            if (!validateEvent.ok) return Stream.make(validateEvent);
            const provision = Stream.fromEffect(
              either(
                inst.driver.provision({
                  instanceId: instanceId as string,
                  config: inst.config,
                  image: resolveProvisionImage(inst.config),
                  env: [],
                }),
              ).pipe(
                Effect.map((p) => ({
                  p,
                  event: {
                    stage: "provision",
                    ok: p._tag === "Right",
                    ...(p._tag === "Left" ? { detail: p.left.message } : {}),
                  } satisfies SandboxTestConnectionProgressEvent,
                })),
              ),
            );
            // Stream level 3 — on provision success, dispose the throwaway
            // container and emit provision + dispose + done. On failure, emit
            // just the provision event.
            return Stream.concat(
              Stream.make(validateEvent),
              provision.pipe(
                Stream.flatMap(({ p, event }) => {
                  if (p._tag === "Left") return Stream.make(event);
                  const dispose = Stream.fromEffect(
                    either(inst.driver.dispose(p.right)).pipe(
                      Effect.map(
                        (d): ReadonlyArray<SandboxTestConnectionProgressEvent> => [
                          event,
                          {
                            stage: "dispose",
                            ok: d._tag === "Right",
                            ...(d._tag === "Left" ? { detail: d.left.message } : {}),
                          },
                          { stage: "done", ok: d._tag === "Right" },
                        ],
                      ),
                    ),
                  );
                  return dispose.pipe(Stream.flatMap(Stream.fromIterable));
                }),
              ),
            );
          }),
        );
      }),
    ),

  startSession: (
    instanceId: SandboxProviderInstanceId,
    settings: ServerSettings,
    options?: {
      readonly connectAuthToken?: SandboxStartSessionInput["connectAuthToken"];
      readonly repository?: SandboxStartSessionInput["repository"];
    },
  ) =>
    Effect.gen(function* () {
      // Idempotency guard: a concurrent `startSession` for the same instance
      // (e.g. a double-click during the up-to-60s provision window) would
      // boot a second container and orphan the first one with no handle to
      // dispose. Fail fast instead.
      const sessionKey = instanceId as string;
      if (runningSessions.has(sessionKey) || startingSessions.has(sessionKey)) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "A session is already running for this sandbox environment.",
        });
      }
      startingSessions.add(sessionKey);
      return yield* Effect.gen(function* () {
        const registry = buildRegistry();
        const config = (settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap)[
          instanceId as SandboxProviderInstanceId
        ];
        if (config === undefined) {
          return yield* new SandboxRpcError({
            reason: "invalid-config",
            message: "instance not found",
          });
        }
        const inst = registry.materializeOne(instanceId, resolveInstanceEnvelope(config));
        if (inst.kind !== "available") {
          return yield* registryError(inst.reason, inst.message);
        }
        // Per-session Kata WebSocket auth token (required for non-loopback clients).
        // @effect-diagnostics-next-line effect(globalDateInEffect):off - random token, not a clock read.
        const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");

        const savedEnvKey =
          options?.repository !== undefined
            ? RepositoryCanonicalKey.make(options.repository.repositoryIdentity.canonicalKey)
            : undefined;
        const savedEnv =
          savedEnvKey !== undefined ? settings.savedSandboxEnvironments[savedEnvKey] : undefined;

        const { env, secretValues } = buildProvisionEnvironment({
          bootstrapToken,
          instanceEnvironment: config.environment,
          savedEnvironment: savedEnv?.environment,
        });

        // Pass the display name into the container so the sandbox server can
        // use it as its environment descriptor label (instead of the container
        // hostname, which is a meaningless Docker ID).
        const envWithLabel = config.displayName
          ? [...env, ["KATACODE_ENVIRONMENT_LABEL", config.displayName] as const]
          : env;

        const handle = yield* inst.driver
          .provision({
            instanceId: instanceId as string,
            config: inst.config,
            image: resolveProvisionImage(inst.config),
            env: envWithLabel,
          })
          .pipe(Effect.mapError(mapDriverError));

        // Seed provider credentials (static config + auth) into the container
        // home before any provider probe re-checks. This runs unconditionally —
        // credentials are independent of the repo. The repo seed + install below
        // is conditional on a repository being specified.
        yield* runCredentialSeed(inst.driver, handle).pipe(
          Effect.catch((error: SetupFailed | SandboxProviderError) =>
            disposeAfterFailure(sessionKey, inst.driver, handle).pipe(
              Effect.andThen(
                Effect.fail(
                  error._tag === "SetupFailed" ? mapSetupFailed(error) : mapDriverError(error),
                ),
              ),
            ),
          ),
        );

        let setupProcesses: ReadonlyArray<SetupProcessRecord> = [];
        if (options?.repository !== undefined) {
          // The container is already provisioned and running at this point, so a
          // loader failure (a malformed .kata/environment.json) must dispose it
          // the same way every other post-provision failure in this function
          // does; otherwise a bad repo-local config file orphans a running
          // container with no handle retained anywhere to dispose it later.
          const loaded = yield* loadEnvironmentConfig({
            repoRoot: options.repository.repoRoot,
            repositoryIdentity: options.repository.repositoryIdentity,
            savedSandboxEnvironments: settings.savedSandboxEnvironments,
          }).pipe(
            Effect.mapError(mapLoadError),
            Effect.catch((error: SandboxRpcError) =>
              disposeAfterFailure(sessionKey, inst.driver, handle).pipe(
                Effect.andThen(Effect.fail(error)),
              ),
            ),
          );

          // Docker-in-sandbox is unsupported for non-docker drivers (spec
          // decision 10): a `.kata/environment.json` requesting a Dockerfile
          // build requires a Docker daemon the Vercel runtime does not have.
          // Fail loud and tear down the just-provisioned sandbox rather than
          // attempting a build that will hang or error opaquely inside the VM.
          if (
            loaded.resolved.build?.dockerfile !== undefined &&
            (inst.driver.kind as string) !== "docker"
          ) {
            return yield* disposeAfterFailure(sessionKey, inst.driver, handle).pipe(
              Effect.andThen(
                Effect.fail(
                  new SandboxRpcError({
                    reason: "invalid-config",
                    message: `.kata/environment.json requests a Dockerfile build, which the "${inst.driver.kind as string}" sandbox driver does not support. Use a local Docker deployment target for this repository.`,
                  }),
                ),
              ),
            );
          }

          const setup = yield* runSandboxSetup({
            driver: inst.driver,
            handle,
            resolved: loaded.resolved,
            secretValues,
            seed: { repoRoot: options.repository.repoRoot },
          }).pipe(
            Effect.catch((error: SetupFailed | SandboxProviderError) =>
              // Reuse the canonical post-provision dispose helper. The
              // session is not in `runningSessions` yet at this point, so the
              // helper's `runningSessions.delete` is a harmless no-op here.
              disposeAfterFailure(sessionKey, inst.driver, handle).pipe(
                Effect.andThen(
                  Effect.fail(
                    error._tag === "SetupFailed" ? mapSetupFailed(error) : mapDriverError(error),
                  ),
                ),
              ),
            ),
          );
          setupProcesses = setup.processes;
        }

        const sandboxPort = resolveSandboxPort(inst.config);
        const reach = yield* inst.driver.reachability(handle, sandboxPort).pipe(
          Effect.mapError(mapDriverError),
          Effect.catch((error: SandboxRpcError) =>
            disposeAfterFailure(sessionKey, inst.driver, handle).pipe(
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
        const isVercel = (inst.driver.kind as string) === (VERCEL_KIND as string);
        const endpointProvider = isVercel ? VERCEL_ENDPOINT_PROVIDER : SANDBOX_ENDPOINT_PROVIDER;
        const endpoint: AdvertisedEndpoint = createAdvertisedEndpoint({
          id: `sandbox-${instanceId as string}`,
          label:
            config.displayName ??
            (isVercel ? `Vercel ${instanceId as string}` : `Container ${instanceId as string}`),
          provider: endpointProvider,
          httpBaseUrl: reach.httpBaseUrl,
          reachability: reach.reachabilityKind,
          source: "server",
        });
        // Connect auto-registration (AC-1.11): authenticate to the freshly booted
        // container with its desktop bootstrap token, ask that container to sign
        // the link proof for its own descriptor/keypair, then apply the returned
        // relay config back to the container. This keeps the linked environment id
        // and endpoint bound to the deployed container rather than the parent
        // desktop server. A missing user/CLI Connect token or relay failure fails
        // the RPC and tears down the just-created container.
        //
        // Loopback sandboxes reach the relay via 127.0.0.1 + the published port and
        // register a `cloudflare_tunnel` managed endpoint. Public sandboxes (Vercel)
        // expose the server via `sandbox.domain(port)`; the relay reaches them at
        // the public host on 443 and registers a `manual` endpoint.
        const isLoopback = reach.reachabilityKind === "loopback";
        const connectBaseUrl = isLoopback
          ? reach.httpBaseUrl.replace("localhost", "127.0.0.1")
          : reach.httpBaseUrl;
        const connectUrl = new URL(connectBaseUrl);
        const connectOrigin = isLoopback
          ? { localHttpHost: "127.0.0.1", localHttpPort: Number(connectUrl.port || 80) }
          : { localHttpHost: connectUrl.hostname, localHttpPort: Number(connectUrl.port || 443) };
        const endpointProviderKind = (
          isLoopback ? "cloudflare_tunnel" : "manual"
        ) as RelayManagedEndpointProviderKind;
        const { descriptor, adminAccessToken, relay } = yield* registerSandboxWithConnect({
          httpBaseUrl: connectBaseUrl,
          bootstrapToken,
          connectAuthToken: options?.connectAuthToken,
          endpointProviderKind,
          origin: connectOrigin,
        }).pipe(
          Effect.catch((error: SandboxRpcError) =>
            disposeAfterFailure(sessionKey, inst.driver, handle).pipe(
              Effect.andThen(
                Effect.fail(
                  new SandboxRpcError({
                    reason: "connect-failed",
                    message: withConnectAuthHint(
                      `Connect auto-registration failed: ${error.message}`,
                    ),
                  }),
                ),
              ),
            ),
          ),
        );
        // The desktop bootstrap token was consumed by registration above, so
        // issue a dedicated pairing credential for the deploying client.
        const pairingToken = yield* issueSandboxPairingCredential({
          httpBaseUrl: connectBaseUrl,
          adminAccessToken,
        }).pipe(
          Effect.catch((error: SandboxRpcError) =>
            disposeAfterFailure(sessionKey, inst.driver, handle).pipe(
              Effect.andThen(
                Effect.fail(
                  new SandboxRpcError({
                    reason: "connect-failed",
                    message: `Could not issue a sandbox pairing credential: ${error.message}`,
                  }),
                ),
              ),
            ),
          ),
        );
        // Re-probe providers on the sandbox server now that credentials have
        // been seeded via copyInto during setup. The initial probe at container
        // boot may have fired before credentials were in place; this refresh
        // corrects the provider status (e.g. Codex flips from error to ready).
        yield* refreshSandboxProviders({
          httpBaseUrl: connectBaseUrl,
          adminAccessToken,
        }).pipe(
          Effect.catchTag("SandboxRpcError", (error: SandboxRpcError) =>
            // Non-fatal: a refresh failure leaves the sandbox running with the
            // initial probe result. The client re-fetches provider status on
            // its own interval, so a transient refresh error self-heals.
            Effect.logWarning("Could not refresh sandbox providers after credential seed", {
              message: error.message,
            }).pipe(Effect.asVoid),
          ),
        );
        const record: RunningSession = {
          handle,
          driver: inst.driver,
          setupProcesses,
          environmentId: descriptor.environmentId,
          endpoint,
          relay: relay ?? null,
          status: "running",
          deadlineEpochMs: undefined,
          lapsedReason: undefined,
          snapshotId: undefined,
          keepalive: null,
          instanceConfig: resolveInstanceEnvelope(config),
        };
        // Start keepalive when the driver supports timeout renewal. The
        // scheduler owns the host-side deadline and lapses the session on
        // renewal failure (plan cap reached or sandbox stopped).
        if (inst.driver.renewTimeout) {
          const timeoutMs = resolveSandboxTimeoutMs(inst.config);
          record.keepalive = startSessionKeepalive({
            driver: inst.driver,
            handle,
            timeoutMs,
            onDeadline: (d) => {
              record.deadlineEpochMs = d;
            },
            onLapse: (r) => markSessionLapsed(sessionKey, r),
          });
        }
        runningSessions.set(sessionKey, record);
        return {
          instanceId,
          environmentId: descriptor.environmentId,
          pairingToken,
          endpoint,
        };
      }).pipe(Effect.ensuring(Effect.sync(() => startingSessions.delete(sessionKey))));
    }),

  disposeSession: (instanceId: SandboxProviderInstanceId) =>
    Effect.gen(function* () {
      const entry = runningSessions.get(instanceId as string);
      if (entry === undefined) return false;
      // Stop the keepalive scheduler before disposing (allows disposing lapsed sessions).
      entry.keepalive?.stop();
      entry.keepalive = null;
      // Unlink the environment from the relay so it disappears from the
      // Connect pool immediately. Non-fatal: if the unlink fails, the relay
      // link lapses when the container becomes unreachable.
      if (entry.relay) {
        yield* deleteJson(
          RelayOkResponse,
          `${entry.relay.relayUrl}/v1/client/environment-links/${entry.environmentId}`,
          entry.relay.bearerToken,
        ).pipe(
          Effect.catch((error: SandboxRpcError) =>
            Effect.logWarning("Could not unlink sandbox from relay", {
              environmentId: entry.environmentId,
              message: error.message,
            }).pipe(Effect.asVoid),
          ),
        );
      }
      // Route through the driver that created the handle rather than a
      // hardcoded one, so a future non-Docker driver disposes its own
      // sandboxes correctly (the handle's `driverKind` is the routing key).
      yield* entry.driver.dispose(entry.handle).pipe(Effect.mapError(mapDriverError));
      runningSessions.delete(instanceId as string);
      return true;
    }),

  renewSession: (instanceId: SandboxProviderInstanceId, input?: { readonly extendMs?: number }) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      const record = runningSessions.get(sessionKey);
      if (record === undefined || record.status !== "running") {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "No running sandbox session to renew.",
        });
      }
      if (record.driver.renewTimeout === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "This sandbox driver does not support timeout renewal.",
        });
      }
      const extendMs = input?.extendMs ?? resolveSandboxTimeoutMs(record.instanceConfig.config);
      yield* record.driver.renewTimeout.renewTimeout(record.handle, extendMs).pipe(
        Effect.mapError((error: SandboxProviderError) => {
          // Renewal failure means the plan cap was reached or the sandbox stopped.
          markSessionLapsed(sessionKey, error.message);
          return mapDriverError(error);
        }),
      );
      // @effect-diagnostics-next-line globalDateInEffect:off - host-side deadline arithmetic (extendTimeout is additive, remaining time unreadable).
      const deadline = Date.now() + extendMs;
      record.deadlineEpochMs = deadline;
      return { instanceId, deadlineEpochMs: deadline };
    }),

  resumeSession: (
    instanceId: SandboxProviderInstanceId,
    settings: ServerSettings,
    options?: { readonly connectAuthToken?: SandboxResumeSessionInput["connectAuthToken"] },
  ) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      const record = runningSessions.get(sessionKey);
      if (record === undefined || record.status !== "lapsed") {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "No lapsed sandbox session to resume.",
        });
      }
      if (record.driver.resume === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "This sandbox driver does not support resume.",
        });
      }
      // Fresh bootstrap token for the resumed server; rebuild the serve env
      // from the cached instance config so resume does not re-read settings.
      // @effect-diagnostics-next-line effect(globalDateInEffect):off - random token, not a clock read.
      const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");
      const { env } = buildProvisionEnvironment({
        bootstrapToken,
        instanceEnvironment: record.instanceConfig.environment,
      });
      let handle = record.handle;
      const resumed = yield* record.driver.resume
        .resume(record.handle, { config: record.instanceConfig.config, env })
        .pipe(
          Effect.catchTag("SandboxProviderError", (resumeError: SandboxProviderError) => {
            // Fall back to provisioning from the captured snapshot when resume fails.
            if (record.snapshotId !== undefined && record.driver.kind === VERCEL_KIND) {
              const overrideConfig = {
                ...(record.instanceConfig.config as object),
                sourceType: "snapshot" as const,
                snapshotId: record.snapshotId,
              };
              return record.driver.provision({
                instanceId: sessionKey,
                config: overrideConfig,
                image: "",
                env,
              });
            }
            return Effect.fail(resumeError);
          }),
          Effect.mapError(mapDriverError),
        );
      handle = resumed;
      record.handle = handle;
      record.status = "running";
      record.lapsedReason = undefined;
      const finalized = yield* registerAndFinalizeSession({
        sessionKey,
        instanceId,
        driver: record.driver,
        handle,
        config: record.instanceConfig,
        bootstrapToken,
        connectAuthToken: options?.connectAuthToken,
      });
      record.environmentId = finalized.environmentId;
      record.endpoint = finalized.endpoint;
      record.relay = finalized.relay;
      // Restart keepalive when the driver supports it.
      if (record.driver.renewTimeout) {
        const timeoutMs = resolveSandboxTimeoutMs(record.instanceConfig.config);
        record.keepalive = startSessionKeepalive({
          driver: record.driver,
          handle,
          timeoutMs,
          onDeadline: (d) => {
            record.deadlineEpochMs = d;
          },
          onLapse: (r) => markSessionLapsed(sessionKey, r),
        });
      }
      return {
        instanceId,
        environmentId: finalized.environmentId,
        pairingToken: finalized.pairingToken,
        endpoint: finalized.endpoint,
      };
    }),

  createSessionSnapshot: (
    instanceId: SandboxProviderInstanceId,
    input?: { readonly name?: string },
  ) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      const record = runningSessions.get(sessionKey);
      if (record === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "No sandbox session to snapshot.",
        });
      }
      if (record.driver.snapshot === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "This sandbox driver does not support snapshots.",
        });
      }
      const result = yield* record.driver.snapshot
        .createSnapshot(record.handle, input?.name !== undefined ? { name: input.name } : {})
        .pipe(Effect.mapError(mapDriverError));
      record.snapshotId = result.snapshotId;
      // Vercel snapshots stop the VM, so the session lapses. The gate is
      // kind-based because other future drivers may snapshot without stopping.
      if ((record.driver.kind as string) === (VERCEL_KIND as string)) {
        markSessionLapsed(sessionKey, "snapshotted");
      }
      return { instanceId, snapshotId: result.snapshotId };
    }),

  providerLoginStart: (input: {
    readonly instanceId: SandboxProviderInstanceId;
    readonly providerId: string;
  }): Stream.Stream<SandboxProviderLoginEvent, SandboxRpcError> => {
    const record = runningSessions.get(input.instanceId as string);
    if (record === undefined) {
      return Stream.fail(
        new SandboxRpcError({
          reason: "not-running",
          message: "No sandbox session to sign in to.",
        }),
      );
    }
    return startProviderLogin({
      driver: record.driver,
      handle: record.handle,
      providerId: input.providerId,
    });
  },

  providerLoginSubmitCode: (input: {
    readonly instanceId: SandboxProviderInstanceId;
    readonly loginSessionId: string;
    readonly code: string;
  }) => submitProviderLoginCode(input),
};

export type SandboxService = typeof SandboxServiceLive;
