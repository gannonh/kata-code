import { describe, expect, it } from "vite-plus/test";

import { isEnabledFeatureFlag } from "./featureFlags";

describe("isEnabledFeatureFlag", () => {
  it("defaults to disabled", () => {
    expect(isEnabledFeatureFlag(undefined)).toBe(false);
    expect(isEnabledFeatureFlag("0")).toBe(false);
  });

  it("enables only the explicit value 1", () => {
    expect(isEnabledFeatureFlag("1")).toBe(true);
    expect(isEnabledFeatureFlag("true")).toBe(false);
  });
});
