import type { Locator, Page } from "@playwright/test";
import { readVercelCredentials } from "../../src/harness/env.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { openConnectionsSettings } from "../../src/flows/settings.ts";
import { dismissBlockingToasts } from "../../src/flows/navigation.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

/**
 * Vercel Sandbox deployment target — credentialed, maintainer-local. SKIP when
 * `E2E_VERCEL_TOKEN`/`E2E_VERCEL_TEAM_ID`/`E2E_VERCEL_PROJECT_ID` are absent (CI runs
 * uncredentialed; the Docker `container-deploy.spec.ts` covers AC-3b.13).
 *
 * Run locally with the trio exported:
 *   E2E_VERCEL_TOKEN=... E2E_VERCEL_TEAM_ID=... E2E_VERCEL_PROJECT_ID=... vp run e2e ...
 */

function deploymentTargetCard(page: Page, label: string): Locator {
  const section = page
    .getByRole("heading", { name: "Sandbox environments", level: 2 })
    .locator("xpath=ancestor::section[1]");
  return section.locator("div.border-t").filter({
    has: page.getByRole("heading", { name: label, level: 3 }),
  });
}

async function addVercelDeploymentTarget(page: Page, label: string): Promise<Locator> {
  await page.getByRole("button", { name: "Add sandbox environment" }).click();
  const dialog = page.getByRole("dialog", { name: "Add sandbox environment" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Driver").selectOption("vercel");
  await dialog.getByLabel("Label").fill(label);
  await dialog.getByRole("button", { name: "Add sandbox environment" }).click();
  await expect(dialog).toBeHidden();

  const card = deploymentTargetCard(page, label);
  await expect(card).toBeVisible({ timeout: E2E_TIMEOUTS.authMs });
  await expect(card.getByText("vercel", { exact: true })).toBeVisible();
  return card;
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
    const page = appWindow;
    await openConnectionsSettings(page);
    await dismissBlockingToasts(page);

    const card = await addVercelDeploymentTarget(page, "E2E Vercel");
    await card.getByRole("button", { name: /Toggle .* details/ }).click();

    // Add the Vercel auth trio as sensitive environment variables on the target.
    const envSection = card.locator("div").filter({ hasText: "Environment variables" }).first();
    await envSection.getByRole("button", { name: "Add", exact: true }).click();
    // Fill three rows: VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID.
    const rows = envSection.getByRole("textbox");
    await rows.nth(0).fill("VERCEL_TOKEN");
    await envSection.locator("input[type=password]").first().fill(creds.token);
    await envSection.getByRole("button", { name: "Add", exact: true }).click();
    await rows.nth(2).fill("VERCEL_TEAM_ID");
    await envSection.locator("input[type=password]").nth(1).fill(creds.teamId);
    await envSection.getByRole("button", { name: "Add", exact: true }).click();
    await rows.nth(4).fill("VERCEL_PROJECT_ID");
    await envSection.locator("input[type=password]").nth(2).fill(creds.projectId);

    // Test connection: validate -> provision -> dispose -> done.
    await card.getByRole("button", { name: "Test connection" }).click();
    const progress = card.locator("pre");
    await expect(progress).toContainText("validate: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });
    await expect(progress).toContainText("provision: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });
    await expect(progress).toContainText("done: ok", { timeout: E2E_TIMEOUTS.agentReplyMs });

    // Start session (AC-3b.8): provisions the sandbox, Connect-auto-registers
    // the public endpoint, and surfaces the public URL. State-driven primary
    // action: no sandbox -> "Create & run sandbox" (AC-L11).
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
});
