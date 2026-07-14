import { expect, type Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { dismissBlockingToasts } from "./navigation.ts";
import { openProviderSettings } from "./settings.ts";

export interface PiSmokeConfig {
  readonly agentDir: string;
  readonly model: string;
}

const REQUIRED_PI_ENV = [
  "KATACODE_E2E_ENABLE_PI",
  "KATACODE_E2E_PI_AGENT_DIR",
  "KATACODE_E2E_PI_MODEL",
] as const;

export function readPiSmokeConfig():
  | { readonly ok: true; readonly config: PiSmokeConfig }
  | { readonly ok: false; readonly missing: ReadonlyArray<(typeof REQUIRED_PI_ENV)[number]> } {
  const missing = REQUIRED_PI_ENV.filter((name) => {
    const value = process.env[name];
    if (name === "KATACODE_E2E_ENABLE_PI") return value !== "1";
    return value === undefined || value.trim().length === 0;
  });

  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    config: {
      agentDir: process.env.KATACODE_E2E_PI_AGENT_DIR!,
      model: process.env.KATACODE_E2E_PI_MODEL!,
    },
  };
}

export function formatPiSmokeSkipReason(missing: ReadonlyArray<string>): string {
  return `Pi E2E smoke skipped. Missing or disabled: ${missing.join(", ")}.`;
}

export async function configureDefaultPiProvider(page: Page, config: PiSmokeConfig): Promise<void> {
  await openProviderSettings(page);

  const toggleDetails = page.getByLabel("Toggle Pi details");
  await toggleDetails.click();

  const piCard = toggleDetails.locator("xpath=ancestor::div[contains(@class, 'border-t')][1]");
  const agentDir = page.getByLabel("Agent directory");
  if ((await agentDir.inputValue()) !== config.agentDir) {
    await agentDir.fill(config.agentDir);
    await agentDir.press("Enter");
  }

  const customModelInput = page.locator("#provider-instance-pi-custom-model");
  await customModelInput.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  if ((await piCard.getByText(config.model, { exact: true }).count()) === 0) {
    await customModelInput.fill(config.model);
    await customModelInput.press("Enter");
  }

  await dismissBlockingToasts(page);
  await expect(piCard).toContainText("Authenticated", { timeout: E2E_TIMEOUTS.authMs });

  await page.getByRole("button", { name: "Back" }).click();
  await page
    .getByTestId("command-palette-trigger")
    .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
}
