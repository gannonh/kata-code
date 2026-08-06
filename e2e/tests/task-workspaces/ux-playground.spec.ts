import { assertNoFatalLaunchErrors } from "../../src/assertions/appAssertions.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { openTaskModePlayground } from "../../src/flows/taskModePlayground.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

test.describe(`Task mode UX Playground ${E2E_TAGS.taskModeUx}`, () => {
  test("validates Prototype A history, revision, and narrow navigation", async ({
    appPage,
    appTarget,
    launchedApp,
    launchTarget,
  }) => {
    test.skip(launchTarget !== "dev", "The Playground is intentionally available only in dev.");

    await appPage.setViewportSize({ width: 1_280, height: 720 });
    await openTaskModePlayground(appPage, appTarget);

    await expect(appPage.getByTestId("task-mode-current-layout-panel")).toBeVisible();
    await expect(appPage.getByLabel("Message Design")).toBeVisible();

    await appPage.getByLabel("Scenario").selectOption("branch-history");
    await expect(appPage.getByText("Viewing Design v2")).toBeVisible();
    await appPage.getByTestId("task-mode-open-branch").click();
    await expect(appPage.getByTestId("task-mode-branch-dialog")).toContainText("Plan v1");
    await appPage.getByTestId("task-mode-confirm-branch").click();

    await appPage.getByTestId("task-mode-occurrence-select").selectOption("design-v2");
    await expect(appPage.getByText("Design v2 · historical stage", { exact: true })).toBeVisible();
    await appPage.getByTestId("task-mode-stage-plan").click();
    await expect(appPage.getByText("Plan v1 · historical stage", { exact: true })).toBeVisible();

    await appPage.setViewportSize({ width: 390, height: 844 });
    await appPage.getByTestId("task-mode-mobile-navigation-trigger").click();
    await expect(appPage.getByTestId("task-mode-mobile-navigation")).toBeVisible();
    await expect(appPage.getByTestId("task-mode-prototype-task-row").last()).toBeVisible();
    await appPage.getByRole("button", { name: "Close" }).click();
    await appPage.getByRole("link", { name: "← Playground" }).click();
    await expect(appPage.getByTestId("playground-experiment-list")).toBeVisible();

    assertNoFatalLaunchErrors(launchedApp.readFatalErrors());
  });
});
