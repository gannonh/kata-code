import { mkdir } from "node:fs/promises";
import { test as setup } from "@playwright/test";
import { clerkSetup } from "@clerk/testing/playwright";

import { resolveE2eRoot } from "../../src/harness/artifacts.ts";
import { readClerkPrerequisites } from "../../src/harness/env.ts";

setup("prepare local E2E artifact paths", async () => {
  const root = resolveE2eRoot();
  await mkdir(`${root}/.auth`, { recursive: true });
  await mkdir(`${root}/test-results`, { recursive: true });
  await mkdir(`${root}/playwright-report`, { recursive: true });
});

setup("configure Clerk testing when credentials are present", async () => {
  const clerk = readClerkPrerequisites();
  if (!clerk.ok) {
    return;
  }

  await clerkSetup();
});
