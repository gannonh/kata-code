import type { Locator } from "@playwright/test";
import { readVercelCredentials, readVercelSourceSelection } from "../../src/harness/env.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import {
  authorizeConnectCli,
  extractConnectEnvironmentId,
  listConnectEnvironmentIds,
  registerConnectEnvironmentCleanup,
  withConnectBrowser,
} from "../../src/flows/connect.ts";
import {
  addVercelEnvironment,
  openConnectionsSettings,
  selectVercelSource,
} from "../../src/flows/settings.ts";
import { dismissBlockingToasts } from "../../src/flows/navigation.ts";
import { deleteSandboxDeploymentTarget } from "../../src/flows/sandboxDeployment.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";
import type { E2ERunContext } from "../../src/harness/isolatedRun.ts";
import {
  inspectSmallVercelSource,
  VERCEL_E2E_SOURCE_MAX_BYTES,
} from "../../src/harness/vercelSourceAssets.ts";

/**
 * Vercel Sandbox deployment target — credentialed, maintainer-local. SKIP when
 * `E2E_VERCEL_TOKEN`/`E2E_VERCEL_TEAM_ID`/`E2E_VERCEL_PROJECT_ID` are absent (CI runs
 * uncredentialed; the Docker `container-deploy.spec.ts` covers AC-3b.13).
 *
 * The create-and-run path additionally needs a GitHub source the host
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
 * Vercel cloud create/dispose is slow because the sandbox cold-boots Kata and
 * provider tooling. `agentReplyMs` is sized for LLM replies and is too short.
 */
const VERCEL_CLOUD_STEP_MS = Math.max(E2E_TIMEOUTS.agentReplyMs, 150_000);
/** One billable sandbox lifecycle: Create & run + stop/delete. */
const VERCEL_CLOUD_TEST_MS = Math.max(E2E_TIMEOUTS.agentTestMs, 480_000);

test.describe(`Environments/deployments vercel target ${E2E_TAGS.environmentsDeploy}`, () => {
  test.describe.configure({ timeout: VERCEL_CLOUD_TEST_MS });

  test.skip(
    !readVercelCredentials(),
    "VERCEL_* credentials not set; credentialed Vercel checks are maintainer-local",
  );

  test(
    "add vercel target, enter trio, start + dispose (AC-3b.8/12)",
    { tag: [E2E_TAGS.environmentsDeploy] },
    async ({ authenticatedAppWindow, runContext }, testInfo) => {
      const creds = readVercelCredentials()!;
      const source = readVercelSourceSelection();
      test.skip(
        source === null,
        "E2E_VERCEL_SOURCE_REPOSITORY not set; a GitHub source is required to create a Vercel sandbox",
      );
      // Measure the exact selected branch before any Vercel provisioning. This
      // blocks stale env configuration from cloning a large repository into a
      // billable sandbox. The native Vercel source clone is already depth=1.
      const sourceAssets = await inspectSmallVercelSource(source!);
      console.log(
        `[e2e] Vercel source selection: repo=${source!.repository} branch=${sourceAssets.branch} assets=${sourceAssets.bytes} bytes/${sourceAssets.files} files (limit ${VERCEL_E2E_SOURCE_MAX_BYTES} bytes)`,
      );
      const page = authenticatedAppWindow;
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

      // Do not run the Test connection probe here. It provisions and cold-boots a
      // second disposable sandbox, doubling package ingress before this lifecycle.

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
      const environmentId = extractConnectEnvironmentId(sessionText);
      expect(environmentId, "session text did not expose the Connect environment id").toBeTruthy();
      registerConnectEnvironmentCleanup(runContext, environmentId!);

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
      await expect
        .poll(async () => (await listConnectEnvironmentIds(runContext)).includes(environmentId!), {
          timeout: E2E_TIMEOUTS.assertionMs,
          message: "disposed sandbox remained in Kata Code Connect discovery",
        })
        .toBe(false);

      await deleteSandboxDeploymentTarget(page, "E2E Vercel");
    },
  );
});
