import { describe, expect, it } from "vitest";

describe("waitForAppEnvironmentReady", () => {
  it("is exported from the pairing flow module", async () => {
    const { waitForAppEnvironmentReady } = await import("./pairing.ts");
    expect(waitForAppEnvironmentReady).toBeTypeOf("function");
  });
});
