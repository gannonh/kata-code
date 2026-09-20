import { describe, expect, it } from "vite-plus/test";

import { getMobileThemeRuntimeVariables } from "./mobileThemeVariables";
import type { MaterialYouPalette } from "./materialYouPalette";
import { materialYouPaletteToMobileThemeVariables } from "./materialYouTheme";

const palette: MaterialYouPalette = {
  primary: "#6750A4FF",
  onPrimary: "#FFFFFFFF",
  primaryContainer: "#EADDFFFF",
  onPrimaryContainer: "#21005DFF",
  inversePrimary: "#D0BCFFFF",
  secondaryContainer: "#E8DEF8FF",
  onSecondaryContainer: "#1D192BFF",
  tertiary: "#7D5260FF",
  tertiaryContainer: "#FFD8E4FF",
  onTertiaryContainer: "#31111DFF",
  surface: "#FFFBFEFF",
  onSurface: "#1C1B1FFF",
  onSurfaceVariant: "#49454FFF",
  surfaceContainer: "#F3EDF7FF",
  surfaceContainerHigh: "#ECE6F0FF",
  surfaceContainerHighest: "#E6E0E9FF",
  surfaceContainerLow: "#F7F2FAFF",
  surfaceContainerLowest: "#FFFFFFFF",
  errorContainer: "#F9DEDCFF",
  onErrorContainer: "#410E0BFF",
  outline: "#79747EFF",
  outlineVariant: "#CAC4D0FF",
  scrim: "#000000FF",
};

describe("Material You system colors", () => {
  it.each(["light", "dark"] as const)(
    "uses the system surface for the Android frame in %s",
    (appearance) => {
      const variables = materialYouPaletteToMobileThemeVariables(
        palette,
        appearance,
        getMobileThemeRuntimeVariables("material-you", appearance, "android"),
      );
      // The Android runtime frame now overrides the Material You system surface
      // for the header; the system palette still drives the body surfaces.
      expect(variables["--color-header"]).toBe(
        getMobileThemeRuntimeVariables("material-you", appearance, "android")["--color-header"],
      );
      expect(variables["--color-header"]).not.toBe(palette.surfaceContainerHigh);
    },
  );
});
