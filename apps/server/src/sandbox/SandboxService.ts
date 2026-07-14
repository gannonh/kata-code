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
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { type AdvertisedEndpoint, type ServerSettings } from "@kata-sh/code-contracts";
import { resolveDefaultKatacodeHome } from "@kata-sh/code-shared/branding";
import {
  type SandboxProviderInstanceConfigMap,
  SandboxProviderInstanceId,
} from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";
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
import { RelayOkResponse } from "@kata-sh/code-contracts/relay";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
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
import {
  reconcileStoredRecords,
  discoverUntrackedSessions,
  cacheLiveSession,
} from "./sandboxReconcile.ts";
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
  renewSandboxConnectLease,
} from "./sandboxConnect.ts";
import {
  either,
  mapDriverError,
  registryError,
  resolveProvisionImage,
  resolveSandboxTimeoutMs,
} from "./sandboxProvisionHelpers.ts";
import {
  disposeAfterFailure as disposeAfterFailureImpl,
  registerAndFinalizeSession as registerAndFinalizeSessionImpl,
} from "./sandboxSessionFinalize.ts";
import { type PersistSandboxSessionInput, startSandboxSession } from "./sandboxStartSession.ts";

export type { LiveSession } from "./sandboxSessionTypes.ts";
export { sanitizeHandleForStore, reinjectVercelAuth } from "./sandboxSessionHelpers.ts";
export {
  reconcileStoredRecords,
  discoverUntrackedSessions,
  cacheLiveSession,
} from "./sandboxReconcile.ts";
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
  // A new store must re-discover untracked sandboxes; status refresh is always on.
  discoveryDone = false;
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

/** Serializes status refreshes so concurrent listInstances callers join
 *  the active refresh instead of skipping a probe or racing. */
let reconcileJoin: Deferred.Deferred<void, never> | null = null;

/** Whether untracked-session discovery has run. Discovery stays one-shot;
 *  provider status refresh runs on every list/lifecycle entry. */
let discoveryDone = false;

/** Bounded relay unlink for a session record (dispose + gone-eviction share
 *  this). The bearer token is never stored; re-resolve it. The boolean makes
 *  partial cleanup observable while lease expiry remains the crash backstop. */
function unlinkSandboxFromRelay(
  record: SandboxSessionRecord,
): Effect.Effect<boolean, never, CliTokenManager.CloudCliTokenManager> {
  return Effect.gen(function* () {
    if (record.relay === undefined) return true;
    const bearerToken = yield* resolveConnectAuthToken(undefined, "stored-first").pipe(
      Effect.orElseSucceed(() => null),
    );
    if (bearerToken === null) {
      yield* Effect.logWarning("Sandbox relay unlink skipped: no Connect credential", {
        environmentId: record.sandboxEnvironmentId,
      });
      return false;
    }
    return yield* deleteJson(
      RelayOkResponse,
      `${record.relay.relayUrl}/v1/client/environment-links/${record.sandboxEnvironmentId}`,
      bearerToken,
    ).pipe(
      Effect.timeout("5 seconds"),
      Effect.as(true),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not unlink sandbox from relay", {
          environmentId: record.sandboxEnvironmentId,
          cause,
        }).pipe(Effect.as(false)),
      ),
    );
  });
}

/** Renew every persisted sandbox Connect lease managed by this server. */
export const renewSandboxRelayLeases = Effect.fn("sandbox.renewRelayLeases")(function* () {
  const records = yield* getSessionStore()
    .load()
    .pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not load sandbox sessions for Connect lease renewal", {
          cause,
        }).pipe(Effect.as([] as ReadonlyArray<SandboxSessionRecord>)),
      ),
    );
  const linkedRecords = records.filter((record) => record.relay !== undefined);
  if (linkedRecords.length === 0) return 0;
  const bearerToken = yield* resolveConnectAuthToken(undefined, "stored-first").pipe(
    Effect.orElseSucceed(() => null),
  );
  if (bearerToken === null) return 0;
  const renewed = yield* Effect.forEach(
    linkedRecords,
    (record) =>
      renewSandboxConnectLease({
        relayUrl: record.relay!.relayUrl,
        environmentId: record.sandboxEnvironmentId,
        bearerToken,
      }).pipe(
        Effect.as(1),
        Effect.catch((cause) => {
          if (cause.httpStatus === 404) {
            const { relay: _staleRelay, ...unlinkedRecord } = record;
            return getSessionStore()
              .upsert(unlinkedRecord)
              .pipe(
                Effect.tap(() =>
                  Effect.logInfo("Sandbox Connect link no longer exists; pairing is required", {
                    environmentId: record.sandboxEnvironmentId,
                  }),
                ),
                Effect.as(0),
                Effect.catch((persistCause) =>
                  Effect.logWarning("Could not clear stale sandbox Connect link", {
                    environmentId: record.sandboxEnvironmentId,
                    cause: persistCause,
                  }).pipe(Effect.as(0)),
                ),
              );
          }
          return Effect.logWarning("Could not renew sandbox Connect lease", {
            environmentId: record.sandboxEnvironmentId,
            cause,
          }).pipe(Effect.as(0));
        }),
      ),
    { concurrency: 4 },
  );
  return renewed.reduce((total, value) => total + value, 0);
});

function reconcileSessions(
  settings: ServerSettings,
): Effect.Effect<void, never, CliTokenManager.CloudCliTokenManager> {
  return Effect.gen(function* () {
    // Join an in-flight refresh so concurrent listInstances never return on a
    // skipped probe (stale stopped/running). Claim ownership synchronously
    // (makeUnsafe + assign before any yield) so two fibers cannot both create
    // Deferreds; cleanup only clears the join this fiber owns.
    if (reconcileJoin !== null) {
      yield* Deferred.await(reconcileJoin);
      return;
    }
    const join = Deferred.makeUnsafe<void, never>();
    reconcileJoin = join;
    yield* Effect.gen(function* () {
      const store = getSessionStore();
      // Always refresh from provider lifecycle.status. Skip instances under a
      // lifecycle lock — those use refreshLockedInstanceStatus instead.
      yield* reconcileStoredRecords({
        store,
        registry: buildRegistry(),
        settings,
        liveSessions,
        unlinkRelay: (record) => unlinkSandboxFromRelay(record).pipe(Effect.asVoid),
        skipInstanceIds: new Set(busyInstances),
      });
      // Discovery stays one-shot and only runs when no lifecycle op holds a
      // lock (avoid adopting a sandbox another op is creating/deleting).
      if (!discoveryDone && busyInstances.size === 0) {
        yield* discoverUntrackedSessions({
          store,
          registry: buildRegistry(),
          settings,
          liveSessions,
          ...(sandboxNameNamespace !== undefined ? { nameNamespace: sandboxNameNamespace } : {}),
        });
        discoveryDone = true;
      }
    }).pipe(
      Effect.ensuring(
        Effect.gen(function* () {
          if (reconcileJoin === join) {
            reconcileJoin = null;
          }
          yield* Deferred.succeed(join, undefined);
        }),
      ),
    );
  });
}

/**
 * Refresh one instance's stored status while its lifecycle lock is held.
 * `reconcileSessions` skips when any instance is busy, so start/stop/delete
 * must probe the provider for *this* instance before branching on status.
 */
function refreshLockedInstanceStatus(
  sessionKey: string,
  settings: ServerSettings,
): Effect.Effect<void, never, CliTokenManager.CloudCliTokenManager> {
  return Effect.gen(function* () {
    const store = getSessionStore();
    const record = store.records.find((r) => r.instanceId === sessionKey);
    if (record === undefined) return;
    const rawMap = settings.sandboxProviderInstances as SandboxProviderInstanceConfigMap;
    const config = rawMap[sessionKey as SandboxProviderInstanceId];
    if (config === undefined) return;
    const resolved = resolveInstanceEnvelope(config);
    const inst = buildRegistry().materializeOne(sessionKey as SandboxProviderInstanceId, resolved);
    if (inst.kind !== "available" || inst.driver.lifecycle === undefined) return;
    const handle: SandboxHandle = {
      driverKind: inst.driver.kind,
      instanceId: sessionKey,
      handle: reinjectVercelAuth(inst.driver.kind as string, record.handle.handle, resolved.config),
    };
    // Bound the provider status probe so a hung daemon/socket cannot stall the
    // stop/start RPC that gates on it (the button would stick on "Stopping…").
    const statusResult = yield* inst.driver.lifecycle.status(handle).pipe(
      Effect.timeout("15 seconds"),
      Effect.catchTag("TimeoutError", () =>
        Effect.fail(
          new SandboxProviderError({
            reason: "unreachable",
            message: "Provider status probe timed out.",
          }),
        ),
      ),
      Effect.matchEffect({
        onFailure: (left) =>
          Effect.succeed<{ _tag: "Left"; left: typeof left }>({ _tag: "Left", left }),
        onSuccess: (right) =>
          Effect.succeed<{ _tag: "Right"; right: typeof right }>({ _tag: "Right", right }),
      }),
    );
    if (statusResult._tag === "Left") {
      const { statusDetail: _drop, ...rest } = record;
      yield* store
        .upsert({
          ...rest,
          statusDetail: `Reconcile failed: ${statusResult.left.message}`,
        })
        .pipe(Effect.ignore);
      cacheLiveSession(liveSessions, sessionKey, {
        handle,
        driver: inst.driver,
        instanceConfig: resolved,
        environmentId: record.sandboxEnvironmentId,
      });
      return;
    }
    if (statusResult.right === "gone") {
      liveSessions.delete(sessionKey);
      if (record.relay !== undefined) {
        yield* unlinkSandboxFromRelay(record).pipe(Effect.asVoid);
      }
      yield* store.remove(sessionKey as never).pipe(Effect.ignore);
      return;
    }
    const { statusDetail: _dropDetail, ...restRecord } = record;
    yield* store
      .upsert({
        ...restRecord,
        status: statusResult.right,
      })
      .pipe(Effect.ignore);
    cacheLiveSession(liveSessions, sessionKey, {
      handle,
      driver: inst.driver,
      instanceConfig: resolved,
      environmentId: record.sandboxEnvironmentId,
    });
  });
}

function storeSessionRecord(input: PersistSandboxSessionInput): Effect.Effect<void, Error> {
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
    ...(input.sourceFingerprint !== undefined
      ? { sourceFingerprint: input.sourceFingerprint }
      : {}),
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
      // Always refresh provider status, but never block the UI RPC on it.
      // Awaiting reconcile here made Environments time out (client 30s) whenever
      // a Vercel/Docker status probe was slow — while Available Runtimes stayed
      // green because they use the live WS, not this list. Concurrent
      // orchestrators still converge via the background pass + join Deferred.
      yield* Effect.forkDetach(reconcileSessions(settings));
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
      readonly resolveGitHubToken?: Effect.Effect<string, SandboxRpcError>;
    },
  ) =>
    startSandboxSession(
      {
        busyInstances,
        getStore: getSessionStore,
        liveSessions,
        nameNamespace: sandboxNameNamespace,
        refreshLockedInstanceStatus,
        registerAndFinalizeSession,
        disposeAfterFailure,
        persistSessionRecord,
      },
      instanceId,
      settings,
      options,
    ),

  stopSession: (instanceId: SandboxProviderInstanceId, settings: ServerSettings) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      if (busyInstances.has(sessionKey)) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      busyInstances.add(sessionKey);
      return yield* Effect.gen(function* () {
        yield* refreshLockedInstanceStatus(sessionKey, settings);
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
        const lifecycle = live.driver.lifecycle;
        yield* lifecycle.stop(live.handle).pipe(
          Effect.timeout("30 seconds"),
          Effect.catchTag("TimeoutError", () =>
            Effect.fail(
              new SandboxProviderError({
                reason: "provision-failed",
                message: "Provider stop timed out.",
              }),
            ),
          ),
          Effect.mapError(mapDriverError),
        );
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
      if (busyInstances.has(sessionKey)) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      // Read from the store — works even when the client that started the
      // session is gone (AC-L9).
      const record = getSessionStore().records.find((r) => r.instanceId === sessionKey);
      if (record === undefined) {
        return { disposed: false, connectCleanup: "not-linked" as const };
      }
      busyInstances.add(sessionKey);
      return yield* Effect.gen(function* () {
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
        // Provider deletion and Connect cleanup are reported independently.
        // Bound the unlink so relay degradation cannot hang lifecycle RPCs.
        const connectUnlinked = yield* unlinkSandboxFromRelay(record);
        // Remove the store record.
        yield* removeSessionRecord(instanceId);
        liveSessions.delete(sessionKey);
        return {
          disposed: true,
          environmentId: record.sandboxEnvironmentId,
          connectCleanup:
            record.relay === undefined
              ? ("not-linked" as const)
              : connectUnlinked
                ? ("unlinked" as const)
                : ("pending" as const),
        };
      }).pipe(Effect.ensuring(Effect.sync(() => busyInstances.delete(sessionKey))));
    }),

  renewSession: (instanceId: SandboxProviderInstanceId, input?: { readonly extendMs?: number }) =>
    Effect.gen(function* () {
      const sessionKey = instanceId as string;
      if (busyInstances.has(sessionKey)) {
        return yield* new SandboxRpcError({
          reason: "provision-failed",
          message: "An operation is already in progress for this sandbox environment.",
        });
      }
      const record = getSessionStore().records.find((r) => r.instanceId === sessionKey);
      if (record === undefined || record.status !== "running") {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "No running sandbox session to renew.",
        });
      }
      const live = liveSessions.get(sessionKey);
      const renewTimeout = live?.driver.renewTimeout;
      if (live === undefined || renewTimeout === undefined) {
        return yield* new SandboxRpcError({
          reason: "not-running",
          message: "This sandbox driver does not support timeout renewal.",
        });
      }
      busyInstances.add(sessionKey);
      return yield* Effect.gen(function* () {
        const extendMs = input?.extendMs ?? resolveSandboxTimeoutMs(live.instanceConfig.config);
        yield* renewTimeout
          .renewTimeout(live.handle, extendMs)
          .pipe(Effect.mapError(mapDriverError));
        // Re-check after the provider call so a concurrent dispose cannot be
        // resurrected by writing the stale running record back.
        const current = getSessionStore().records.find((r) => r.instanceId === sessionKey);
        if (current === undefined || current.status !== "running") {
          return yield* new SandboxRpcError({
            reason: "not-running",
            message: "Sandbox session was stopped or deleted during renew.",
          });
        }
        // @effect-diagnostics-next-line globalDateInEffect:off - host-side deadline arithmetic.
        const deadline = Date.now() + extendMs;
        yield* getSessionStore()
          .upsert({ ...current, deadlineEpochMs: deadline })
          .pipe(
            Effect.catch((error: unknown) =>
              Effect.logError("Sandbox session store write failed during renew", {
                instanceId: sessionKey,
                message: error instanceof Error ? error.message : String(error),
              }),
            ),
          );
        return { instanceId, deadlineEpochMs: deadline };
      }).pipe(Effect.ensuring(Effect.sync(() => busyInstances.delete(sessionKey))));
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
