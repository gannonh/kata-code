import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_MOBILE_THEME_ID, MOBILE_THEME_IDS } from "./mobileTheme";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

const OPAQUE = /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, 1\))$/i;

describe("mobile theme runtime variables", () => {
  it.each(MOBILE_THEME_IDS)("keeps %s frame surfaces opaque on Android", (themeId) => {
    for (const appearance of ["light", "dark"] as const) {
      const ios = getMobileThemeRuntimeVariables(themeId, appearance, "ios");
      const android = getMobileThemeRuntimeVariables(themeId, appearance, "android");

      expect(android["--color-header"]).toMatch(OPAQUE);
      expect(android["--color-drawer"]).toMatch(OPAQUE);
      // Only frame surfaces may differ between the two platforms.
      const changed = (Object.keys(ios) as Array<keyof typeof ios>).filter(
        (key) => ios[key] !== android[key],
      );
      expect(
        changed.every(
          (key) => key.startsWith("--color-header") || key.startsWith("--color-drawer"),
        ),
      ).toBe(true);
    }
  });

  it.each([DEFAULT_MOBILE_THEME_ID, "material-you"] as const)(
    "keeps the %s default dark frame distinct from the rounded settings body",
    (themeId) => {
      const variables = getMobileThemeRuntimeVariables(themeId, "dark", "android");
      expect(variables["--color-header"]).toBe("rgba(20, 20, 20, 1)");
      expect(variables["--color-header"]).not.toBe(variables["--color-sheet-solid"]);
    },
  );
});
