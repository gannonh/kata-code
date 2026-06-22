import { describe, expect, it } from "vitest";

import { E2E_TIMEOUTS } from "./timeouts.ts";

describe("E2E_TIMEOUTS", () => {
  it("uses bounded defaults for local headed runs", () => {
    expect(E2E_TIMEOUTS.devStackMs).toBeLessThanOrEqual(60_000);
    expect(E2E_TIMEOUTS.electronWindowMs).toBeLessThanOrEqual(60_000);
    expect(E2E_TIMEOUTS.testMs).toBeLessThanOrEqual(180_000);
    expect(E2E_TIMEOUTS.authMs).toBeLessThanOrEqual(60_000);
  });
});
