import { E2E_TAGS } from "../../src/config/tags.ts";
import { createOrOpenProject, createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

test.describe(`Branch toolbar environment ${E2E_TAGS.smoke}`, () => {
  test("keeps a single environment separate from workspace selection", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    const workspacePath = await createSeededGitWorkspace(runContext, {
      name: "branch-toolbar-environment",
      remoteUrl: "https://github.com/example/branch-toolbar-environment.git",
      files: { "README.md": "# Branch toolbar environment\n" },
    });
    await createOrOpenProject(authenticatedAppWindow, workspacePath);

    const environment = authenticatedAppWindow.getByTestId("branch-toolbar-environment");
    await expect(environment).toBeVisible();
    await expect(environment).toContainText("This device");
    await expect(environment.locator(".lucide-monitor")).toBeVisible();
    await expect(environment).not.toHaveAttribute("role", "combobox");

    await expect(
      authenticatedAppWindow.getByText("Current checkout", { exact: true }),
    ).toBeVisible();
  });
});
