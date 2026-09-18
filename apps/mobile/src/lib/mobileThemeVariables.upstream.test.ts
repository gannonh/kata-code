import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_MOBILE_THEME_ID, MOBILE_THEME_IDS, themeColorWithAlpha } from "./mobileTheme";
import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";

describe("mobile theme runtime variables", () => {
  it.each(MOBILE_THEME_IDS)(
    "keeps %s colors on Android with an opaque Material frame",
    (themeId) => {
      for (const appearance of ["light", "dark"] as const) {
        const ios = getMobileThemeRuntimeVariables(themeId, appearance, "ios");
        const android = getMobileThemeRuntimeVariables(themeId, appearance, "android");
        expect(android).toEqual({
          ...ios,
          "--color-header": themeColorWithAlpha(
            ios[
              themeId === DEFAULT_MOBILE_THEME_ID || themeId === "material-you"
                ? "--color-card"
                : "--color-drawer"
            ],
            1,
          ),
        });
        expect(android["--color-header"]).toMatch(/^rgba\(\d+, \d+, \d+, 1\)$/);
      }
    },
  );

  it.each([DEFAULT_MOBILE_THEME_ID, "material-you"] as const)(
    "keeps the %s default dark frame distinct from the rounded settings body",
    (themeId) => {
      const variables = getMobileThemeRuntimeVariables(themeId, "dark", "android");
      expect(variables["--color-header"]).toBe("rgba(23, 23, 23, 1)");
      expect(variables["--color-header"]).not.toBe(
        themeColorWithAlpha(variables["--color-sheet-solid"], 1),
      );
    },
  );
});
