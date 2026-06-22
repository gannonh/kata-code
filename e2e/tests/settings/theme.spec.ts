import { E2E_TAGS } from "../../src/config/tags.ts";
import { expectResolvedTheme, openSettings, setTheme } from "../../src/flows/settings.ts";
import { test } from "../../src/harness/testFixtures.ts";

test.describe(`Settings theme ${E2E_TAGS.settings}`, () => {
  test("persists dark theme after reload", async ({ authenticatedAppWindow }) => {
    await openSettings(authenticatedAppWindow);
    await setTheme(authenticatedAppWindow, "dark");
    await authenticatedAppWindow.reload();
    await openSettings(authenticatedAppWindow);
    await expectResolvedTheme(authenticatedAppWindow, "dark");
  });
});
