import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

import {
  formatMissingPrerequisiteError,
  readClerkPrerequisites,
  readGoogleTestUserEmail,
  readGoogleTestUserPrerequisites,
} from "../harness/env.ts";
import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { openSettings } from "./settings.ts";
import { waitForAppShell } from "./shell.ts";

export function assertAuthPrerequisites(phase: string): void {
  const clerkPrereqs = readClerkPrerequisites();
  if (!clerkPrereqs.ok) {
    throw new Error(formatMissingPrerequisiteError(phase, clerkPrereqs.missing));
  }

  const google = readGoogleTestUserPrerequisites();
  if (!google.ok) {
    throw new Error(formatMissingPrerequisiteError(phase, google.missing));
  }
}

async function waitForClerkOnAppShell(page: Page): Promise<void> {
  await waitForAppShell(page, E2E_TIMEOUTS.assertionMs);
  await clerk.loaded({ page });
}

export async function signInWithClerkGoogleTestUser(page: Page): Promise<void> {
  assertAuthPrerequisites("Google test-user auth");
  const email = readGoogleTestUserEmail();

  await waitForClerkOnAppShell(page);
  await clerk.signIn({ page, emailAddress: email });
}

export async function expectSignedInClerkState(page: Page): Promise<void> {
  try {
    await page.waitForFunction(() => window.Clerk?.user != null, undefined, {
      timeout: E2E_TIMEOUTS.authMs,
    });
  } catch {
    throw new Error(
      "Google test-user auth: Clerk did not reach a signed-in state. Confirm the Google test user exists in Clerk, environment pairing completed, and Clerk testing setup documented in e2e/README.md.",
    );
  }

  const avatar = page.locator(".cl-userButton-root").first();
  await avatar.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.authMs }).catch(async () => {
    await openSettings(page);
    await avatar.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.authMs });
  });
}
