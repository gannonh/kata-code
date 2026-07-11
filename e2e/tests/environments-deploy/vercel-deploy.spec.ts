import type { Locator } from "@playwright/test";
import { readVercelCredentials, readVercelSourceSelection } from "../../src/harness/env.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { authorizeConnectCli, withConnectBrowser } from "../../src/flows/connect.ts";
import {
  addVercelEnvironment,
  openConnectionsSettings,
  selectVercelSource,
} from "../../src/flows/settings.ts";
import { dismissBlockingToasts, openCommandPalette } from "../../src/flows/navigation.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";
import type { E2ERunContext } from "../../src/harness/isolatedRun.ts";

/**
 * Vercel Sandbox deployment target — credentialed, maintainer-local. SKIP when
 * `E2E_VERCEL_TOKEN`/`E2E_VERCEL_TEAM_ID`/`E2E_VERCEL_PROJECT_ID` are absent (CI runs
 * uncredentialed; the Docker `container-deploy.spec.ts` covers AC-3b.13).
 *
 * The source-picker + worktree test additionally needs a GitHub source the host
 * `gh` session can access (`E2E_VERCEL_SOURCE_REPOSITORY`, optional
 * `E2E_VERCEL_SOURCE_BRANCH`).
 *
 * Public Vercel endpoints register through the relay using the stored Connect
 * CLI OAuth token (`stored-first`). Authorize Connect into the isolated
 * `KATACODE_HOME` before Create & run.
 *
 * Run locally with the trio exported:
 *   E2E_VERCEL_TOKEN=... E2E_VERCEL_TEAM_ID=... E2E_VERCEL_PROJECT_ID=... \
 *   E2E_VERCEL_SOURCE_REPOSITORY=owner/name vp run e2e ...
 */

/** Mint a Connect CLI OAuth token into the isolated E2E home for relay registration. */
async function authorizeIsolatedConnect(runContext: E2ERunContext): Promise<void> {
  await withConnectBrowser((connectPage) => authorizeConnectCli(runContext, connectPage));
}

/**
 * Fill the Vercel auth trio. The Runtime environment variables section
 * prefills blank VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID rows (in
 * that order) for Vercel targets, so only the values are entered. `DraftInput`
 * commits on blur, so each value is committed before moving on.
 */
async function fillVercelAuthTrio(
  card: Locator,
  creds: { readonly token: string; readonly teamId: string; readonly projectId: string },
): Promise<void> {
  // Prefilled rows keep the trio at positions 1..3 in name order.
  const values = [creds.token, creds.teamId, creds.projectId];
  for (let index = 0; index < values.length; index += 1) {
    const valueInput = card.getByLabel(`Environment variable value ${index + 1}`);
    await valueInput.click();
    await valueInput.fill(values[index]!);
    await valueInput.blur();
  }
}

/**
 * Vercel cloud create/dispose is slow (~100s for Test connection's disposable
 * probe alone; Create & run with a Git clone is longer). `agentReplyMs` is
 * sized for LLM replies and is too short here.
 */
const VERCEL_CLOUD_STEP_MS = Math.max(E2E_TIMEOUTS.agentReplyMs, 150_000);
/** Full lifecycle: Test connection + Create & run + stop/delete. */
const VERCEL_CLOUD_TEST_MS = Math.max(E2E_TIMEOUTS.agentTestMs, 480_000);

test.describe(`Environments/deployments vercel target ${E2E_TAGS.environmentsDeploy}`, () => {
  test.describe.configure({ timeout: VERCEL_CLOUD_TEST_MS });

  test.skip(
    !readVercelCredentials(),
    "VERCEL_* credentials not set; credentialed Vercel checks are maintainer-local",
  );

  test("add vercel target, enter trio, test connection, start + dispose (AC-3b.8/12)", async ({
    appWindow,
    runContext,
  }, testInfo) => {
    const creds = readVercelCredentials()!;
    const source = readVercelSourceSelection();
    test.skip(
      source === null,
      "E2E_VERCEL_SOURCE_REPOSITORY not set; a GitHub source is required to create a Vercel sandbox",
    );
    // Surface the resolved source so a stale shell export (which wins over
    // `.env`) is obvious in the headed run log.
    console.log(
      `[e2e] Vercel source selection: repo=${source!.repository} branch=${source!.branch ?? "(repo default)"}`,
    );
    const page = appWindow;
    await openConnectionsSettings(page);
    await dismissBlockingToasts(page);

    const card = await addVercelEnvironment(page, "E2E Vercel");
    await card.getByRole("button", { name: /Toggle .* details/ }).click();

    await fillVercelAuthTrio(card, creds);

    // Source is required before Create is enabled (AC-GS4). Select repo + branch.
    await selectVercelSource(page, card, source!);
    await expect(card.getByRole("button", { name: "Create & run sandbox" })).toBeEnabled({
      timeout: E2E_TIMEOUTS.assertionMs,
    });

    // Test connection: validate -> provision -> dispose -> done. Test connection
    // uses a disposable source-less probe, so it works regardless of source.
    // validate is immediate; provision/dispose take ~100s on a live Vercel project.
    await card.getByRole("button", { name: "Test connection" }).click();
    const progress = card.locator("pre");
    await expect(progress).toContainText("validate: ok", { timeout: E2E_TIMEOUTS.assertionMs });
    await expect(progress).toContainText("provision: ok", { timeout: VERCEL_CLOUD_STEP_MS });
    await expect(progress).toContainText("done: ok", { timeout: VERCEL_CLOUD_STEP_MS });

    // Public Vercel registration uses the stored Connect CLI token (stored-first).
    // App Clerk sign-in alone is not enough — mint the CLI OAuth credential into
    // the isolated home before Create & run hits the relay.
    await authorizeIsolatedConnect(runContext);

    // Create & run: provisions the sandbox from the native Git source,
    // Connect-auto-registers the public endpoint, and surfaces the public URL.
    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: "Create & run sandbox" }).click();
    const sessionLine = card.getByText(/Session ready:/);
    await expect(sessionLine).toBeVisible({ timeout: VERCEL_CLOUD_STEP_MS });
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
    await card.getByRole("button", { name: "Stop" }).last().click();
    await card.getByRole("button", { name: "Delete sandbox", exact: true }).click();
    await expect(sessionLine).toBeHidden({ timeout: VERCEL_CLOUD_STEP_MS });

    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: /Delete sandbox environment/ }).click();
    await expect(card).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });
  });

  test("selected source becomes a New worktree base branch on the sandbox (AC-GS5)", async ({
    appWindow,
    runContext,
  }, testInfo) => {
    const creds = readVercelCredentials()!;
    const source = readVercelSourceSelection();
    test.skip(
      source === null,
      "E2E_VERCEL_SOURCE_REPOSITORY not set; the source-picker/worktree flow is maintainer-local",
    );
    console.log(
      `[e2e] Vercel source selection: repo=${source!.repository} branch=${source!.branch ?? "(repo default)"}`,
    );
    const page = appWindow;
    await openConnectionsSettings(page);
    await dismissBlockingToasts(page);

    const card = await addVercelEnvironment(page, "E2E Vercel Worktree");
    await card.getByRole("button", { name: /Toggle .* details/ }).click();
    await fillVercelAuthTrio(card, creds);
    await selectVercelSource(page, card, source!);

    await authorizeIsolatedConnect(runContext);

    await dismissBlockingToasts(page);
    await card.getByRole("button", { name: "Create & run sandbox" }).click();
    const sessionLine = card.getByText(/Session ready:/);
    await expect(sessionLine).toBeVisible({ timeout: VERCEL_CLOUD_STEP_MS });

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
    await cleanupCard.getByRole("button", { name: "Stop" }).last().click();
    await cleanupCard.getByRole("button", { name: "Delete sandbox", exact: true }).click();
    await expect(sessionLine).toBeHidden({ timeout: VERCEL_CLOUD_STEP_MS });
    await dismissBlockingToasts(page);
    await cleanupCard.getByRole("button", { name: /Delete sandbox environment/ }).click();
    await expect(cleanupCard).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });
  });
});
