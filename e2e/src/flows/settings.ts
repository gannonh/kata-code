import { expect, type Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { dismissBlockingToasts } from "./navigation.ts";

export type ThemePreference = "system" | "light" | "dark";

const THEME_OPTION_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export async function openSettings(page: Page): Promise<void> {
  const themePreference = page.getByLabel("Theme preference");
  if (await themePreference.isVisible().catch(() => false)) {
    return;
  }

  // On the /settings route the thread-sidebar footer "Settings" menu-button is not
  // rendered (SettingsSidebarNav replaces it), so the click below would never resolve.
  // After a reload the Theme control is still hydrating, so wait for it directly.
  if (page.url().includes("/settings")) {
    await themePreference.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.authMs });
    return;
  }

  await page.locator('[data-sidebar="menu-button"]', { hasText: "Settings" }).click();
  await dismissBlockingToasts(page);
  await themePreference.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.authMs });
}

export async function openProviderSettings(page: Page): Promise<void> {
  await openSettings(page);
  await page.getByRole("button", { name: "Providers" }).click();
  await expect(page.getByRole("heading", { name: "Providers" })).toBeVisible({
    timeout: E2E_TIMEOUTS.authMs,
  });
}

export async function setTheme(page: Page, theme: ThemePreference): Promise<void> {
  await dismissBlockingToasts(page);
  const trigger = page.getByLabel("Theme preference");
  await trigger.click();
  const label = THEME_OPTION_LABELS[theme];
  await page.getByRole("option", { name: label }).click();

  if (theme === "dark") {
    await expectResolvedTheme(page, "dark");
    return;
  }

  if (theme === "light") {
    await expectResolvedTheme(page, "light");
  }
}

export async function expectResolvedTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  if (theme === "dark") {
    await expect(page.locator("html")).toHaveClass(/dark/);
    return;
  }

  await expect(page.locator("html")).not.toHaveClass(/dark/);
}
