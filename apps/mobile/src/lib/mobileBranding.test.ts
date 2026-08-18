import { describe, expect, it } from "vite-plus/test";

import { resolveMobileDisplayName, resolveMobileStageLabel } from "./mobileBranding";

describe("resolveMobileStageLabel", () => {
  it.each([
    ["development", "Dev"],
    ["preview", "Nightly"],
    ["production", "Alpha"],
    [undefined, "Alpha"],
  ])("maps %s builds to %s", (appVariant, expected) => {
    expect(resolveMobileStageLabel(appVariant)).toBe(expected);
  });

  it("formats Kata Code display names from the shared table", () => {
    expect(resolveMobileDisplayName("development")).toBe("Kata Code (Dev)");
    expect(resolveMobileDisplayName("production")).toBe("Kata Code (Alpha)");
  });
});
