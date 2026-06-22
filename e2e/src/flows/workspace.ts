import type { Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import type { E2ERunContext } from "../harness/isolatedRun.ts";
import { seedWorkspace } from "../harness/seededWorkspace.ts";
import { openCommandPalette } from "./navigation.ts";

const ADD_PROJECT_SUBMENU_PLACEHOLDER = "Enter path (e.g. ~/projects/my-app)";

export async function createSeededWorkspace(context: E2ERunContext, name: string): Promise<string> {
  return seedWorkspace({
    name,
    root: context.workspaceRoot,
    files: {
      "package.json": '{"name":"e2e-seeded-workspace","scripts":{"test":"echo ok"}}',
      "README.md": "# E2E seeded workspace\n",
    },
  });
}

export async function createOrOpenProject(page: Page, workspacePath: string): Promise<void> {
  await openCommandPalette(page);
  const palette = page.getByTestId("command-palette");
  await palette.getByText("Add project", { exact: true }).click();
  await palette.getByText("Local folder", { exact: true }).click();
  await page.getByPlaceholder(ADD_PROJECT_SUBMENU_PLACEHOLDER).fill(workspacePath);
  await page.getByRole("button", { name: "Add (Enter)" }).click();
  await page
    .getByTestId("composer-editor")
    .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
}
