import type { Locator, Page } from "@playwright/test";
import { readVercelCredentials, readVercelSourceSelection } from "../../src/harness/env.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import {
  addVercelEnvironment,
  openConnectionsSettings,
  selectVercelSource,
} from "../../src/flows/settings.ts";
import { dismissBlockingToasts, openCommandPalette } from "../../src/flows/navigation.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

/**
 * Vercel Sandbox deployment target — credentialed, maintainer-local. SKIP when
 * `E2E_VERCEL_TOKEN`/`E2E_VERCEL_TEAM_ID`/`E2E_VERCEL_PROJECT_ID` are absent (CI runs
 * uncredentialed; the Docker `container-deploy.spec.ts` covers AC-3b.13).
 *
 * The source-picker + worktree test additionally needs a GitHub source the host
 * `gh` session can access (`E2E_VERCEL_SOURCE_REPOSITORY`, optional
 * `E2E_VERCEL_SOURCE_BRANCH`).
 *
 * Run locally with the trio exported:
 *   E2E_VERCEL_TOKEN=... E2E_VERCEL_TEAM_ID=... E2E_VERCEL_PROJECT_ID=... \
 *   E2E_VERCEL_SOURCE_REPOSITORY=owner/name vp run e2e ...
 */

/** Add the Vercel auth trio as sensitive runtime environment variables. */
async function fillVercelAuthTrio(
  page: Page,
  card: Locator,
  creds: { readonly token: string; readonly teamId: string; readonly projectId: string },
): Promise<void> {
  const envSection = card.locator("div").filter({ hasText: "Environment variables" }).first();
  await envSection.getByRole("button", { name: "Add", exact: true }).click();
  const rows = envSection.getByRole("textbox");
  await rows.nth(0).fill("VERCEL_TOKEN");
  await envSection.locator("input[type=password]").first().fill(creds.token);
  await envSection.getByRole("button", { name: "Add", exact: true }).click();
  await rows.nth(2).fill("VERCEL_TEAM_ID");
  await envSection.locator("input[type=password]").nth(1).fill(creds.teamId);
  await envSection.getByRole("button", { name: "Add", exact: true }).click();
  await rows.nth(4).fill("VERCEL_PROJECT_ID");
  await envSection.locator("input[type=password]").nth(2).fill(creds.projectId);
}

test.describe(`Environments/deployments vercel target ${E2E_TAGS.environmentsDeploy}`, () => {
  test.describe.configure({ timeout: E2E_TIMEOUTS.agentReplyMs });

  test.skip(
    !readVercelCredentials(),
    "VERCEL_* credentials not set; credentialed Vercel checks are maintainer-local",
  );

  test("add vercel target, enter trio, test connection, start + dispose (AC-3b.8/12)", async ({
    appWindow,
  }, testInfo) => {
    const creds = readVercelCredentials()!;
    const source = readVercelSourceSelection();
    test.skip(
      source === null,
      "E2E_VERCEL_SOURCE_REPOSITORY not set; a GitHub source is required to create a Vercel sandbox",
    );
    const page = appWindow;
    await openConnectionsSettings(page);
    await dismissBlockingToasts(page);

    const card = await addVercelEnvironment(page, "E2E Vercel");
    await card.getByRole("button", { name: /Toggle .* details/ }).click();

    await fillVercelAuthTrio(page, card, creds);

    // Source is required before Create is enabled (AC-GS4). Select repo + branch.
    await selectVercelSource(page, card, source!);
    await expect(card.getByRole("button", { name: "Create & run sandbox" })).toBeEnabled({
      timeout: E2E_TIMEOUTS.assertionMs,
    });

    // Test connection: validate -> provision -> dispose -> done. Test connection
    // uses a disposable source-less probe, so it works regardless of source.
    await card.getByRole("button", { name: "Test connection" }).click();
    const progress = card.locator("pre");
    await expect(progress).toContainText("validate: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });
    await expect(progress).toContainText("provision: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });
    await expect(progress).toContainText("done: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });

    // Create & run: provisions the sandbox from the native Git source,
    // Connect-auto-registers the public endpoint, and surfaces the public URL.
    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: "Create & run sandbox" }).click();
    const sessionLine = card.getByText(/Session ready:/);
    await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
    await sessionLine.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("vercel-session-ready.png"),
      fullPage: true,
    });

    const sessionText = await sessionLine.textContent();
    expect(sessionText, "session text did not expose a public URL").toMatch(
      /https:\/\/[a-z0-9-]+\.vercel\.run/i,
    );

    // Source controls lock once a sandbox exists (AC-GS11).
    await expect(
      card.getByText("Delete this sandbox to change its repository or branch."),
    ).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });

    // Stop then delete the sandbox (durable lifecycle: AC-L8/L9). The session
    // line disappears once the sandbox is deleted.
    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: "Stop" }).click();
    await card.getByRole("button", { name: "Delete sandbox" }).click();
    await expect(sessionLine).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });

    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: /Delete sandbox environment/ }).click();
    await expect(card).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });
  });

  test("selected source becomes a New worktree base branch on the sandbox (AC-GS5)", async ({
    appWindow,
  }, testInfo) => {
    const creds = readVercelCredentials()!;
    const source = readVercelSourceSelection();
    test.skip(
      source === null,
      "E2E_VERCEL_SOURCE_REPOSITORY not set; the source-picker/worktree flow is maintainer-local",
    );
    const page = appWindow;
    await openConnectionsSettings(page);
    await dismissBlockingToasts(page);

    const card = await addVercelEnvironment(page, "E2E Vercel Worktree");
    await card.getByRole("button", { name: /Toggle .* details/ }).click();
    await fillVercelAuthTrio(page, card, creds);
    await selectVercelSource(page, card, source!);

    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: "Create & run sandbox" }).click();
    const sessionLine = card.getByText(/Session ready:/);
    await expect(sessionLine).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });

    // Open a project on the sandbox at its native clone root, then switch the
    // composer to New worktree. Vercel's native clone leaves a detached HEAD;
    // the driver attaches the selected branch so it is a selectable base ref.
    await openCommandPalette(page);
    const palette = page.getByTestId("command-palette");
    await palette.getByText("Add project", { exact: true }).click();
    await palette.getByText("E2E Vercel Worktree", { exact: true }).click();
    await palette.getByText("Local folder", { exact: true }).click();
    // The picker opens at /vercel/sandbox/ (the native clone root); add it.
    await page.getByRole("button", { name: /^Add \(Enter\)$/ }).click();
    await page
      .getByTestId("composer-editor")
      .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.agentReplyMs });

    await page.getByRole("button", { name: "Workspace" }).click();
    await page.getByRole("option", { name: "New worktree" }).click();

    // The branch toolbar exposes the selected source branch as the base ref
    // ("From <branch>"), instead of the empty "Select ref" a detached HEAD gives.
    const expectedBranch = source!.branch;
    const baseRefButton = expectedBranch
      ? page.getByRole("button", { name: `From ${expectedBranch}` })
      : page.getByRole("button", { name: /^From / });
    await expect(baseRefButton).toBeVisible({ timeout: E2E_TIMEOUTS.agentReplyMs });
    await expect(page.getByRole("button", { name: "Select ref" })).toBeHidden();

    await page.screenshot({
      path: testInfo.outputPath("vercel-worktree-base-branch.png"),
      fullPage: true,
    });

    // Clean up: settings → stop → delete sandbox + environment.
    await openConnectionsSettings(page);
    await dismissBlockingToasts(page);
    const cleanupCard = card;
    await cleanupCard.getByRole("button", { name: /Toggle .* details/ }).click();
    await cleanupCard.getByRole("button", { name: "Stop" }).click();
    await cleanupCard.getByRole("button", { name: "Delete sandbox" }).click();
    await dismissBlockingToasts(page);
    await cleanupCard.getByRole("button", { name: /Delete sandbox environment/ }).click();
    await expect(cleanupCard).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });
  });
});
