/**
 * Sandbox session reconcile + discovery against provider lifecycle.status.
 *
 * @module sandboxReconcile
 */
import * as Effect from "effect/Effect";

import type { AdvertisedEndpoint, ServerSettings } from "@kata-sh/code-contracts";
import {
  type SandboxProviderInstanceConfigMap,
  SandboxProviderInstanceId,
} from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";
import {
  SandboxProviderError,
  type SandboxHandle,
  type SandboxReachability,
} from "@kata-sh/code-sandbox/driver";
import { SandboxProviderRegistry } from "@kata-sh/code-sandbox/registry";
import { VERCEL_KIND } from "@kata-sh/code-sandbox-vercel";
import { createAdvertisedEndpoint } from "@kata-sh/code-shared/advertisedEndpoint";

import type { SandboxSessionRecord, SandboxSessionStore } from "./sandboxSessionStore.ts";
import type { LiveSession } from "./sandboxSessionTypes.ts";
import {
  resolveInstanceEnvelope,
  resolveSandboxPort,
  reinjectVercelAuth,
  sanitizeHandleForStore,
  SANDBOX_ENDPOINT_PROVIDER,
  VERCEL_ENDPOINT_PROVIDER,
} from "./sandboxSessionHelpers.ts";

/** Reconcile stored records against the providers. For each stored record:
 *  re-resolve config from settings, find the driver, call `lifecycle.status`;
 *  update the stored status, evict `gone` records, keep `stopped`/`running`.
 *  Reconcile failures keep the last-known status and set `statusDetail`.
 *  Pure/testable: takes the store, registry, settings, and the liveSessions
 *  cache to populate; returns the updated records (also persisted). */
export function reconcileStoredRecords<R = never>(input: {
  readonly store: SandboxSessionStore;
  readonly registry: SandboxProviderRegistry;
  readonly settings: ServerSettings;
  readonly liveSessions: Map<string, LiveSession>;
  /** Best-effort relay unlink for records evicted as `gone` (identity
   *  recovery R3). Log-only failure; absent in unit tests. */
  readonly unlinkRelay?: (record: SandboxSessionRecord) => Effect.Effect<void, never, R>;
}): Effect.Effect<ReadonlyArray<SandboxSessionRecord>, never, R> {
  return Effect.gen(function* () {
    const records = yield* input.store
      .load()
      .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<SandboxSessionRecord>));
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
            // R3: best-effort relay unlink so the evicted sandbox does not
            // linger in the Connect pool as a dead relay row.
            if (input.unlinkRelay !== undefined && record.relay !== undefined) {
              yield* input.unlinkRelay(record);
            }
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

/** Discover provider-side sandboxes for configured instances that have no store
 *  record. For each such instance whose driver supports `lifecycle.discover`,
 *  probe the provider; when a sandbox exists, persist a record + cache the live
 *  session so the UI shows the correct state-driven actions. */
export function discoverUntrackedSessions(input: {
  readonly store: SandboxSessionStore;
  readonly registry: SandboxProviderRegistry;
  readonly settings: ServerSettings;
  readonly liveSessions: Map<string, LiveSession>;
  /** Server environment id — scopes Vercel sandbox names across Kata servers. */
  readonly nameNamespace?: string;
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
          ...(input.nameNamespace !== undefined ? { nameNamespace: input.nameNamespace } : {}),
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
        .pipe(Effect.orElseSucceed(() => null as SandboxReachability | null));
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
