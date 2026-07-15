import { assertNoFatalLaunchErrors } from "../../src/assertions/appAssertions.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { expectSidebarV2Chrome, openNewSessionPanel } from "../../src/flows/sidebar.ts";
import { createOrOpenProject, createSeededWorkspace } from "../../src/flows/workspace.ts";
import { test, expect } from "../../src/harness/testFixtures.ts";

test.describe(`Sidebar v2 ${E2E_TAGS.sidebar}`, () => {
  test("shows attention-tier chrome without project group show-more", async ({
    launchedApp,
    authenticatedAppWindow,
    runContext,
  }) => {
    const seededPath = await createSeededWorkspace(runContext, "sidebar-v2-smoke");
    await createOrOpenProject(authenticatedAppWindow, seededPath);

    await expectSidebarV2Chrome(authenticatedAppWindow);
    await openNewSessionPanel(authenticatedAppWindow);
    await expect(
      authenticatedAppWindow.getByTestId("sidebar-new-session-panel").getByText("New session"),
    ).toBeVisible();
    await authenticatedAppWindow.getByTestId("sidebar-new-session-close").click();
    await expect(authenticatedAppWindow.getByTestId("sidebar-new-session-panel")).toHaveCount(0);

    assertNoFatalLaunchErrors(launchedApp.readFatalErrors());
  });
});
