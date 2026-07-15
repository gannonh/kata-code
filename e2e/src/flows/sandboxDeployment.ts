import { expect, type Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { dismissBlockingToasts } from "./navigation.ts";
import { deploymentTargetCard } from "./settings.ts";

/**
 * Deletes a sandbox deployment target and its transient orphaned saved-runtime
 * row when disposal has not already removed that row asynchronously.
 */
export async function deleteSandboxDeploymentTarget(page: Page, label: string): Promise<void> {
  const targetCard = deploymentTargetCard(page, label);
  await dismissBlockingToasts(page);
  await targetCard.getByRole("button", { name: /Delete sandbox environment/ }).click();

  const namedCard = deploymentTargetCard(page, label);
  const orphanedRuntime = namedCard.getByText(/Orphaned sandbox runtime/);
  await expect
    .poll(
      async () => {
        if (!(await namedCard.isVisible().catch(() => false))) return "hidden";
        return (await orphanedRuntime.isVisible().catch(() => false)) ? "orphan" : "target";
      },
      { timeout: E2E_TIMEOUTS.assertionMs },
    )
    .toMatch(/^(hidden|orphan)$/u);

  if (await orphanedRuntime.isVisible().catch(() => false)) {
    try {
      await namedCard.getByRole("button", { name: "Delete", exact: true }).click({
        timeout: E2E_TIMEOUTS.assertionMs,
      });
    } catch (error) {
      if (await namedCard.isVisible().catch(() => false)) throw error;
    }
  }

  await expect(namedCard).toBeHidden({ timeout: E2E_TIMEOUTS.assertionMs });
}
