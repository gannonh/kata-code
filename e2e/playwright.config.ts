import "./src/config/loadEnv.ts";

import { defineConfig, devices } from "@playwright/test";

import { E2E_TIMEOUTS } from "./src/config/timeouts.ts";
import { isVideoEnabled, readWorkerCount } from "./src/harness/env.ts";
import { resolveE2eRoot } from "./src/harness/artifacts.ts";

const e2eRoot = resolveE2eRoot();

const webUrl = process.env["KATACODE_WEB_URL"] ?? "http://localhost:5733";

const WEB_TEST_IGNORE = /web\/.*\.spec\.ts/;

export default defineConfig({
  testDir: "./tests",
  outputDir: `${e2eRoot}/test-results/playwright`,
  globalTeardown: "./tests/setup/global-teardown.ts",
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
      testIgnore: WEB_TEST_IGNORE,
      timeout: E2E_TIMEOUTS.setupMs,
    },
    {
      name: "desktop-dev",
      testMatch: /.*\.spec\.ts/,
      testIgnore: WEB_TEST_IGNORE,
      dependencies: ["setup"],
      metadata: {
        appTarget: "desktop",
        launchTarget: "dev",
      },
    },
    {
      name: "desktop-release",
      testMatch: /.*\.spec\.ts/,
      testIgnore: WEB_TEST_IGNORE,
      dependencies: ["setup"],
      metadata: {
        appTarget: "desktop",
        launchTarget: "release",
      },
    },
    {
      name: "web-dev",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      metadata: {
        appTarget: "web",
        launchTarget: "dev",
      },
      use: {
        baseURL: webUrl,
      },
    },
  ],
});
