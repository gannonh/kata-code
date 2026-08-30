import { describe, expect, it } from "@effect/vitest";
import { SandboxProviderProfileId } from "@kata-sh/code-kata-sandbox-contracts/domain";
import * as Effect from "effect/Effect";

import type { SandboxProviderDriver } from "./driver.ts";
import { SandboxProviderRegistry } from "./registry.ts";

const driver = {
  kind: "docker" as const,
  validateProfile: () => Effect.never,
  allocate: () => Effect.never,
  identify: () => Effect.never,
  observe: () => Effect.never,
  delete: () => Effect.never,
} satisfies SandboxProviderDriver;

const profileId = SandboxProviderProfileId.make("profile-1");

describe("SandboxProviderRegistry", () => {
  it("keeps disabled profiles visible without resolving a driver", () => {
    const registry = new SandboxProviderRegistry();
    registry.register(driver);

    expect(registry.resolve({ profileId, driverKind: "docker", enabled: false })).toEqual({
      kind: "unavailable",
      profileId,
      reason: "disabled",
    });
  });

  it("keeps unknown drivers visible as unavailable", () => {
    const registry = new SandboxProviderRegistry();

    expect(registry.resolve({ profileId, driverKind: "future", enabled: true })).toEqual({
      kind: "unavailable",
      profileId,
      reason: "unknown-driver",
    });
  });

  it("returns the registered driver for an enabled profile", () => {
    const registry = new SandboxProviderRegistry();
    registry.register(driver);

    expect(registry.resolve({ profileId, driverKind: "docker", enabled: true })).toEqual({
      kind: "available",
      profileId,
      driver,
    });
  });
});
