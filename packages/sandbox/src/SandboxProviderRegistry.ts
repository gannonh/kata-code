/**
 * `SandboxProviderRegistry` — materializes sandbox deployment targets from
 * `ServerSettings.sandboxProviderInstances` plus registered drivers, downgrading
 * unknown drivers gracefully (mirrors `ProviderInstanceRegistry` and the
 * contract invariant). Pure resolution over config + driver set in Phase 1
 * (no process/resource lifecycle).
 *
 * @module SandboxProviderRegistry
 */
import {
  type SandboxProviderDriverKind,
  type SandboxProviderInstanceId,
  type SandboxProviderInstanceConfig,
  type SandboxProviderInstanceConfigMap,
} from "@kata-sh/code-sandbox-contracts/instance";

import {
  type SandboxProvider,
  SandboxProviderError,
  type SandboxProviderConfigDecoder,
} from "./SandboxProviderDriver.ts";

/** Why a configured instance is unavailable. */
export type SandboxInstanceUnavailableReason = "unknown-driver" | "disabled" | "invalid-config";

/** A materialized instance: either available (driver + decoded config) or unavailable (reason). */
export type MaterializedSandboxInstance =
  | {
      readonly kind: "available";
      readonly instanceId: SandboxProviderInstanceId;
      readonly driver: SandboxProvider;
      readonly config: unknown;
    }
  | {
      readonly kind: "unavailable";
      readonly instanceId: SandboxProviderInstanceId;
      readonly reason: SandboxInstanceUnavailableReason;
      readonly message: string;
    };

/** Internal per-driver registration: the provider plus its config decoder. */
interface DriverRegistration {
  readonly provider: SandboxProvider;
  readonly configDecoder: SandboxProviderConfigDecoder<unknown> | undefined;
}

/**
 * Build a registry from a config map. Drivers are added with `register` before
 * `materialize` is called; an instance whose `driver` slug has no registered
 * provider is `unavailable` with reason `unknown-driver` (never throws).
 */
export class SandboxProviderRegistry {
  private readonly drivers = new Map<string, DriverRegistration>();

  register(provider: SandboxProvider, configDecoder?: SandboxProviderConfigDecoder<unknown>): void {
    const key = provider.kind as string;
    if (this.drivers.has(key)) {
      throw new Error(`SandboxProviderRegistry: driver already registered for kind "${key}"`);
    }
    this.drivers.set(key, { provider, configDecoder });
  }

  /** True if a driver is registered for `kind`. */
  hasDriver(kind: SandboxProviderDriverKind): boolean {
    return this.drivers.has(kind as string);
  }

  /** Materialize a single instance by id, or an `unavailable` marker. */
  materializeOne(
    instanceId: SandboxProviderInstanceId,
    config: SandboxProviderInstanceConfig,
  ): MaterializedSandboxInstance {
    if (config.enabled === false) {
      return {
        kind: "unavailable",
        instanceId,
        reason: "disabled",
        message: `Sandbox instance "${instanceId as string}" is disabled.`,
      };
    }
    const registration = this.drivers.get(config.driver as string);
    if (registration === undefined) {
      return {
        kind: "unavailable",
        instanceId,
        reason: "unknown-driver",
        message: `No sandbox driver registered for kind "${config.driver as string}".`,
      };
    }
    if (registration.configDecoder !== undefined && config.config !== undefined) {
      try {
        const decoded = registration.configDecoder(config.config);
        return {
          kind: "available",
          instanceId,
          driver: registration.provider,
          config: decoded,
        };
      } catch (error) {
        return {
          kind: "unavailable",
          instanceId,
          reason: "invalid-config",
          message: `Invalid config for sandbox instance "${instanceId as string}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
    }
    return {
      kind: "available",
      instanceId,
      driver: registration.provider,
      config: config.config,
    };
  }

  /** Materialize every instance in the map (available + unavailable). */
  materialize(map: SandboxProviderInstanceConfigMap): ReadonlyArray<MaterializedSandboxInstance> {
    return Object.entries(map).map(([instanceId, config]) =>
      this.materializeOne(instanceId as SandboxProviderInstanceId, config),
    );
  }

  /** Get a single materialized instance, or an `unavailable` marker if absent. */
  get(
    map: SandboxProviderInstanceConfigMap,
    instanceId: SandboxProviderInstanceId,
  ): MaterializedSandboxInstance | undefined {
    const config = map[instanceId as SandboxProviderInstanceId];
    if (config === undefined) return undefined;
    return this.materializeOne(instanceId, config);
  }

  /** All materialized instances (available + unavailable) for UI/diagnostics. */
  list(map: SandboxProviderInstanceConfigMap): ReadonlyArray<MaterializedSandboxInstance> {
    return this.materialize(map);
  }
}

export { SandboxProviderError };
