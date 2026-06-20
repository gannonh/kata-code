import { assert, describe, it } from "@effect/vitest";

import {
  DEFAULT_HOME_DIR_NAME,
  DEFAULT_HOSTED_APP_ORIGIN,
  ENV_PREFIX,
  HOSTED_WEB_CHANNEL_PATH,
  WORKTREE_BRANCH_PREFIX,
  envKey,
  formatAppDisplayName,
  resolveAppBranding,
  resolveDefaultKatacodeHome,
  resolveLegacyUserDataDirNames,
} from "./branding.ts";

describe("branding", () => {
  it("exposes canonical identity constants", () => {
    assert.equal(DEFAULT_HOME_DIR_NAME, ".katacode");
    assert.equal(ENV_PREFIX, "KATACODE_");
    assert.equal(WORKTREE_BRANCH_PREFIX, "katacode");
    assert.equal(DEFAULT_HOSTED_APP_ORIGIN, "https://app.kata.sh");
    assert.equal(HOSTED_WEB_CHANNEL_PATH, "/__katacode/channel");
    assert.equal(envKey("HOME"), "KATACODE_HOME");
  });

  it("resolves the default home directory", () => {
    assert.equal(resolveDefaultKatacodeHome("/Users/alice"), "/Users/alice/.katacode");
  });

  it("builds display names from stage labels", () => {
    assert.equal(formatAppDisplayName("Dev"), "Kata Code (Dev)");
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
  });

  it("includes fork pre-rebrand userData folder names", () => {
    assert.deepEqual(
      resolveLegacyUserDataDirNames({
        isDevelopment: false,
        appVersion: "0.0.27",
      }),
      ["Kata Code (Alpha)", "KataCode (Alpha)"],
    );
  });
});
