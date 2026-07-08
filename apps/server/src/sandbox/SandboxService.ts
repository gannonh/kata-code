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
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
// @effect-diagnostics nodeBuiltinImport:on
import * as os from "node:os";
import * as Clock from "effect/Clock";
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
import { resolveDefaultKatacodeHome } from "@kata-sh/code-shared/branding";
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
  type SandboxStartSessionInput,
  type SandboxTestConnectionProgressEvent,
  SandboxRpcError,
} from "@kata-sh/code-contracts/sandboxRpc";
import { SandboxProviderRegistry } from "@kata-sh/code-sandbox/registry";
import {
  SandboxProviderError,
  type SandboxHandle,
  type SandboxReachability,
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
import { cloudCliOAuthConfig, relayUrlConfig } from "../cloud/publicConfig.ts";
import { EnvironmentConfigLoadError, loadEnvironmentConfig } from "./environmentConfigLoader.ts";
import { buildCredentialSeedArchives } from "./credentialSeed.ts";
import { SetupFailed, runSandboxSetup } from "./sandboxSetupRunner.ts";
import {
  makeSandboxSessionStore,
  type SandboxSessionRecord,
  type SandboxSessionStore,
} from "./sandboxSessionStore.ts";
import { loadStoredSandboxCredentials } from "./storedSandboxCredentials.ts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { startProviderLogin, submitProviderLoginCode } from "./providerLogin.ts";

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

function toSummary(
  inst: Materialized,
  storeRecord: SandboxSessionRecord | undefined,
): Effect.Effect<SandboxInstanceSummary, never> {
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
    return {
      kind: "available",
      instanceId: inst.instanceId,
      driver: descriptor.kind as string,
      reachabilityKind: descriptor.reachabilityKind,
      supportsSnapshot: descriptor.supportsSnapshot,
      supportsRenewTimeout: descriptor.supportsRenewTimeout,
      supportsLifecycle: descriptor.supportsLifecycle,
      ...(storeRecord
        ? {
            runningSession: {
              environmentId: storeRecord.sandboxEnvironmentId as never,
              endpoint: storeRecord.endpoint as never,
              status: storeRecord.status,
              ...(storeRecord.deadlineEpochMs !== undefined
                ? { deadlineEpochMs: storeRecord.deadlineEpochMs }
                : {}),
              ...(storeRecord.statusDetail !== undefined
                ? { statusDetail: storeRecord.statusDetail }
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
  return Effect.gen(function* () {
    yield* Effect.ignore(sessionStore.remove(sessionKey as never));
    yield* driver.dispose(handle).pipe(
      Effect.catch((disposeError) =>
        Effect.logWarning("Could not dispose sandbox after startSession failure", {
          cause: disposeError,
        }),
      ),
    );
  });
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

type ConnectAuthTokenPreference = "provided-first" | "stored-first";

const CONNECT_TOKEN_REFRESH_EARLY_MS = 5 * 60 * 1_000;

const ProductionCliToken = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresAtEpochMs: Schema.Number,
});
type ProductionCliToken = typeof ProductionCliToken.Type;

const ProductionCliTokenJson = Schema.fromJsonString(ProductionCliToken);

const ConnectOAuthTokenResponse = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.optional(Schema.String),
  expires_in: Schema.Number,
  token_type: Schema.String,
});

export function connectAuthTokenPreferenceForEndpoint(
  endpointProviderKind: RelayManagedEndpointProviderKind,
): ConnectAuthTokenPreference {
  return endpointProviderKind === "cloudflare_tunnel" ? "provided-first" : "stored-first";
}

function readStoredConnectAuthToken(): Effect.Effect<
  Option.Option<{ readonly accessToken: string }>,
  SandboxRpcError,
  CliTokenManager.CloudCliTokenManager
> {
  // The CLI token manager is auto-refreshable and reads from the runtime's
  // secrets directory. In dev mode (VITE_DEV_SERVER_URL set) that's
  // ~/.katacode/dev/secrets/; `npx @kata-sh/code-cli connect login` (run
  // without --dev-url) stores to ~/.katacode/userdata/secrets/, so also check
  // the production path before falling through to the desktop session token.
  return Effect.flatMap(CliTokenManager.CloudCliTokenManager, (tokens) => tokens.getExisting).pipe(
    Effect.catch(() => Effect.succeed(Option.none<{ readonly accessToken: string }>())),
    Effect.flatMap((cliToken) => {
      if (Option.isSome(cliToken)) return Effect.succeed(Option.some(cliToken.value));
      return readProductionCliToken();
    }),
  );
}

function resolveConnectAuthToken(
  connectAuthToken: SandboxStartSessionInput["connectAuthToken"],
  preference: ConnectAuthTokenPreference,
): Effect.Effect<string, SandboxRpcError, CliTokenManager.CloudCliTokenManager> {
  // Loopback/Docker registration happens immediately after local container
  // start, so prefer the freshly supplied desktop token when available. Public
  // Vercel registration can happen minutes after the UI request starts, so keep
  // using the refreshable stored CLI OAuth token first there.
  if (preference === "provided-first" && connectAuthToken) {
    return Effect.succeed(connectAuthToken);
  }
  return readStoredConnectAuthToken().pipe(
    Effect.flatMap((storedToken) => {
      if (Option.isSome(storedToken)) return Effect.succeed(storedToken.value.accessToken);
      if (connectAuthToken) return Effect.succeed(connectAuthToken);
      return Effect.fail(
        new SandboxRpcError({
          reason: "connect-failed",
          message:
            "No Kata Code Connect credential found. Run `npx @kata-sh/code-cli connect login` to authorize, or sign in to Kata Code Connect from the desktop app.",
        }),
      );
    }),
  );
}

/**
 * Fallback: read the CLI OAuth token from the production secrets directory
 * (~/.katacode/userdata/secrets/cloud-cli-oauth-token.bin). The
 * CliTokenManager's ServerSecretStore points at ~/.katacode/dev/secrets/
 * when the server runs in dev mode (VITE_DEV_SERVER_URL set).
 * `npx @kata-sh/code-cli connect login` (run without --dev-url) stores
 * to userdata/secrets/, so the managed path sees no token and silently
 * falls through to the short-lived Clerk JWT (60 s TTL), which expires
 * during Vercel sandbox provisioning (2-3 min). This fallback bridges
 * the directory mismatch and refreshes the production token before use.
 */
function productionCliTokenPath(): string {
  return NodePath.join(
    resolveDefaultKatacodeHome(os.homedir()),
    "userdata",
    "secrets",
    "cloud-cli-oauth-token.bin",
  );
}

function refreshProductionCliToken(
  token: ProductionCliToken,
): Effect.Effect<ProductionCliToken, SandboxRpcError> {
  return Effect.gen(function* () {
    const metadata = yield* cloudCliOAuthConfig.pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Kata Code Connect OAuth config is unavailable: ${String(cause)}`,
          }),
      ),
    );
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
      client_id: metadata.clientId,
    });
    const response = yield* fetchJson(ConnectOAuthTokenResponse, metadata.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const now = yield* Clock.currentTimeMillis;
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? token.refreshToken,
      expiresAtEpochMs: now + response.expires_in * 1_000,
    } satisfies ProductionCliToken;
  });
}

// @effect-diagnostics-next-line effect(nodeBuiltinImport):off - Direct filesystem read for production token fallback.
function readProductionCliToken(): Effect.Effect<
  Option.Option<{ readonly accessToken: string }>,
  SandboxRpcError
> {
  return Effect.gen(function* () {
    const tokenPath = productionCliTokenPath();
    const raw = yield* Effect.sync(() => {
      try {
        return NodeFS.readFileSync(tokenPath, "utf8");
      } catch {
        return null as string | null;
      }
    });
    if (raw === null) return Option.none();
    const decoded = yield* Schema.decodeUnknownEffect(ProductionCliTokenJson)(raw).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Stored Kata Code Connect CLI credential is unreadable. Run \`npx @kata-sh/code-cli connect login\`, then retry. ${errorToMessage(cause)}`,
          }),
      ),
    );
    const now = yield* Clock.currentTimeMillis;
    if (decoded.expiresAtEpochMs - CONNECT_TOKEN_REFRESH_EARLY_MS > now) {
      return Option.some({ accessToken: decoded.accessToken });
    }
    const refreshed = yield* refreshProductionCliToken(decoded).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Stored Kata Code Connect CLI credential is expired and refresh failed. Run \`npx @kata-sh/code-cli connect login\`, then retry. ${errorToMessage(cause)}`,
          }),
      ),
    );
    const encoded = yield* Schema.encodeEffect(ProductionCliTokenJson)(refreshed).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxRpcError({
            reason: "connect-failed",
            message: `Could not encode refreshed Kata Code Connect CLI credential. ${errorToMessage(cause)}`,
          }),
      ),
    );
    yield* Effect.try({
      try: () => {
        NodeFS.writeFileSync(tokenPath, encoded);
        NodeFS.chmodSync(tokenPath, 0o600);
      },
      catch: (cause) =>
        new SandboxRpcError({
          reason: "connect-failed",
          message: `Could not persist refreshed Kata Code Connect CLI credential. ${errorToMessage(cause)}`,
        }),
    });
    return Option.some({ accessToken: refreshed.accessToken });
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
    const bearerToken = yield* resolveConnectAuthToken(
      input.connectAuthToken,
      connectAuthTokenPreferenceForEndpoint(input.endpointProviderKind),
    );
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

/** A live sandbox session record held in memory between RPC calls. The
 *  durable store is the source of truth; this in-memory cache is populated by
 *  startSession/reconcile and read by providerLogin (which needs the live
 *  driver + handle for exec). */
export interface LiveSession {
  handle: SandboxHandle;
  readonly driver: SandboxProvider;
  readonly instanceConfig: SandboxProviderInstanceConfig;
  environmentId: string;
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

/** Durable session store — the source of truth for sandbox session state.
 *  Replaces the Phase 1 in-memory `runningSessions` map. */
const sessionStore: SandboxSessionStore = makeSandboxSessionStore(
  resolveDefaultKatacodeHome(os.homedir()),
);

/** In-memory cache of live sessions (instanceId → driver + handle). Populated
 *  by startSession and reconcile; read by providerLogin (needs the driver for
 *  exec). The store holds the durable state; this holds the ephemeral driver
 *  reference. */
const liveSessions = new Map<string, LiveSession>();

/** In-flight operation reservations (instanceId). Prevents concurrent
 *  start/stop/delete operations from racing. Cleared in an ensuring block. */
const busyInstances = new Set<string>();

/** Whether boot reconcile has run. Reconcile runs lazily on first
 *  `listInstances` if it hasn't run yet. */
let reconcileDone = false;

/** Reconcile stored records against the providers. For each stored record:
 *  re-resolve config from settings, find the driver, call `lifecycle.status`;
 *  update the stored status, evict `gone` records, keep `stopped`/`running`.
 *  Reconcile failures keep the last-known status and set `statusDetail`.
 *  Pure/testable: takes the store, registry, settings, and the liveSessions
 *  cache to populate; returns the updated records (also persisted). */
export function reconcileStoredRecords(input: {
  readonly store: SandboxSessionStore;
  readonly registry: SandboxProviderRegistry;
  readonly settings: ServerSettings;
  readonly liveSessions: Map<string, LiveSession>;
}): Effect.Effect<ReadonlyArray<SandboxSessionRecord>, never> {
  return Effect.gen(function* () {
    const records = yield* input.store
      .load()
      .pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<SandboxSessionRecord>)));
    if (records.length === 0) return [];
    const rawMap = input.settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap;
    const updated: SandboxSessionRecord[] = [];
    for (const record of records) {
      const config = rawMap[record.instanceId as SandboxProviderInstanceId];
      if (config === undefined) {
        // Instance no longer in settings — evict.
        yield* Effect.logWarning(
          "Sandbox session store: instance no longer in settings; evicting",
          {
            instanceId: record.instanceId,
          },
        );
        continue;
      }
      const resolved = resolveInstanceEnvelope(config);
      const inst = input.registry.materializeOne(
        record.instanceId as SandboxProviderInstanceId,
        resolved,
      );
      if (inst.kind !== "available") {
        // Driver unavailable — keep the record with a statusDetail.
        updated.push({
          ...record,
          statusDetail: `Instance unavailable: ${inst.reason} (${inst.message})`,
        });
        continue;
      }
      // Re-inject the Vercel auth trio into the stored (sanitized) handle
      // from the resolved config before passing it to the driver.
      const rehydratedHandleState = reinjectVercelAuth(
        inst.driver.kind as string,
        record.handle.handle,
        resolved.config,
      );
      const handle: SandboxHandle = {
        driverKind: inst.driver.kind,
        instanceId: record.instanceId,
        handle: rehydratedHandleState,
      };
      // If the driver supports lifecycle, reconcile the status before caching.
      // `gone` records are evicted and never cached so providerLogin cannot
      // operate on a sandbox the provider reports as gone.
      if (inst.driver.lifecycle) {
        const statusResult = yield* inst.driver.lifecycle.status(handle).pipe(
          Effect.matchEffect({
            onFailure: (left) =>
              Effect.succeed<{ _tag: "Left"; left: SandboxProviderError }>({
                _tag: "Left",
                left,
              }),
            onSuccess: (right) =>
              Effect.succeed<{ _tag: "Right"; right: typeof right }>({
                _tag: "Right",
                right,
              }),
          }),
        );
        if (statusResult._tag === "Right") {
          if (statusResult.right === "gone") {
            input.liveSessions.delete(record.instanceId);
            yield* Effect.logWarning("Sandbox session store: provider reports gone; evicting", {
              instanceId: record.instanceId,
            });
            continue; // evict
          }
          // Drop any prior statusDetail (exactOptionalPropertyTypes: omit the
          // key rather than assigning undefined).
          const { statusDetail: _dropDetail, ...restRecord } = record;
          updated.push({
            ...restRecord,
            status: statusResult.right,
          });
          input.liveSessions.set(record.instanceId, {
            handle,
            driver: inst.driver,
            instanceConfig: resolved,
            environmentId: record.sandboxEnvironmentId,
          });
        } else {
          // Reconcile failure — keep last-known status, set statusDetail. Still
          // cache the live session so stop/dispose can reach the driver.
          updated.push({
            ...record,
            statusDetail: `Reconcile failed: ${statusResult.left.message}`,
          });
          input.liveSessions.set(record.instanceId, {
            handle,
            driver: inst.driver,
            instanceConfig: resolved,
            environmentId: record.sandboxEnvironmentId,
          });
        }
      } else {
        // No lifecycle capability — keep as-is and cache the live session.
        updated.push(record);
        input.liveSessions.set(record.instanceId, {
          handle,
          driver: inst.driver,
          instanceConfig: resolved,
          environmentId: record.sandboxEnvironmentId,
        });
      }
    }
    yield* input.store.save(updated).pipe(
      Effect.catch((error: unknown) =>
        Effect.logError("Sandbox session store save failed during reconcile", {
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
    );
    return updated;
  });
}

function reconcileSessions(settings: ServerSettings): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    if (reconcileDone) return;
    yield* reconcileStoredRecords({
      store: sessionStore,
      registry: buildRegistry(),
      settings,
      liveSessions,
    });
    // Discovery: for configured instances with supportsLifecycle and no store
    // record, probe the provider for an existing sandbox (e.g. created before
    // the durable store existed, or after a store reset). Found sandboxes are
    // persisted so the UI reports them as running/stopped with the right actions.
    yield* discoverUntrackedSessions({
      store: sessionStore,
      registry: buildRegistry(),
      settings,
      liveSessions,
    });
    reconcileDone = true;
  });
}

/** Discover provider-side sandboxes for configured instances that have no store
 *  record. For each such instance whose driver supports `lifecycle.discover`,
 *  probe the provider; when a sandbox exists, persist a record + cache the live
 *  session so the UI shows the correct state-driven actions. */
export function discoverUntrackedSessions(input: {
  readonly store: SandboxSessionStore;
  readonly registry: SandboxProviderRegistry;
  readonly settings: ServerSettings;
  readonly liveSessions: Map<string, LiveSession>;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const existing = new Set(
      (yield* input.store.load().pipe(
        Effect.catch((error: unknown) =>
          Effect.logWarning("Sandbox session store load failed during discover", {
            message: error instanceof Error ? error.message : String(error),
          }).pipe(Effect.as([] as ReadonlyArray<SandboxSessionRecord>)),
        ),
      )).map((r) => r.instanceId),
    );
    const rawMap = input.settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap;
    for (const [id, cfg] of Object.entries(rawMap)) {
      const instanceId = id as SandboxProviderInstanceId;
      if (existing.has(instanceId as string)) continue;
      const resolved = resolveInstanceEnvelope(cfg as SandboxProviderInstanceConfig);
      const inst = input.registry.materializeOne(instanceId, resolved);
      if (inst.kind !== "available") continue;
      const lifecycle = inst.driver.lifecycle;
      if (lifecycle === undefined || lifecycle.discover === undefined) continue;
      const found = yield* lifecycle
        .discover({
          instanceId: instanceId as string,
          config: resolved.config,
        })
        .pipe(
          Effect.catch((error: SandboxProviderError) =>
            Effect.logWarning("Sandbox discover failed", {
              instanceId: instanceId as string,
              message: error.message,
            }).pipe(Effect.as(null)),
          ),
        );
      if (found === null) continue;
      // Derive a display endpoint from the handle (reachability). The real
      // Connect environmentId re-registers on start; use the instance id as a
      // placeholder so the store record is valid + the UI can render status.
      const port = resolveSandboxPort(resolved.config);
      const reach = yield* inst.driver
        .reachability(found.handle, port)
        .pipe(Effect.catch(() => Effect.succeed(null as SandboxReachability | null)));
      const isVercel = (inst.driver.kind as string) === (VERCEL_KIND as string);
      const endpoint: AdvertisedEndpoint | null = reach
        ? createAdvertisedEndpoint({
            id: `sandbox-${instanceId as string}`,
            label:
              cfg.displayName ??
              (isVercel ? `Vercel ${instanceId as string}` : `Container ${instanceId as string}`),
            provider: isVercel ? VERCEL_ENDPOINT_PROVIDER : SANDBOX_ENDPOINT_PROVIDER,
            httpBaseUrl: reach.httpBaseUrl,
            reachability: reach.reachabilityKind,
            source: "server",
          })
        : null;
      if (endpoint === null) continue;
      const record: SandboxSessionRecord = {
        instanceId: instanceId as string,
        driverKind: inst.driver.kind as string,
        environmentId: instanceId as string,
        sandboxEnvironmentId: instanceId as string,
        handle: {
          driverKind: inst.driver.kind as string,
          handle: sanitizeHandleForStore(inst.driver.kind as string, found.handle.handle),
        },
        endpoint,
        status: found.status === "running" ? "running" : "stopped",
      };
      yield* input.store.upsert(record).pipe(
        Effect.catch((error: unknown) =>
          Effect.logError("Sandbox discover store write failed", {
            instanceId: instanceId as string,
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
      input.liveSessions.set(instanceId as string, {
        handle: found.handle,
        driver: inst.driver,
        instanceConfig: resolved,
        environmentId: instanceId as string,
      });
    }
  });
}

/** Sanitize a driver handle for persistence: strip the Vercel auth trio
 *  (token/teamId/projectId) so no secrets are written to the store file.
 *  The auth re-resolves from instance config env on load/reconcile. */
export function sanitizeHandleForStore(driverKind: string, handleState: unknown): unknown {
  if (
    driverKind === (VERCEL_KIND as string) &&
    handleState !== null &&
    typeof handleState === "object"
  ) {
    const { auth: _auth, ...rest } = handleState as Record<string, unknown>;
    return rest;
  }
  return handleState;
}

/** Re-inject the Vercel auth trio into a stored (sanitized) handle from the
 *  resolved config. The config carries `auth` after `mergeVercelAuthIntoConfig`;
 *  the driver's lifecycle methods read `state.auth` from the handle. */
export function reinjectVercelAuth(
  driverKind: string,
  storedHandle: unknown,
  config: unknown,
): unknown {
  if (driverKind !== (VERCEL_KIND as string)) return storedHandle;
  const auth =
    config !== null && typeof config === "object" && "auth" in config
      ? (config as { auth?: unknown }).auth
      : undefined;
  if (auth === undefined) return storedHandle;
  return { ...(storedHandle as Record<string, unknown>), auth };
}

function storeSessionRecord(input: {
  readonly instanceId: SandboxProviderInstanceId;
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly config: SandboxProviderInstanceConfig;
  readonly environmentId: string;
  readonly endpoint: AdvertisedEndpoint;
  readonly relay: { readonly relayUrl: string; readonly bearerToken: string } | null;
  readonly status: "running" | "stopped";
}): Effect.Effect<void, Error> {
  const driverKindStr = input.driver.kind as string;
  const record: SandboxSessionRecord = {
    instanceId: input.instanceId as string,
    driverKind: driverKindStr,
    environmentId: input.instanceId as string,
    sandboxEnvironmentId: input.environmentId,
    handle: {
      driverKind: driverKindStr,
      // Strip secrets (Vercel auth trio) before persisting.
      handle: sanitizeHandleForStore(driverKindStr, input.handle.handle),
    },
    endpoint: input.endpoint,
    status: input.status,
    // Store only the relay URL; the bearer token is re-resolved at dispose time.
    relay: input.relay ? { relayUrl: input.relay.relayUrl } : undefined,
  };
  return sessionStore.upsert(record);
}

/** Persist a session record, logging (not swallowing) store write failures.
 *  A store write failure after a successful provision cannot unwind the
 *  provision (the sandbox is live on the provider), so the error is surfaced
 *  via a warning log — fail-loud for operators — rather than failing the RPC
 *  and tearing down a working sandbox. The same applies to stop/renew updates. */
function persistSessionRecord(
  input: Parameters<typeof storeSessionRecord>[0],
): Effect.Effect<void, never> {
  return storeSessionRecord(input).pipe(
    Effect.catch((error: unknown) =>
      Effect.logError("Sandbox session store write failed; sandbox may be orphaned on restart", {
        instanceId: input.instanceId as string,
        message: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
}

/** Remove a session record from the store, logging (not swallowing) failures. */
function removeSessionRecord(instanceId: SandboxProviderInstanceId): Effect.Effect<void, never> {
  return sessionStore.remove(instanceId).pipe(
    Effect.catch((error: unknown) =>
      Effect.logError("Sandbox session store remove failed", {
        instanceId: instanceId as string,
        message: error instanceof Error ? error.message : String(error),
      }),
    ),
  );
}

/**
 * The live sandbox service. `startSession` requires the Kata Code Connect
 * service environment (read by `reconcileDesiredCloudLink`) in its context; the
 * other methods are self-contained. The `R` channel is inferred rather than
 * pinned so the Connect deps flow through to the ws handler runtime.
 */
export const SandboxServiceLive = {
  listInstances: (settings: ServerSettings) =>
    Effect.gen(function* () {
      // Lazy boot reconcile: on first listInstances, reconcile stored records
      // against provider lifecycle.status.
      yield* reconcileSessions(settings);
      const registry = buildRegistry();
      const rawMap = settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap;
      const resolvedMap: SandboxProviderInstanceConfigMap = Object.fromEntries(
        Object.entries(rawMap).map(([id, cfg]) => [
          id,
          resolveInstanceEnvelope(cfg as SandboxProviderInstanceConfig),
        ]),
      ) as SandboxProviderInstanceConfigMap;
      const materialized = registry.materialize(resolvedMap);
      const records = sessionStore.records;
      const recordByInstance = new Map(records.map((r) => [r.instanceId, r] as const));
      return yield* Effect.forEach(
        materialized,
        (inst) => toSummary(inst, recordByInstance.get(inst.instanceId as string)),
        { concurrency: "unbounded" },
      );
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
      const sessionKey = instanceId as string;
      // Operation lock: prevents concurrent start/stop/delete on the same instance.
      // Add to the lock BEFORE any yield (reconcile) so a concurrent startSession
      // for the same instance cannot pass the guard and orphan a second container.
      if (busyInstances.has(sessionKey)) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      busyInstances.add(sessionKey);
      return yield* Effect.gen(function* () {
        // Ensure reconcile has run so the store is populated.
        yield* reconcileSessions(settings);
        const existing = sessionStore.records.find((r) => r.instanceId === sessionKey);
        if (existing !== undefined && existing.status === "running") {
          return yield* new SandboxRpcError({
            reason: "provision-failed",
            message: "A session is already running for this sandbox environment.",
          });
        }
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
        const resolvedConfig = resolveInstanceEnvelope(config);
        const inst = registry.materializeOne(instanceId, resolvedConfig);
        if (inst.kind !== "available") {
          return yield* registryError(inst.reason, inst.message);
        }

        // ── Start-from-stopped path ──
        if (existing !== undefined && existing.status === "stopped") {
          if (inst.driver.lifecycle === undefined) {
            return yield* new SandboxRpcError({
              reason: "not-running",
              message: "This sandbox driver does not support lifecycle start.",
            });
          }
          // A stopped sandbox already has a seeded workspace; re-seeding is
          // not supported. Fail loud rather than silently dropping the input.
          if (options?.repository !== undefined) {
            return yield* new SandboxRpcError({
              reason: "invalid-config",
              message: "The sandbox already has a seeded workspace; delete it to re-seed.",
            });
          }
          const handle: SandboxHandle = {
            driverKind: inst.driver.kind,
            instanceId: sessionKey,
            // Re-inject Vercel auth into the stored (sanitized) handle.
            handle: reinjectVercelAuth(
              inst.driver.kind as string,
              existing.handle.handle,
              resolvedConfig.config,
            ),
          };
          // Fresh bootstrap token for the started server.
          // @effect-diagnostics-next-line effect(globalDateInEffect):off - random token, not a clock read.
          const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");
          const { env } = buildProvisionEnvironment({
            bootstrapToken,
            instanceEnvironment: resolvedConfig.environment,
          });
          const started = yield* inst.driver.lifecycle
            .start(handle, { config: resolvedConfig.config, env })
            .pipe(Effect.mapError(mapDriverError));
          // Re-run Connect registration + mint a fresh pairing token.
          const finalized = yield* registerAndFinalizeSession({
            sessionKey,
            instanceId,
            driver: inst.driver,
            handle: started,
            config: resolvedConfig,
            bootstrapToken,
            connectAuthToken: options?.connectAuthToken,
          });
          // Update the store record (logs on failure rather than swallowing).
          yield* persistSessionRecord({
            instanceId,
            driver: inst.driver,
            handle: started,
            config: resolvedConfig,
            environmentId: finalized.environmentId,
            endpoint: finalized.endpoint,
            relay: finalized.relay,
            status: "running",
          });
          // Cache the live session.
          liveSessions.set(sessionKey, {
            handle: started,
            driver: inst.driver,
            instanceConfig: resolvedConfig,
            environmentId: finalized.environmentId,
          });
          return {
            instanceId,
            environmentId: finalized.environmentId,
            pairingToken: finalized.pairingToken,
            endpoint: finalized.endpoint,
          };
        }

        // ── Provision path (no existing record) ──
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

        if (options?.repository !== undefined) {
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

          yield* runSandboxSetup({
            driver: inst.driver,
            handle,
            resolved: loaded.resolved,
            secretValues,
            seed: { repoRoot: options.repository.repoRoot },
          }).pipe(
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
        }

        const finalized = yield* registerAndFinalizeSession({
          sessionKey,
          instanceId,
          driver: inst.driver,
          handle,
          config: resolvedConfig,
          bootstrapToken,
          connectAuthToken: options?.connectAuthToken,
        });

        // Persist the session record (logs on failure rather than swallowing).
        yield* persistSessionRecord({
          instanceId,
          driver: inst.driver,
          handle,
          config: resolvedConfig,
          environmentId: finalized.environmentId,
          endpoint: finalized.endpoint,
          relay: finalized.relay,
          status: "running",
        });

        // Cache the live session.
        liveSessions.set(sessionKey, {
          handle,
          driver: inst.driver,
          instanceConfig: resolvedConfig,
          environmentId: finalized.environmentId,
        });

        return {
          instanceId,
          environmentId: finalized.environmentId,
          pairingToken: finalized.pairingToken,
          endpoint: finalized.endpoint,
        };
      }).pipe(Effect.ensuring(Effect.sync(() => busyInstances.delete(sessionKey))));
    }),

  stopSession: (instanceId: SandboxProviderInstanceId) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      if (busyInstances.has(sessionKey)) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      const record = sessionStore.records.find((r) => r.instanceId === sessionKey);
      if (record === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "No sandbox session to stop.",
        });
      }
      if (record.status === "stopped") {
        return { instanceId, stopped: true };
      }
      // Resolve the driver to call lifecycle.stop.
      const live = liveSessions.get(sessionKey);
      if (live === undefined || live.driver.lifecycle === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "This sandbox driver does not support lifecycle stop.",
        });
      }
      busyInstances.add(sessionKey);
      const lifecycle = live.driver.lifecycle;
      return yield* Effect.gen(function* () {
        yield* lifecycle.stop(live.handle).pipe(Effect.mapError(mapDriverError));
        // Update the store record to stopped; keep the relay link (log on failure).
        const { statusDetail: _dropDetail, ...restRecord } = record;
        yield* sessionStore.upsert({ ...restRecord, status: "stopped" }).pipe(
          Effect.catch((error: unknown) =>
            Effect.logError("Sandbox session store write failed during stop", {
              instanceId: sessionKey,
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
        return { instanceId, stopped: true };
      }).pipe(Effect.ensuring(Effect.sync(() => busyInstances.delete(sessionKey))));
    }),

  disposeSession: (instanceId: SandboxProviderInstanceId, settings: ServerSettings) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      if (busyInstances.has(sessionKey)) {
        return false;
      }
      // Read from the store — works even when the client that started the
      // session is gone (AC-L9).
      const record = sessionStore.records.find((r) => r.instanceId === sessionKey);
      if (record === undefined) return false;
      busyInstances.add(sessionKey);
      return yield* Effect.gen(function* () {
        // Unlink the environment from the relay so it disappears from the
        // Connect pool immediately. Non-fatal: if the unlink fails, the relay
        // link lapses when the sandbox becomes unreachable. The bearer token
        // is not stored; re-resolve it via resolveConnectAuthToken.
        if (record.relay) {
          const bearerToken = yield* resolveConnectAuthToken(undefined, "stored-first").pipe(
            Effect.catch(() => Effect.succeed(null)),
          );
          if (bearerToken !== null) {
            yield* deleteJson(
              RelayOkResponse,
              `${record.relay.relayUrl}/v1/client/environment-links/${record.sandboxEnvironmentId}`,
              bearerToken,
            ).pipe(
              Effect.catch((error: SandboxRpcError) =>
                Effect.logWarning("Could not unlink sandbox from relay", {
                  environmentId: record.sandboxEnvironmentId,
                  message: error.message,
                }).pipe(Effect.asVoid),
              ),
            );
          }
        }
        // Delete the provider sandbox via the driver.
        const live = liveSessions.get(sessionKey);
        if (live !== undefined) {
          yield* live.driver.dispose(live.handle).pipe(Effect.mapError(mapDriverError));
        } else {
          // No live session — reconstruct the driver from the registry using
          // the instance config from settings.
          const config = (settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap)[
            instanceId as SandboxProviderInstanceId
          ];
          if (config !== undefined) {
            const registry = buildRegistry();
            const inst = registry.materializeOne(instanceId, resolveInstanceEnvelope(config));
            if (inst.kind === "available") {
              const resolvedConfig = resolveInstanceEnvelope(config);
              const handle: SandboxHandle = {
                driverKind: inst.driver.kind,
                instanceId: sessionKey,
                // Re-inject Vercel auth into the stored (sanitized) handle.
                handle: reinjectVercelAuth(
                  inst.driver.kind as string,
                  record.handle.handle,
                  resolvedConfig.config,
                ),
              };
              yield* inst.driver.dispose(handle).pipe(Effect.mapError(mapDriverError));
            } else {
              // Driver unavailable (removed from settings or invalid config) —
              // the sandbox VM may remain running on the provider with no handle
              // to delete it. Surface this so an operator can clean it up; the
              // store record is still removed below (we can no longer manage it).
              yield* Effect.logWarning(
                "Sandbox dispose: driver unavailable; sandbox may be orphaned on the provider",
                {
                  instanceId: sessionKey,
                  reason: inst.kind === "unavailable" ? inst.reason : "unknown",
                },
              );
            }
          } else {
            // Instance removed from settings and no live driver reference —
            // cannot reach the provider to delete the sandbox. Surface it.
            yield* Effect.logWarning(
              "Sandbox dispose: instance no longer in settings; sandbox may be orphaned on the provider",
              { instanceId: sessionKey },
            );
          }
        }
        // Remove the store record.
        yield* removeSessionRecord(instanceId);
        liveSessions.delete(sessionKey);
        return true;
      }).pipe(Effect.ensuring(Effect.sync(() => busyInstances.delete(sessionKey))));
    }),

  renewSession: (instanceId: SandboxProviderInstanceId, input?: { readonly extendMs?: number }) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      const record = sessionStore.records.find((r) => r.instanceId === sessionKey);
      if (record === undefined || record.status !== "running") {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "No running sandbox session to renew.",
        });
      }
      const live = liveSessions.get(sessionKey);
      if (live === undefined || live.driver.renewTimeout === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "This sandbox driver does not support timeout renewal.",
        });
      }
      const extendMs = input?.extendMs ?? resolveSandboxTimeoutMs(live.instanceConfig.config);
      yield* live.driver.renewTimeout
        .renewTimeout(live.handle, extendMs)
        .pipe(Effect.mapError(mapDriverError));
      // @effect-diagnostics-next-line globalDateInEffect:off - host-side deadline arithmetic.
      const deadline = Date.now() + extendMs;
      yield* sessionStore.upsert({ ...record, deadlineEpochMs: deadline }).pipe(
        Effect.catch((error: unknown) =>
          Effect.logError("Sandbox session store write failed during renew", {
            instanceId: sessionKey,
            message: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
      return { instanceId, deadlineEpochMs: deadline };
    }),

  providerLoginStart: (input: {
    readonly instanceId: SandboxProviderInstanceId;
    readonly providerId: string;
  }): Stream.Stream<SandboxProviderLoginEvent, SandboxRpcError> => {
    const live = liveSessions.get(input.instanceId as string);
    if (live === undefined) {
      return Stream.fail(
        new SandboxRpcError({
          reason: "not-running",
          message: "No sandbox session to sign in to.",
        }),
      );
    }
    return startProviderLogin({
      driver: live.driver,
      handle: live.handle,
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
