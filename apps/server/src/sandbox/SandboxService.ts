/**
 * `SandboxService` — server-side orchestration for sandbox deployment targets.
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
import {
  type SandboxInstanceSummary,
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
  type RelayEnvironmentConfigRequest,
  RelayEnvironmentLinkChallengeResponse,
  RelayEnvironmentLinkResponse,
  type RelayLinkProofRequest,
} from "@kata-sh/code-contracts/relay";
import { WIRE_ENVIRONMENT_WELL_KNOWN_PATH } from "@kata-sh/code-contracts/wireIdentity";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { relayUrlConfig } from "../cloud/publicConfig.ts";

/** A sandbox `AdvertisedEndpointProvider` (manual kind; container-sourced). */
const SANDBOX_ENDPOINT_PROVIDER: AdvertisedEndpointProvider = {
  id: "sandbox-container",
  label: "Container",
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
  return registry;
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
    return {
      kind: "available",
      instanceId: inst.instanceId,
      driver: descriptor.kind as string,
      reachabilityKind: descriptor.reachabilityKind,
      supportsSnapshot: descriptor.supportsSnapshot,
      supportsRenewTimeout: descriptor.supportsRenewTimeout,
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
    client_label: "Kata Code deployment target",
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
}): Effect.Effect<
  ExecutionEnvironmentDescriptor,
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
      providerKind: "cloudflare_tunnel" as const,
    };
    const url = new URL(input.httpBaseUrl);
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
        localHttpHost: "127.0.0.1",
        localHttpPort: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
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
    return descriptor;
  });
}

const RelayConfigResponse = Schema.Struct({ ok: Schema.Boolean });

/** A running sandbox session: the provisioned handle plus the driver that
 * created it, so `disposeSession` routes to the correct driver rather than a
 * hardcoded one. Phase 1; not durable (server restart cannot reclaim these —
 * see deferred-work for a startup container sweep). */
interface RunningSession {
  readonly handle: SandboxHandle;
  readonly driver: SandboxProvider;
}

/** In-memory map of running sessions (instanceId → handle + driver). Phase 1; not durable. */
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
      const materialized = registry.materialize(
        settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap,
      );
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
        const inst = registry.materializeOne(instanceId, config);
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
    options?: { readonly connectAuthToken?: SandboxStartSessionInput["connectAuthToken"] },
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
          message: "A session is already running for this deployment target.",
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
        const inst = registry.materializeOne(instanceId, config);
        if (inst.kind !== "available") {
          return yield* registryError(inst.reason, inst.message);
        }
        // Per-session Kata WebSocket auth token (required for non-loopback clients).
        // @effect-diagnostics-next-line effect(globalDateInEffect):off - random token, not a clock read.
        const bootstrapToken = NodeCrypto.randomBytes(24).toString("hex");
        const handle = yield* inst.driver
          .provision({
            instanceId: instanceId as string,
            config: inst.config,
            image: resolveProvisionImage(inst.config),
            env: [["KATACODE_DESKTOP_BOOTSTRAP_TOKEN", bootstrapToken]],
          })
          .pipe(Effect.mapError(mapDriverError));
        runningSessions.set(sessionKey, { handle, driver: inst.driver });
        const reach = yield* inst.driver.reachability(handle, 13773).pipe(
          Effect.mapError(mapDriverError),
          Effect.catch((error: SandboxRpcError) =>
            Effect.sync(() => runningSessions.delete(sessionKey)).pipe(
              Effect.andThen(
                inst.driver.dispose(handle).pipe(
                  Effect.catch((disposeError) =>
                    Effect.logWarning("Could not dispose sandbox after reachability failure", {
                      cause: disposeError,
                    }),
                  ),
                ),
              ),
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );
        const endpoint: AdvertisedEndpoint = createAdvertisedEndpoint({
          id: `sandbox-${instanceId as string}`,
          label: config.displayName ?? `Container ${instanceId as string}`,
          provider: SANDBOX_ENDPOINT_PROVIDER,
          httpBaseUrl: reach.httpBaseUrl,
          reachability: "loopback",
          source: "server",
        });
        // Connect auto-registration (AC-1.11): authenticate to the freshly booted
        // container with its desktop bootstrap token, ask that container to sign
        // the link proof for its own descriptor/keypair, then apply the returned
        // relay config back to the container. This keeps the linked environment id
        // and endpoint bound to the deployed container rather than the parent
        // desktop server. A missing user/CLI Connect token or relay failure fails
        // the RPC and tears down the just-created container.
        const descriptor = yield* registerSandboxWithConnect({
          httpBaseUrl: reach.httpBaseUrl.replace("localhost", "127.0.0.1"),
          bootstrapToken,
          connectAuthToken: options?.connectAuthToken,
        }).pipe(
          Effect.catch((error: SandboxRpcError) =>
            Effect.sync(() => runningSessions.delete(sessionKey)).pipe(
              Effect.andThen(
                inst.driver.dispose(handle).pipe(
                  Effect.catch((disposeError) =>
                    Effect.logWarning(
                      "Could not dispose sandbox after Connect registration failure",
                      {
                        cause: disposeError,
                      },
                    ),
                  ),
                ),
              ),
              Effect.andThen(
                Effect.fail(
                  new SandboxRpcError({
                    reason: "connect-failed",
                    message: `Connect auto-registration failed: ${error.message}`,
                  }),
                ),
              ),
            ),
          ),
        );
        return { instanceId, environmentId: descriptor.environmentId, endpoint };
      }).pipe(Effect.ensuring(Effect.sync(() => startingSessions.delete(sessionKey))));
    }),

  disposeSession: (instanceId: SandboxProviderInstanceId) =>
    Effect.gen(function* () {
      const entry = runningSessions.get(instanceId as string);
      if (entry === undefined) return false;
      // Route through the driver that created the handle rather than a
      // hardcoded one, so a future non-Docker driver disposes its own
      // sandboxes correctly (the handle's `driverKind` is the routing key).
      yield* entry.driver.dispose(entry.handle).pipe(Effect.mapError(mapDriverError));
      runningSessions.delete(instanceId as string);
      return true;
      // Connect unlink: the existing cloud/ entry points expose no per-origin
      // unlink, so the relay link lapses when this loopback origin becomes
      // unreachable (container removed). AC-1.12: the deployment disappears from
      // the Connect pool once the container is gone.
    }),
};

export type SandboxService = typeof SandboxServiceLive;
