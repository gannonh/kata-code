import { expect, type Locator, type Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { dismissBlockingToasts } from "./navigation.ts";

export type ThemePreference = "system" | "light" | "dark";

const THEME_OPTION_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

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

export async function openConnectionsSettings(page: Page): Promise<void> {
  await openSettings(page);
  await page.getByRole("button", { name: "Connections" }).click();
  await expect(page.getByRole("heading", { name: "Environments", level: 2 })).toBeVisible({
    timeout: E2E_TIMEOUTS.authMs,
  });
  await expect(page.getByRole("button", { name: "Add environment" })).toBeVisible({
    timeout: E2E_TIMEOUTS.authMs,
  });
}

/** A single Environments deployment-target card, located by its display label. */
export function deploymentTargetCard(page: Page, label: string): Locator {
  const section = page
    .getByRole("heading", { name: "Environments", level: 2 })
    .locator("xpath=ancestor::section[1]");
  return section.locator("div.border-t").filter({
    has: page.getByRole("heading", { name: label, level: 3 }),
  });
}

/**
 * Open the Add Environment dialog and select a sandbox mode card. The dialog
 * replaced the legacy single "Add sandbox environment" button + driver select
 * with mode cards (Remote link / SSH / Docker container / Cloud Provider),
 * each revealing its own fields.
 */
async function openAddEnvironmentDialog(
  page: Page,
  mode: "Docker container" | "Cloud Provider",
): Promise<Locator> {
  await page.getByRole("button", { name: "Add environment" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Environment" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: mode }).click();
  return dialog;
}

/**
 * Add a Docker container sandbox environment and return its card. Image and
 * start command are set explicitly so the test does not depend on default
 * resolution under load.
 */
export async function addContainerEnvironment(page: Page, label: string): Promise<Locator> {
  const dialog = await openAddEnvironmentDialog(page, "Docker container");
  const labelInput = dialog.getByLabel("Label");
  await labelInput.fill(label);
  await labelInput.blur();
  const imageInput = dialog.getByLabel("Image");
  await imageInput.fill("katacode:local");
  await imageInput.blur();
  const commandInput = dialog.getByLabel("Start command");
  await commandInput.fill("katacode serve --port 13773");
  await commandInput.blur();
  await dialog.getByRole("button", { name: "Add environment", exact: true }).click();
  await expect(dialog).toBeHidden();

  const card = deploymentTargetCard(page, label);
  await expect(card).toBeVisible({ timeout: E2E_TIMEOUTS.authMs });
  await expect(card.getByText("docker", { exact: true })).toBeVisible();
  return card;
}

/**
 * Add a Vercel Sandbox (Cloud Provider) environment and return its card. The
 * dialog only captures the label; the Vercel auth trio and GitHub source are
 * configured on the expanded card.
 */
export async function addVercelEnvironment(page: Page, label: string): Promise<Locator> {
  const dialog = await openAddEnvironmentDialog(page, "Cloud Provider");
  const labelInput = dialog.getByLabel("Label");
  await labelInput.fill(label);
  await labelInput.blur();
  await dialog.getByRole("button", { name: "Add environment", exact: true }).click();
  await expect(dialog).toBeHidden();

  const card = deploymentTargetCard(page, label);
  await expect(card).toBeVisible({ timeout: E2E_TIMEOUTS.authMs });
  await expect(card.getByText("vercel", { exact: true })).toBeVisible();
  return card;
}

/**
 * Select a GitHub repository and branch in the expanded sandbox card's source
 * picker (Docker and Vercel). Both are searchable comboboxes backed by the host
 * `gh` session. When `branch` is omitted the repository's default branch
 * (auto-selected on repo choice) is kept.
 */
export async function selectSandboxGitHubSource(
  page: Page,
  card: Locator,
  input: { readonly repository: string; readonly branch?: string | undefined },
): Promise<void> {
  // The repository/branch triggers are comboboxes labeled by an associated
  // <label htmlFor>; getByLabel resolves them even after the branch trigger
  // shows the auto-selected default branch name. Search fields use
  // getByPlaceholder (same pattern as the model picker) because Base UI's
  // ComboboxInput is role=combobox, not textbox — so getByRole("textbox")
  // never matches even when aria-label is set.
  //
  // Repo option accessible names include a "default <branch>" subtitle, so
  // match the owner/name with a word-boundary-ish pattern and prefer the
  // option whose name starts with the repository key.
  await card.getByLabel("GitHub repository").click();
  await page.getByPlaceholder("Search repositories…").fill(input.repository);
  const repoOption = page
    .getByRole("option", { name: new RegExp(`^${escapeRegExp(input.repository)}\\b`, "i") })
    .first();
  await repoOption.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  await repoOption.click();

  // Selecting a repository auto-fills the repo's default branch. Only open the
  // branch picker when an explicit branch was requested and it differs.
  const branchTrigger = card.getByLabel("Branch", { exact: true });
  await expect(branchTrigger).not.toHaveText(/Select a (branch|repository)/, {
    timeout: E2E_TIMEOUTS.assertionMs,
  });
  if (input.branch === undefined) return;

  const currentBranch = (await branchTrigger.innerText()).trim();
  if (currentBranch === input.branch) return;

  await branchTrigger.click();
  await page.getByPlaceholder("Search branches…").fill(input.branch);
  const branchOption = page.getByRole("option", { name: input.branch, exact: true }).first();
  await branchOption.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  await branchOption.click();
}

/** @deprecated Prefer `selectSandboxGitHubSource`. */
export const selectVercelSource = selectSandboxGitHubSource;

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
