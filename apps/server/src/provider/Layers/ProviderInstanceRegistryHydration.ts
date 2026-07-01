/**
 * ProviderInstanceRegistryHydration — derive a `ProviderInstanceConfigMap`
 * from `ServerSettings` and keep `ProviderInstanceRegistry` in sync with it.
 *
 * The server still reads two shapes:
 *
 *   1. `settings.providerInstances` — the new driver-agnostic map the
 *      registry expects. Keyed by `ProviderInstanceId`, values are
 *      `ProviderInstanceConfig` envelopes.
 *   2. `settings.providers.<kind>` — the legacy single-instance-per-driver
 *      fields (`providers.codex`, `providers.claudeAgent`, …). These are
 *      the source of truth for every deployment that hasn't been migrated
 *      yet to an explicit `providerInstances` entry.
 *
 * This module bridges (2) into (1) and wires the resulting map into a
 * mutable registry. For every built-in driver whose id is not already
 * present in `providerInstances` (keyed on
 * `defaultInstanceIdForDriver(driverKind)` — literally the driver kind as a
 * routing slug), we synthesize an envelope from the legacy field. The
 * registry decodes both flavours through the same `configSchema` and ends
 * up with one uniform `ProviderInstance` per entry.
 *
 * Explicit `providerInstances` entries always win — users can already
 * override the legacy `providers.<kind>` blob by authoring a
 * `providerInstances.codex` entry with a matching driver, and we don't
 * want the synthesized envelope to silently stomp their config.
 *
 * Hot-reload
 * ----------
 * On layer build we:
 *   1. Read the current `ServerSettings` once and use it to seed the
 *      registry's initial state via `ProviderInstanceRegistryMutableLayer`.
 *   2. Fork a daemon fiber (lifetime tied to the layer's scope) that
 *      subscribes to `ServerSettingsService.streamChanges` and calls
 *      `ProviderInstanceRegistryMutator.reconcile` on every emission.
 *
 * Failures inside the watcher are logged and swallowed so a single bad
 * settings emission cannot kill the registry. Unknown drivers and invalid
 * configs already round-trip through the registry's own "unavailable"
 * shadow bucket.
 *
 * @module provider/Layers/ProviderInstanceRegistryHydration
 */
import {
  defaultInstanceIdForDriver,
  type ProviderInstanceConfig,
  type ProviderInstanceConfigMap,
  ServerSettings,
} from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import { ServerSettingsService, type ServerSettingsShape } from "../../serverSettings.ts";
import { BUILT_IN_DRIVERS, type BuiltInDriversEnv } from "../builtInDrivers.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderInstanceRegistryMutator,
  type ProviderInstanceRegistryMutatorShape,
} from "../Services/ProviderInstanceRegistryMutator.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";

/**
 * Synthesize a `ProviderInstanceConfigMap` from a `ServerSettings` snapshot.
 *
 * Strategy:
 *   1. Copy all explicit `settings.providerInstances` entries verbatim.
 *   2. For each built-in driver whose `defaultInstanceIdForDriver(id)` key
 *      is *not* already in the explicit map, synthesize an entry from the
 *      matching legacy `settings.providers.<kind>` blob.
 *
 * The returned map is the input the registry consumes; pure & exported
 * separately so the hydration logic can be exercised by unit tests
 * without layering.
 */
export const deriveProviderInstanceConfigMap = (
  settings: ServerSettings,
): ProviderInstanceConfigMap => {
  const merged: Record<string, ProviderInstanceConfig> = { ...settings.providerInstances };

  for (const driver of BUILT_IN_DRIVERS) {
    const instanceId = defaultInstanceIdForDriver(driver.driverKind);
    if (instanceId in merged) {
      // Explicit `providerInstances` entry for this slot — user-authored
      // config always wins over the legacy mirror.
      continue;
    }

    // Only built-in drivers have a legacy mirror; the registry's
    // `providers` struct is keyed on the same literal slug as
    // `driverKind`. Access is dynamic (the driver kind is a branded string),
    // but it's constrained to `keyof settings.providers` by the union of
    // built-in driver kinds.
    const legacyKey = driver.driverKind as keyof ServerSettings["providers"];
    const legacyConfig = settings.providers[legacyKey];
    if (legacyConfig === undefined) {
      continue;
    }

    merged[instanceId] = {
      driver: driver.driverKind,
      config: legacyConfig,
    };
  }

  return merged as ProviderInstanceConfigMap;
};

const forkSettingsWatcher = (
  serverSettings: ServerSettingsShape,
  mutator: ProviderInstanceRegistryMutatorShape,
) =>
  Effect.gen(function* () {
    const reconcileSettings = (next: ServerSettings) =>
      mutator
        .reconcile(deriveProviderInstanceConfigMap(next))
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logError("ProviderInstanceRegistry reconcile failed", cause),
          ),
        );

    if (serverSettings.subscribeChanges) {
      const settingsChanges = yield* serverSettings.subscribeChanges;
      yield* PubSub.take(settingsChanges).pipe(
        Effect.flatMap(reconcileSettings),
        Effect.forever,
        Effect.forkScoped,
      );
      return;
    }

    yield* serverSettings.streamChanges.pipe(
      Stream.runForEach((next) => reconcileSettings(next)),
      Effect.forkScoped,
    );
  });

/**
 * Hydrate `ProviderInstanceRegistry` from `ServerSettings` and keep it in
 * sync with subsequent `streamChanges` emissions.
 *
 * The registry and watcher are built in one layer effect so the watcher
 * always reconciles the same mutable registry instance exposed to readers.
 */
export const ProviderInstanceRegistryHydrationLive: Layer.Layer<
  ProviderInstanceRegistry,
  never,
  BuiltInDriversEnv | ServerSettingsService
> = Layer.effectContext(
  Effect.gen(function* () {
    const serverSettings = yield* ServerSettingsService;
    const initialSettings: ServerSettings | undefined = yield* serverSettings.getSettings.pipe(
      Effect.orElseSucceed(() => undefined),
    );
    const initialConfigMap =
      initialSettings === undefined
        ? ({} as ProviderInstanceConfigMap)
        : deriveProviderInstanceConfigMap(initialSettings);

    const built = yield* makeProviderInstanceRegistry({
      drivers: BUILT_IN_DRIVERS,
      configMap: initialConfigMap,
    });
    yield* forkSettingsWatcher(serverSettings, built.mutator);

    return Context.make(ProviderInstanceRegistry, built.registry).pipe(
      Context.add(ProviderInstanceRegistryMutator, built.mutator),
    );
  }),
) as Layer.Layer<ProviderInstanceRegistry, never, BuiltInDriversEnv | ServerSettingsService>;
