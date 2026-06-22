import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "@playwright/test";

const PAIRING_BLOCKING_HEADING = /Pair with this environment/i;
const APP_SHELL_TEST_ID = "command-palette-trigger";

async function reloadIfPairingGateVisible(page: Page): Promise<boolean> {
  const pairingVisible = await page
    .getByRole("heading", { name: PAIRING_BLOCKING_HEADING })
    .isVisible()
    .catch(() => false);

  if (!pairingVisible) {
    return false;
  }

  // Electron can render the pairing gate before embedded API config settles; reload
  // reuses the now-ready server without leaving tests stuck on the gate.
  await page.reload({ waitUntil: "domcontentloaded" });
  await delay(500);
  return true;
}

export async function waitForAppShell(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (
      await page
        .getByTestId(APP_SHELL_TEST_ID)
        .isVisible()
        .catch(() => false)
    ) {
      return;
    }

    if (await reloadIfPairingGateVisible(page)) {
      continue;
    }

    await delay(250);
  }

  throw new Error(
    "E2E pairing: app stayed on the pairing gate or never reached the main shell within the timeout.",
  );
}
