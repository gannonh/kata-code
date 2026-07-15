import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";

/** Assert sidebar v2 chrome is mounted (attention-tier list, not project groups). */
export async function expectSidebarV2Chrome(page: Page): Promise<void> {
  await expect(page.getByTestId("sidebar-v2-list")).toBeVisible({
    timeout: E2E_TIMEOUTS.assertionMs,
  });
  await expect(page.getByTestId("sidebar-project-picker")).toBeVisible();
  await expect(page.getByTestId("new-thread-button")).toBeVisible();
  await expect(page.getByTestId("command-palette-trigger")).toBeVisible();
  await expect(page.getByText("show more", { exact: false })).toHaveCount(0);
}

/** Open the new-session accordion from global +. */
export async function openNewSessionPanel(page: Page): Promise<void> {
  await page.getByTestId("new-thread-button").click();
  await expect(page.getByTestId("sidebar-new-session-panel")).toBeVisible({
    timeout: E2E_TIMEOUTS.assertionMs,
  });
}
