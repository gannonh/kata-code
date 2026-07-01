import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import type { E2ERunContext } from "../harness/isolatedRun.ts";
import { dismissBlockingToasts } from "./navigation.ts";
import { openProviderSettings } from "./settings.ts";
import { makeProviderSkillInvocationToken } from "../../../packages/shared/src/providerSkills.ts";

export interface CursorSkillsConfig {
  readonly model: string;
  readonly binaryPath?: string | undefined;
}

export interface CursorSkillFixtures {
  readonly duplicateName: string;
  readonly uniqueName: string;
  readonly uniqueToken: string;
}

const REQUIRED_CURSOR_ENV = [
  "KATACODE_E2E_ENABLE_CURSOR",
  "KATACODE_E2E_CURSOR_MODEL",
  "KATACODE_E2E_CURSOR_API_KEY",
] as const;

export function readCursorSkillsConfig():
  | { readonly ok: true; readonly config: CursorSkillsConfig }
  | { readonly ok: false; readonly missing: ReadonlyArray<(typeof REQUIRED_CURSOR_ENV)[number]> } {
  const missing = REQUIRED_CURSOR_ENV.filter((name) => {
    const value = process.env[name];
    if (name === "KATACODE_E2E_ENABLE_CURSOR") return value !== "1";
    return value === undefined || value.trim().length === 0;
  });

  if (missing.length > 0) return { ok: false, missing };

  const binaryPath = process.env.KATACODE_E2E_CURSOR_BINARY_PATH?.trim();
  return {
    ok: true,
    config: {
      model: process.env.KATACODE_E2E_CURSOR_MODEL!.trim(),
      ...(binaryPath ? { binaryPath } : {}),
    },
  };
}

export function formatCursorSkillsSkipReason(missing: ReadonlyArray<string>): string {
  return `Cursor skills E2E skipped. Missing or disabled: ${missing.join(", ")}.`;
}

async function writeSkill(input: {
  readonly root: string;
  readonly directoryName: ".cursor/skills" | ".agents/skills";
  readonly slug: string;
  readonly name: string;
  readonly description: string;
}): Promise<string> {
  const skillDir = join(input.root, input.directoryName, input.slug);
  const skillPath = join(skillDir, "SKILL.md");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    skillPath,
    [
      "---",
      `name: ${input.name}`,
      `description: ${input.description}`,
      "---",
      "",
      `# ${input.name}`,
      "",
      input.description,
      "",
    ].join("\n"),
  );
  return skillPath;
}

export async function seedCursorSkillFixtures(
  context: E2ERunContext,
): Promise<CursorSkillFixtures> {
  const duplicateName = `cursor-e2e-duplicate-${context.runId.slice(-8)}`;
  const uniqueName = `cursor-e2e-unique-${context.runId.slice(-8)}`;
  await writeSkill({
    root: context.katacodeHome,
    directoryName: ".cursor/skills",
    slug: "duplicate-cursor",
    name: duplicateName,
    description: "Duplicate Cursor E2E skill from the isolated .cursor/skills home.",
  });
  await writeSkill({
    root: context.katacodeHome,
    directoryName: ".agents/skills",
    slug: "duplicate-agents",
    name: duplicateName,
    description: "Duplicate Cursor E2E skill from the isolated .agents/skills home.",
  });
  const uniquePath = await writeSkill({
    root: context.katacodeHome,
    directoryName: ".cursor/skills",
    slug: "unique-cursor",
    name: uniqueName,
    description: "Unique Cursor E2E skill for path-qualified token insertion.",
  });

  return {
    duplicateName,
    uniqueName,
    uniqueToken: makeProviderSkillInvocationToken({ name: uniqueName, path: uniquePath }),
  };
}

export async function configureCursorProviderForSkills(
  page: Page,
  config: CursorSkillsConfig,
): Promise<void> {
  await openProviderSettings(page);

  const enableCursor = page.getByRole("switch", { name: "Enable Cursor" });
  if (!(await enableCursor.isChecked())) {
    await enableCursor.click();
    await expect(enableCursor).toBeChecked({ timeout: E2E_TIMEOUTS.assertionMs });
  }

  const toggleDetails = page.getByLabel("Toggle Cursor details");
  if ((await toggleDetails.getAttribute("aria-expanded")) !== "true") {
    await toggleDetails.click();
  }

  if (config.binaryPath) {
    const binaryPathInput = page.locator("#provider-instance-cursor-binaryPath");
    await binaryPathInput.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
    await binaryPathInput.fill(config.binaryPath);
    await binaryPathInput.press("Enter");
  }

  const customModelInput = page.locator("#provider-instance-cursor-custom-model");
  await customModelInput.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  await customModelInput.fill(config.model);
  await customModelInput.press("Enter");
  // Custom models render as a span with a `Remove <slug>` button; assert the
  // saved row appeared rather than a `<code>` element, which only renders
  // inside the details tooltip when the model has capabilities.
  await expect(page.getByRole("button", { name: `Remove ${config.model}` })).toBeVisible({
    timeout: E2E_TIMEOUTS.assertionMs,
  });

  await dismissBlockingToasts(page);
  const refreshButton = page.getByLabel("Refresh provider status");
  await refreshButton.click();
  await expect(refreshButton).toBeEnabled({ timeout: E2E_TIMEOUTS.authMs });

  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByTestId("command-palette-trigger")
    .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
}

export async function expectComposerSkillMenuEntries(
  page: Page,
  skillName: string,
  count: number,
): Promise<void> {
  const editor = page.getByTestId("composer-editor");
  await editor.click();
  await editor.fill(`$${skillName}`);
  await expect(
    page.locator('[data-slot="command-group-label"]', { hasText: "Skills" }),
  ).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });
  await expect(page.locator('[data-slot="command-item"]', { hasText: skillName })).toHaveCount(
    count,
    {
      timeout: E2E_TIMEOUTS.assertionMs,
    },
  );
}

export async function selectComposerSkill(page: Page, skillName: string): Promise<string> {
  const editor = page.getByTestId("composer-editor");
  await editor.click();
  await editor.fill(`$${skillName}`);
  const skillItem = page.locator('[data-slot="command-item"]', { hasText: skillName }).first();
  await expect(skillItem).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });
  await skillItem.click();
  await expect(
    page.locator('[data-composer-skill-chip="true"]', { hasText: skillName }),
  ).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });
  return (await editor.innerText()).trim();
}
