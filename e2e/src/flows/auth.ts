import type { Page } from "@playwright/test";
import { clerk } from "@clerk/testing/playwright";

import {
  formatMissingPrerequisiteError,
  readClerkPrerequisites,
  readGoogleTestUserEmail,
  readGoogleTestUserPrerequisites,
} from "../harness/env.ts";
import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { logHarnessPhase } from "../harness/log.ts";
import { openSettings } from "./settings.ts";

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

// The appWindow fixture already gated on the app shell via waitForAppEnvironmentReady,
// so Clerk's host shell is up by the time auth runs. Only wait for Clerk to load.
async function waitForClerkLoaded(page: Page): Promise<void> {
  logHarnessPhase("Waiting for Clerk to load on the shell...");
  await clerk.loaded({ page });
  logHarnessPhase("Clerk loaded.");
}

export async function signInWithClerkGoogleTestUser(page: Page): Promise<void> {
  assertAuthPrerequisites("Google test-user auth");
  const email = readGoogleTestUserEmail();

  await waitForClerkLoaded(page);
  logHarnessPhase("Issuing Clerk ticket sign-in for Google test user...");
  await clerk.signIn({ page, emailAddress: email });
  logHarnessPhase("Clerk ticket sign-in submitted.");
}

export async function expectSignedInClerkState(page: Page): Promise<void> {
  logHarnessPhase("Waiting for Clerk signed-in state...");
  try {
    await page.waitForFunction(() => window.Clerk?.user != null, undefined, {
      timeout: E2E_TIMEOUTS.authMs,
    });
  } catch {
    throw new Error(
      "Google test-user auth: Clerk did not reach a signed-in state. Confirm the Google test user exists in Clerk, environment pairing completed, and Clerk testing setup documented in e2e/README.md.",
    );
  }
  logHarnessPhase("Clerk signed-in state confirmed.");

  const avatar = page.locator(".cl-userButton-root").first();
  await avatar.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.authMs }).catch(async () => {
    await openSettings(page);
    await avatar.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.authMs });
  });
  logHarnessPhase("Clerk user button avatar is visible.");
}
