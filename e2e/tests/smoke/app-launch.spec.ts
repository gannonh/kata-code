import { assertNoFatalLaunchErrors } from "../../src/assertions/appAssertions.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { test, expect } from "../../src/harness/testFixtures.ts";

test.describe(`App launch ${E2E_TAGS.smoke}`, () => {
  test("launches Electron past pairing and reaches the app shell", async ({
    launchedApp,
    appWindow,
  }) => {
    await expect(appWindow.getByTestId("command-palette-trigger")).toBeVisible();
    assertNoFatalLaunchErrors(launchedApp.readFatalErrors());
  });
});
