import { mkdir } from "node:fs/promises";
import { test as setup } from "@playwright/test";
import { clerkSetup } from "@clerk/testing/playwright";

import { resolveE2eRoot, resolveRepoRoot } from "../../src/harness/artifacts.ts";
import { cleanupStaleDesktopDevApps } from "../../src/harness/cleanupStaleDesktopDev.ts";
import { readClerkPrerequisites } from "../../src/harness/env.ts";

setup("prepare local E2E artifact paths", async () => {
  const root = resolveE2eRoot();
  await mkdir(`${root}/.auth`, { recursive: true });
  await mkdir(`${root}/test-results`, { recursive: true });
  await mkdir(`${root}/playwright-report`, { recursive: true });
});

// Runs once before any worker spawns, so the broad pkill can't cross-kill a
// concurrent worker's Electron (each worker launches its own app later).
setup("clean up stale desktop dev apps from prior runs", async () => {
  cleanupStaleDesktopDevApps(resolveRepoRoot());
});

setup("configure Clerk testing when credentials are present", async () => {
  const clerk = readClerkPrerequisites();
  if (!clerk.ok) {
    return;
  }

  // `loadEnv.ts` has already applied the repository `.env`; keep Clerk from
  // loading `.env.local` behind the harness's back.
  await clerkSetup({ dotenv: false });
});
