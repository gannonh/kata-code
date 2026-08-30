import type { SandboxProviderProfileId } from "@kata-sh/code-kata-sandbox-contracts/domain";
import type { SandboxProviderDriver } from "./driver.ts";

export type SandboxDriverAvailabilityReason = "unknown-driver" | "disabled";

export type SandboxDriverRegistration =
  | {
      readonly kind: "available";
      readonly profileId: SandboxProviderProfileId;
      readonly driver: SandboxProviderDriver;
    }
  | {
      readonly kind: "unavailable";
      readonly profileId: SandboxProviderProfileId;
      readonly reason: SandboxDriverAvailabilityReason;
    };

export class SandboxProviderRegistry {
  private readonly drivers = new Map<string, SandboxProviderDriver>();

  register(driver: SandboxProviderDriver): void {
    if (this.drivers.has(driver.kind)) {
      throw new Error(`Sandbox driver ${driver.kind} is already registered.`);
    }
    this.drivers.set(driver.kind, driver);
  }

  resolve(input: {
    readonly profileId: SandboxProviderProfileId;
    readonly driverKind: string;
    readonly enabled: boolean;
  }): SandboxDriverRegistration {
    if (!input.enabled) {
      return { kind: "unavailable", profileId: input.profileId, reason: "disabled" };
    }
    const driver = this.drivers.get(input.driverKind);
    return driver === undefined
      ? { kind: "unavailable", profileId: input.profileId, reason: "unknown-driver" }
      : { kind: "available", profileId: input.profileId, driver };
  }
}
