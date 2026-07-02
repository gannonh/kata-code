import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import {
  configureCursorProviderForSkills,
  expectComposerSkillMenuEntries,
  expectCursorSkillPromptExpansion,
  formatCursorSkillsSkipReason,
  readCursorSkillsConfig,
  seedCursorSkillFixtures,
  selectComposerSkill,
} from "../../src/flows/cursorSkills.ts";
import { selectComposerModelForProvider } from "../../src/flows/agentChat.ts";
import { dismissBlockingToasts } from "../../src/flows/navigation.ts";
import { createOrOpenProject, createSeededWorkspace } from "../../src/flows/workspace.ts";
import { expect, resetAppToHome, test } from "../../src/harness/testFixtures.ts";

const cursorSkills = readCursorSkillsConfig();

test.describe(`Cursor skills ${E2E_TAGS.cursor}`, () => {
  test.skip(
    !cursorSkills.ok,
    cursorSkills.ok ? undefined : formatCursorSkillsSkipReason(cursorSkills.missing),
  );
  test.describe.configure({ timeout: E2E_TIMEOUTS.agentTestMs });

  test.beforeEach(async ({ authenticatedAppWindow }) => {
    await resetAppToHome(authenticatedAppWindow);
  });

  test("surfaces duplicate filesystem skills and inserts a path-qualified token", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    if (!cursorSkills.ok) return;

    const page = authenticatedAppWindow;
    const duplicateKeyErrors: string[] = [];
    page.on("console", (message) => {
      const text = message.text();
      if (
        message.type() === "error" &&
        text.includes("Encountered two children with the same key")
      ) {
        duplicateKeyErrors.push(text);
      }
    });

    const fixtures = await seedCursorSkillFixtures(runContext);
    await configureCursorProviderForSkills(page, cursorSkills.config);

    const seededPath = await createSeededWorkspace(runContext, "cursor-skills");
    await createOrOpenProject(page, seededPath);
    await selectComposerModelForProvider(page, "Cursor", cursorSkills.config.model);
    await dismissBlockingToasts(page);

    await expectComposerSkillMenuEntries(page, fixtures.duplicateName, 2);
    expect(duplicateKeyErrors).toEqual([]);

    const serializedPrompt = await selectComposerSkill(page, fixtures.uniqueName);
    expect(serializedPrompt).toContain(`$${fixtures.uniqueToken}`);
    expectCursorSkillPromptExpansion(fixtures, runContext, seededPath);
  });
});
