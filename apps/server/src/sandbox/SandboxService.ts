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
import * as NodePath from "node:path";
// @effect-diagnostics nodeBuiltinImport:on
import * as os from "node:os";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { type AdvertisedEndpoint, type ServerSettings } from "@kata-sh/code-contracts";
import { resolveDefaultKatacodeHome } from "@kata-sh/code-shared/branding";
import {
  type SandboxProviderInstanceConfigMap,
  SandboxProviderInstanceId,
} from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";
import { RepositoryCanonicalKey } from "@kata-sh/code-contracts";
import {
  type SandboxProviderLoginEvent,
  type SandboxStartSessionInput,
  type SandboxTestConnectionProgressEvent,
  SandboxRpcError,
} from "@kata-sh/code-contracts/sandboxRpc";
import {
  SandboxProviderError,
  type SandboxHandle,
  type SandboxProvider,
} from "@kata-sh/code-sandbox/driver";
import { DockerSandboxProvider } from "@kata-sh/code-sandbox-docker";
import { RelayOkResponse } from "@kata-sh/code-contracts/relay";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { loadEnvironmentConfig } from "./environmentConfigLoader.ts";
import { SetupFailed, runSandboxSetup } from "./sandboxSetupRunner.ts";
import {
  makeSandboxSessionStore,
  type SandboxSessionRecord,
  type SandboxSessionStore,
} from "./sandboxSessionStore.ts";
import {
  buildRegistry,
  toSummary,
  resolveInstanceEnvelope,
  reinjectVercelAuth,
  sanitizeHandleForStore,
} from "./sandboxSessionHelpers.ts";
import { reconcileStoredRecords, discoverUntrackedSessions } from "./sandboxReconcile.ts";
import type { LiveSession } from "./sandboxSessionTypes.ts";
import {
  cancelProviderLogin,
  startProviderLogin,
  submitProviderLoginCode,
} from "./providerLogin.ts";
import {
  resolveConnectAuthToken,
  issueSandboxPairingCredential,
  deleteJson,
} from "./sandboxConnect.ts";
import {
  either,
  mapLoadError,
  mapSetupFailed,
  mapDriverError,
  registryError,
  runCredentialSeed,
  buildProvisionEnvironment,
  resolveProvisionImage,
  resolveSandboxTimeoutMs,
} from "./sandboxProvisionHelpers.ts";
import {
  disposeAfterFailure as disposeAfterFailureImpl,
  registerAndFinalizeSession as registerAndFinalizeSessionImpl,
} from "./sandboxSessionFinalize.ts";

export type { LiveSession } from "./sandboxSessionTypes.ts";
export { sanitizeHandleForStore, reinjectVercelAuth } from "./sandboxSessionHelpers.ts";
export { reconcileStoredRecords, discoverUntrackedSessions } from "./sandboxReconcile.ts";
/** Re-export for existing tests that import from SandboxService. */
export { connectAuthTokenPreferenceForEndpoint } from "./sandboxConnect.ts";

function removeStoreRecordOnFailure(sessionKey: string): Effect.Effect<void, never> {
  return Effect.ignore(getSessionStore().remove(sessionKey as never)).pipe(Effect.asVoid);
}

/** Wrap finalize so dispose-after-failure can remove the store record. */
function registerAndFinalizeSession(
  input: Omit<Parameters<typeof registerAndFinalizeSessionImpl>[0], "removeStoreRecord">,
): ReturnType<typeof registerAndFinalizeSessionImpl> {
  return registerAndFinalizeSessionImpl({
    ...input,
    removeStoreRecord: removeStoreRecordOnFailure,
  });
}

function disposeAfterFailure(
  sessionKey: string,
  driver: SandboxProvider,
  handle: SandboxHandle,
): Effect.Effect<void, never> {
  return disposeAfterFailureImpl(sessionKey, driver, handle, removeStoreRecordOnFailure);
}

/** Ephemeral instance id for `testConnection` so deterministic Docker/Vercel
 *  names cannot adopt (and then dispose) an existing durable sandbox. */
export function makeTestConnectionProbeInstanceId(instanceId: string): string {
  return `${instanceId}__probe_${NodeCrypto.randomBytes(4).toString("hex")}`;
}

/** Durable session store — the source of truth for sandbox session state.
 *  Configured via `configureSandboxRuntime` from the WS layer with
 *  `ServerConfig.stateDir` (respects `KATACODE_HOME` / `--base-dir`). */
let sessionStore: SandboxSessionStore | null = null;
let configuredStateDir: string | null = null;
/** Server environment id used to namespace Vercel sandbox names so two Kata
 *  servers sharing one Vercel project do not collide on the same instance id. */
let sandboxNameNamespace: string | undefined;

/**
 * Bind the durable session store (and optional Vercel name namespace) to the
 * running server's state directory. Idempotent when `stateDir` is unchanged.
 * Call from the WS layer before any sandbox RPC.
 */
export function configureSandboxRuntime(input: {
  readonly stateDir: string;
  readonly nameNamespace?: string;
}): void {
  sandboxNameNamespace = input.nameNamespace;
  if (sessionStore !== null && configuredStateDir === input.stateDir) return;
  configuredStateDir = input.stateDir;
  sessionStore = makeSandboxSessionStore(input.stateDir);
  // A new store must re-reconcile against providers.
  reconcileDone = false;
  liveSessions.clear();
}

/** Resolve the session store, lazily falling back to `<katacodeHome>/userdata`
 *  only when tests or early callers have not configured the runtime. */
function getSessionStore(): SandboxSessionStore {
  if (sessionStore === null) {
    const fallback = NodePath.join(resolveDefaultKatacodeHome(os.homedir()), "userdata");
    configuredStateDir = fallback;
    sessionStore = makeSandboxSessionStore(fallback);
  }
  return sessionStore;
}

/** In-memory cache of live sessions (instanceId → driver + handle). Populated
 *  by startSession and reconcile; read by providerLogin (needs the driver for
 *  exec). The store holds the durable state; this holds the ephemeral driver
 *  reference. */
const liveSessions = new Map<string, LiveSession>();

/** In-flight operation reservations (instanceId). Prevents concurrent
 *  start/stop/delete operations from racing. Cleared in an ensuring block. */
const busyInstances = new Set<string>();

/** Test-only: mark an instance busy so dispose/start/stop refuse with a
 *  provision-failed race error. Cleared via `clearSandboxInstanceBusyForTests`. */
export function markSandboxInstanceBusyForTests(instanceId: string): void {
  busyInstances.add(instanceId);
}

export function clearSandboxInstanceBusyForTests(instanceId: string): void {
  busyInstances.delete(instanceId);
}

/** Test-only: seed the in-memory live-session cache (e.g. stopped-store + live
 *  handle races for providerLoginStart). Cleared via `clearLiveSessionForTests`. */
export function setLiveSessionForTests(instanceId: string, live: LiveSession): void {
  liveSessions.set(instanceId, live);
}

export function clearLiveSessionForTests(instanceId: string): void {
  liveSessions.delete(instanceId);
}

/** Whether a boot reconcile is currently running. Lifecycle ops wait/fail
 *  rather than racing a full-store rewrite. */
let reconcileInProgress = false;

/** Whether boot reconcile has run. Reconcile runs lazily on first
 *  `listInstances` if it hasn't run yet. */
let reconcileDone = false;

/** Best-effort relay unlink for a session record (dispose + gone-eviction
 *  share this). The bearer token is never stored; re-resolve it. All failures
 *  log and succeed — a dead relay link lapses on its own eventually. */
function unlinkSandboxFromRelay(
  record: SandboxSessionRecord,
): Effect.Effect<void, never, CliTokenManager.CloudCliTokenManager> {
  return Effect.gen(function* () {
    if (record.relay === undefined) return;
    const bearerToken = yield* resolveConnectAuthToken(undefined, "stored-first").pipe(
      Effect.orElseSucceed(() => null),
    );
    if (bearerToken === null) {
      yield* Effect.logWarning("Sandbox relay unlink skipped: no Connect credential", {
        environmentId: record.sandboxEnvironmentId,
      });
      return;
    }
    yield* deleteJson(
      RelayOkResponse,
      `${record.relay.relayUrl}/v1/client/environment-links/${record.sandboxEnvironmentId}`,
      bearerToken,
    ).pipe(
      Effect.asVoid,
      Effect.catch((error: SandboxRpcError) =>
        Effect.logWarning("Could not unlink sandbox from relay", {
          environmentId: record.sandboxEnvironmentId,
          message: error.message,
        }).pipe(Effect.asVoid),
      ),
    );
  });
}

function reconcileSessions(
  settings: ServerSettings,
): Effect.Effect<void, never, CliTokenManager.CloudCliTokenManager> {
  return Effect.gen(function* () {
    if (reconcileDone) return;
    // Do not rewrite the store while a lifecycle op holds an instance lock.
    if (busyInstances.size > 0) return;
    reconcileInProgress = true;
    try {
      const store = getSessionStore();
      yield* reconcileStoredRecords({
        store,
        registry: buildRegistry(),
        settings,
        liveSessions,
        unlinkRelay: (record) => unlinkSandboxFromRelay(record),
      });
      // Discovery: for configured instances with supportsLifecycle and no store
      // record, probe the provider for an existing sandbox (e.g. created before
      // the durable store existed, or after a store reset). Found sandboxes are
      // persisted so the UI reports them as running/stopped with the right actions.
      yield* discoverUntrackedSessions({
        store,
        registry: buildRegistry(),
        settings,
        liveSessions,
        ...(sandboxNameNamespace !== undefined ? { nameNamespace: sandboxNameNamespace } : {}),
      });
      reconcileDone = true;
    } finally {
      reconcileInProgress = false;
    }
  });
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
  return getSessionStore().upsert(record);
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
  return getSessionStore()
    .remove(instanceId)
    .pipe(
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
      const records = getSessionStore().records;
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
        // Use a unique probe instance id so Docker/Vercel deterministic naming
        // cannot adopt (and then dispose) an existing durable sandbox.
        return validate.pipe(
          Stream.flatMap((validateEvent) => {
            if (!validateEvent.ok) return Stream.make(validateEvent);
            const probeInstanceId = makeTestConnectionProbeInstanceId(instanceId as string);
            const provision = Stream.fromEffect(
              either(
                inst.driver.provision({
                  instanceId: probeInstanceId,
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
      if (busyInstances.has(sessionKey) || reconcileInProgress) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      busyInstances.add(sessionKey);
      return yield* Effect.gen(function* () {
        // Ensure reconcile has run so the store is populated.
        yield* reconcileSessions(settings);
        const existing = getSessionStore().records.find((r) => r.instanceId === sessionKey);
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
          // Docker env is fixed at container create: the restarted in-container
          // server re-seeds its ORIGINAL create-time bootstrap grant, not the
          // fresh token minted above. Recover the effective token from the
          // container env so the exchange matches what the server booted with.
          // (Vercel relaunches `serve` with the fresh env, so it keeps the
          // fresh token.)
          let effectiveBootstrapToken = bootstrapToken;
          if ((inst.driver.kind as string) === (DockerSandboxProvider.kind as string)) {
            const recovered = yield* inst.driver
              .exec(started, "printenv KATACODE_DESKTOP_BOOTSTRAP_TOKEN")
              .pipe(Effect.mapError(mapDriverError));
            const token = recovered.stdout.trim();
            if (token.length === 0) {
              return yield* new SandboxRpcError({
                reason: "connect-failed",
                message:
                  "Started container has no KATACODE_DESKTOP_BOOTSTRAP_TOKEN in its environment; delete the sandbox and create it again.",
              });
            }
            effectiveBootstrapToken = token;
          }
          // Re-run Connect registration + mint a fresh pairing token. `keep`:
          // a transient Connect failure must never destroy a stopped-started
          // sandbox's durable filesystem — the user retries Start.
          const finalized = yield* registerAndFinalizeSession({
            sessionKey,
            instanceId,
            driver: inst.driver,
            handle: started,
            config: resolvedConfig,
            bootstrapToken: effectiveBootstrapToken,
            connectAuthToken: options?.connectAuthToken,
            failureCleanup: "keep",
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
            adminAccessToken: finalized.adminAccessToken,
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
            ...(sandboxNameNamespace !== undefined ? { nameNamespace: sandboxNameNamespace } : {}),
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
          adminAccessToken: finalized.adminAccessToken,
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
      if (busyInstances.has(sessionKey) || reconcileInProgress) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      const record = getSessionStore().records.find((r) => r.instanceId === sessionKey);
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
        yield* getSessionStore()
          .upsert({ ...restRecord, status: "stopped" })
          .pipe(
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
      if (busyInstances.has(sessionKey) || reconcileInProgress) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      // Read from the store — works even when the client that started the
      // session is gone (AC-L9).
      const record = getSessionStore().records.find((r) => r.instanceId === sessionKey);
      if (record === undefined) return false;
      busyInstances.add(sessionKey);
      return yield* Effect.gen(function* () {
        // Unlink the environment from the relay so it disappears from the
        // Connect pool immediately. Non-fatal: if the unlink fails, the relay
        // link lapses when the sandbox becomes unreachable.
        yield* unlinkSandboxFromRelay(record);
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
      const record = getSessionStore().records.find((r) => r.instanceId === sessionKey);
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
      yield* getSessionStore()
        .upsert({ ...record, deadlineEpochMs: deadline })
        .pipe(
          Effect.catch((error: unknown) =>
            Effect.logError("Sandbox session store write failed during renew", {
              instanceId: sessionKey,
              message: error instanceof Error ? error.message : String(error),
            }),
          ),
        );
      return { instanceId, deadlineEpochMs: deadline };
    }),

  /** Re-issue a pairing token for a running sandbox (identity recovery R2).
   *  Used when client-side pairing failed after a successful start. Requires
   *  the in-memory admin token from this server's start of the sandbox; after
   *  a server restart the token is gone — fail loud with the Stop/Start
   *  recovery path (which re-mints everything). */
  issuePairingToken: (instanceId: SandboxProviderInstanceId) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      const record = getSessionStore().records.find((r) => r.instanceId === sessionKey);
      if (record === undefined || record.status !== "running") {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "No running sandbox session to pair with.",
        });
      }
      const live = liveSessions.get(sessionKey);
      if (live === undefined || live.adminAccessToken === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message:
            "Pairing requires a fresh admin credential, which this server no longer holds (it restarts on Stop/Start). Stop and start the sandbox to re-pair.",
        });
      }
      const endpoint = record.endpoint as AdvertisedEndpoint;
      const connectBaseUrl = endpoint.httpBaseUrl.replace("localhost", "127.0.0.1");
      const pairingToken = yield* issueSandboxPairingCredential({
        httpBaseUrl: connectBaseUrl,
        adminAccessToken: live.adminAccessToken,
      });
      return {
        instanceId,
        environmentId: record.sandboxEnvironmentId,
        pairingToken,
        endpoint,
      };
    }),

  providerLoginStart: (input: {
    readonly instanceId: SandboxProviderInstanceId;
    readonly providerId: string;
  }): Stream.Stream<SandboxProviderLoginEvent, SandboxRpcError> => {
    const sessionKey = input.instanceId as string;
    const record = getSessionStore().records.find((r) => r.instanceId === sessionKey);
    if (record === undefined || record.status !== "running") {
      return Stream.fail(
        new SandboxRpcError({
          reason: "not-running",
          message: "No running sandbox session to sign in to.",
        }),
      );
    }
    const live = liveSessions.get(sessionKey);
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

  providerLoginCancel: (input: {
    readonly instanceId: SandboxProviderInstanceId;
    readonly loginSessionId: string;
  }) =>
    Effect.sync(() => {
      cancelProviderLogin({
        loginSessionId: input.loginSessionId,
        instanceId: input.instanceId as string,
      });
      return { loginSessionId: input.loginSessionId, cancelled: true };
    }),
};

export type SandboxService = typeof SandboxServiceLive;
