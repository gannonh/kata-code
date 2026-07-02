import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { expandCursorSkillTokensInPrompt } from "../../../apps/server/src/provider/skills/filesystemSkills.ts";
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
  readonly uniquePath: string;
  readonly uniqueToken: string;
}

/**
 * Mirror of `formatProviderSkillDisplayName` in the web app: skill names are
 * title-cased and hyphens/underscores become spaces for display. The composer
 * menu and skill chip render this formatted label, not the raw hyphenated name.
 */
function formatSkillDisplayName(skillName: string): string {
  return skillName
    .split(/[\s:_-]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

const REQUIRED_CURSOR_ENV = [
  "KATACODE_E2E_ENABLE_CURSOR",
  "KATACODE_E2E_CURSOR_MODEL",
  "KATACODE_E2E_CURSOR_API_KEY",
] as const;

/** Read Cursor E2E gate env vars and return config or the missing variable names. */
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

/** Human-readable skip reason when Cursor skills E2E gates are not satisfied. */
export function formatCursorSkillsSkipReason(missing: ReadonlyArray<string>): string {
  return `Cursor skills E2E skipped. Missing or disabled: ${missing.join(", ")}.`;
}

/** Write a minimal `SKILL.md` fixture under a Cursor-compatible skills directory. */
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

/** Seed duplicate and unique Cursor skill fixtures into the isolated E2E home. */
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
    uniquePath,
    uniqueToken: makeProviderSkillInvocationToken({ name: uniqueName, path: uniquePath }),
  };
}

/** Enable Cursor in settings and refresh provider status for skills E2E. */
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

  await dismissBlockingToasts(page);
  const refreshButton = page.getByLabel("Refresh provider status");
  await refreshButton.click();
  await expect(refreshButton).toBeEnabled({ timeout: E2E_TIMEOUTS.authMs });

  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByTestId("command-palette-trigger")
    .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
}

/** Assert the Composer skills menu shows the expected number of entries for a name. */
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
  // Skill menu items render the title-cased display name (e.g. "Cursor E2e
  // Duplicate Abcd1234"), not the raw hyphenated skill name. Match the
  // formatted label so the assertion reflects what the user sees.
  const displayName = formatSkillDisplayName(skillName);
  await expect(page.locator('[data-slot="command-item"]', { hasText: displayName })).toHaveCount(
    count,
    {
      timeout: E2E_TIMEOUTS.assertionMs,
    },
  );
}

/** Select a Composer skill from the `$` menu and return the serialized prompt text. */
export async function selectComposerSkill(page: Page, skillName: string): Promise<string> {
  const editor = page.getByTestId("composer-editor");
  await editor.click();
  await editor.fill(`$${skillName}`);
  const displayName = formatSkillDisplayName(skillName);
  const skillItem = page.locator('[data-slot="command-item"]', { hasText: displayName }).first();
  await expect(skillItem).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });
  await skillItem.click();
  await expect(
    page.locator('[data-composer-skill-chip="true"]', { hasText: displayName }),
  ).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });
  // Read the serialized Lexical editor text. Skill nodes store the
  // path-qualified token as `skillName` and serialize as `$<token>`. Lexical
  // attaches the editor instance to the contentEditable root element, and
  // inline skill nodes are nested inside paragraph blocks.
  const serialized = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="composer-editor"]') as
      | (HTMLElement & Record<string, unknown>)
      | null;
    const lexicalEditor = root?.["__lexicalEditor"] as
      | { getEditorState: () => { toJSON: () => unknown } }
      | undefined;
    if (!lexicalEditor) return "";
    const state = lexicalEditor.getEditorState().toJSON() as {
      root: {
        children: ReadonlyArray<{
          type: string;
          text?: string;
          skillName?: string;
          children?: ReadonlyArray<{
            type: string;
            text?: string;
            skillName?: string;
          }>;
        }>;
      };
    };
    // Lexical nests inline nodes (skill chips) inside paragraph nodes.
    const parts: string[] = [];
    for (const block of state.root.children) {
      if (block.type === "composer-skill") {
        parts.push("$" + (block.skillName ?? ""));
      } else if (block.text) {
        parts.push(block.text);
      }
      for (const inline of block.children ?? []) {
        if (inline.type === "composer-skill") {
          parts.push("$" + (inline.skillName ?? ""));
        } else if (inline.text) {
          parts.push(inline.text);
        }
      }
    }
    return parts.join("");
  });
  return serialized.trim();
}

/** Assert server-side prompt expansion produces the expected inline `<skill>` block. */
export function expectCursorSkillPromptExpansion(
  fixtures: CursorSkillFixtures,
  context: E2ERunContext,
  workspaceRoot: string,
): void {
  const expanded = expandCursorSkillTokensInPrompt(`Please $${fixtures.uniqueToken} now`, {
    cwd: workspaceRoot,
    homeDir: context.katacodeHome,
  });

  expect(expanded).toContain(`<skill name="${fixtures.uniqueName}"`);
  expect(expanded).toContain(`location="${fixtures.uniquePath}"`);
  expect(expanded).toContain("Unique Cursor E2E skill for path-qualified token insertion.");
  expect(expanded.endsWith("now")).toBe(true);
}
