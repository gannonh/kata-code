import type { Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { logHarnessPhase } from "../harness/log.ts";
import { waitForTcpPort } from "../harness/readiness.ts";
import type { E2ERunContext } from "../harness/isolatedRun.ts";
import { waitForAppShell } from "./shell.ts";

export async function waitForAppEnvironmentReady(
  page: Page,
  context: E2ERunContext,
): Promise<void> {
  // The renderer window already navigated to a URL on this port, so the socket is
  // open by construction. Skip the redundant TCP poll.
  if (context.launchTarget === "dev") {
    logHarnessPhase("Waiting for dev stack server port...");
    await waitForTcpPort(context.serverPort, E2E_TIMEOUTS.pairingMs);
    logHarnessPhase("Dev stack server port is ready.");
  }

  logHarnessPhase("Waiting for app shell (command palette trigger)...");
  await waitForAppShell(page, E2E_TIMEOUTS.pairingMs);
  logHarnessPhase("App shell is ready.");
}
