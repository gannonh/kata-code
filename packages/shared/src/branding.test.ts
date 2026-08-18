import { assert, describe, it } from "@effect/vitest";

import {
  APP_BASE_NAME,
  DEFAULT_HOME_DIR_NAME,
  DEFAULT_HOSTED_APP_ORIGIN,
  DESKTOP_BUNDLE_ID,
  DESKTOP_BUNDLE_ID_DEV_PREFIX,
  ENV_PREFIX,
  HOSTED_WEB_CHANNEL_PATH,
  HOSTED_WEB_LATEST_ORIGIN,
  HOSTED_WEB_NIGHTLY_ORIGIN,
  PROTOCOL_SCHEME,
  PROTOCOL_SCHEME_DEV,
  PROTOCOL_SCHEME_PREVIEW,
  WORKTREE_BRANCH_PREFIX,
  envKey,
  formatAppDisplayName,
  resolveAppBranding,
  resolveDefaultKatacodeHome,
  resolveServerBackedAppDisplayName,
  resolveServerBackedAppStageLabel,
} from "./branding.ts";

describe("branding", () => {
  it("exposes canonical identity constants", () => {
    assert.equal(APP_BASE_NAME, "Kata Code");
    assert.equal(DEFAULT_HOME_DIR_NAME, ".katacode");
    assert.equal(ENV_PREFIX, "KATACODE_");
    assert.equal(WORKTREE_BRANCH_PREFIX, "katacode");
    assert.equal(PROTOCOL_SCHEME, "katacode");
    assert.equal(PROTOCOL_SCHEME_DEV, "katacode-dev");
    assert.equal(PROTOCOL_SCHEME_PREVIEW, "katacode-preview");
    assert.equal(DESKTOP_BUNDLE_ID, "com.katacode.app");
    assert.equal(DESKTOP_BUNDLE_ID_DEV_PREFIX, "com.katacode.dev");
    assert.equal(DEFAULT_HOSTED_APP_ORIGIN, "https://app.kata.sh");
    assert.equal(HOSTED_WEB_LATEST_ORIGIN, "https://latest.app.kata.sh");
    assert.equal(HOSTED_WEB_NIGHTLY_ORIGIN, "https://nightly.app.kata.sh");
    assert.equal(HOSTED_WEB_CHANNEL_PATH, "/__katacode/channel");
    assert.equal(envKey("HOME"), "KATACODE_HOME");
  });

  it("resolves the default home directory", () => {
    assert.equal(resolveDefaultKatacodeHome("/Users/alice"), "/Users/alice/.katacode");
  });

  it("omits the Latest stage from the display name", () => {
    assert.equal(
      formatAppDisplayName({ baseName: "Kata Code", stageLabel: "Latest" }),
      "Kata Code",
    );
    assert.equal(
      formatAppDisplayName({ baseName: "Kata Code", stageLabel: "Dev" }),
      "Kata Code (Dev)",
    );
  });

  it("resolves app branding for hosted and desktop contexts", () => {
    assert.deepEqual(
      resolveAppBranding({
        isDevelopment: false,
        appVersion: "0.0.27",
        hostedAppChannel: "nightly",
      }),
      {
        baseName: "Kata Code",
        stageLabel: "Nightly",
        displayName: "Kata Code (Nightly)",
      },
    );
    assert.deepEqual(
      resolveAppBranding({
        isDevelopment: false,
        appVersion: "0.0.27",
        hostedAppChannel: "latest",
      }),
      {
        baseName: "Kata Code",
        stageLabel: "Latest",
        displayName: "Kata Code",
      },
    );
    assert.deepEqual(
      resolveAppBranding({
        isDevelopment: true,
        appVersion: "0.0.27",
      }),
      {
        baseName: "Kata Code",
        stageLabel: "Dev",
        displayName: "Kata Code (Dev)",
      },
    );
  });

  it("keeps server-backed nightly stage helpers", () => {
    assert.equal(
      resolveServerBackedAppStageLabel({
        primaryServerVersion: "0.0.28-nightly.20260616.12",
        fallbackStageLabel: "Alpha",
      }),
      "Nightly",
    );
    assert.equal(
      resolveServerBackedAppDisplayName({
        baseName: "Kata Code",
        fallbackDisplayName: "Kata Code (Alpha)",
        fallbackStageLabel: "Alpha",
        primaryServerVersion: "0.0.28-nightly.20260616.12",
      }),
      "Kata Code (Nightly)",
    );
  });
});
