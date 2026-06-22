import "./src/config/loadEnv.ts";

import { defineConfig, devices } from "@playwright/test";

import { E2E_TIMEOUTS } from "./src/config/timeouts.ts";
import { isVideoEnabled, readWorkerCount } from "./src/harness/env.ts";
import { resolveE2eRoot } from "./src/harness/artifacts.ts";

const e2eRoot = resolveE2eRoot();

export default defineConfig({
  testDir: "./tests",
  outputDir: `${e2eRoot}/test-results/playwright`,
  fullyParallel: false,
  workers: readWorkerCount(),
  retries: 0,
  timeout: E2E_TIMEOUTS.testMs,
  expect: {
    timeout: E2E_TIMEOUTS.assertionMs,
  },
  reporter: [
    ["list"],
    ["html", { outputFolder: `${e2eRoot}/playwright-report`, open: "never" }],
    ["json", { outputFile: `${e2eRoot}/test-results/results.json` }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: isVideoEnabled() ? "retain-on-failure" : "off",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "setup",
      testMatch: /setup\/.*\.setup\.ts/,
      timeout: E2E_TIMEOUTS.setupMs,
    },
    {
      name: "desktop-dev",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      metadata: {
        launchTarget: "dev",
      },
    },
    {
      name: "desktop-release",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      metadata: {
        launchTarget: "release",
      },
    },
  ],
});
