import type { Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { waitForTcpPort } from "../harness/readiness.ts";
import type { E2ERunContext } from "../harness/isolatedRun.ts";
import { waitForAppShell } from "./shell.ts";

export async function waitForAppEnvironmentReady(
  page: Page,
  context: E2ERunContext,
): Promise<void> {
  await waitForTcpPort(context.serverPort, E2E_TIMEOUTS.pairingMs);
  await waitForAppShell(page, E2E_TIMEOUTS.pairingMs);
}
