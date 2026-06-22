import type { Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";

const MAX_TOAST_DISMISS_ATTEMPTS = 8;

export async function dismissBlockingToasts(page: Page): Promise<void> {
  const closeButtons = page.locator('[data-slot="toast-close"]');
  for (let attempt = 0; attempt < MAX_TOAST_DISMISS_ATTEMPTS; attempt += 1) {
    const first = closeButtons.first();
    if (!(await first.isVisible().catch(() => false))) {
      return;
    }

    await first.click().catch(() => undefined);
  }
}

export async function openCommandPalette(page: Page): Promise<void> {
  const trigger = page.getByTestId("command-palette-trigger");
  if (await trigger.isVisible().catch(() => false)) {
    await trigger.click();
    await page
      .getByTestId("command-palette")
      .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
    return;
  }

  await page.keyboard.press("Meta+K");
  await page
    .getByTestId("command-palette")
    .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
}
