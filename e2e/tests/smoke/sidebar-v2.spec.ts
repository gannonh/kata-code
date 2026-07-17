import { mkdir } from "node:fs/promises";
import path from "node:path";

import { assertNoFatalLaunchErrors } from "../../src/assertions/appAssertions.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { expectSidebarV2Chrome, openNewSessionPanel } from "../../src/flows/sidebar.ts";
import { createOrOpenProject, createSeededWorkspace } from "../../src/flows/workspace.ts";
import { test, expect } from "../../src/harness/testFixtures.ts";

const UAT_SCREENSHOT_DIR = process.env.UAT_EVIDENCE_DIR
  ? path.join(process.env.UAT_EVIDENCE_DIR, "screenshots")
  : null;

test.describe(`Sidebar v2 ${E2E_TAGS.sidebar}`, () => {
  test("shows attention-tier chrome without project group show-more", async ({
    launchedApp,
    authenticatedAppWindow,
    runContext,
  }) => {
    const seededPath = await createSeededWorkspace(runContext, "sidebar-v2-smoke");
    await createOrOpenProject(authenticatedAppWindow, seededPath);

    await expectSidebarV2Chrome(authenticatedAppWindow);
    if (UAT_SCREENSHOT_DIR) {
      await mkdir(UAT_SCREENSHOT_DIR, { recursive: true });
      await authenticatedAppWindow.screenshot({
        path: path.join(UAT_SCREENSHOT_DIR, "02-app-sidebar-v2-chrome.png"),
      });
    }

    await openNewSessionPanel(authenticatedAppWindow);
    await expect(
      authenticatedAppWindow.getByTestId("sidebar-new-session-panel").getByText("New session"),
    ).toBeVisible();
    if (UAT_SCREENSHOT_DIR) {
      await authenticatedAppWindow.screenshot({
        path: path.join(UAT_SCREENSHOT_DIR, "03-app-new-session-accordion.png"),
      });
    }
    await authenticatedAppWindow.getByTestId("sidebar-new-session-close").click();
    await expect(authenticatedAppWindow.getByTestId("sidebar-new-session-panel")).toHaveCount(0);

    assertNoFatalLaunchErrors(launchedApp.readFatalErrors());
  });
});
