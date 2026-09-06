import { assert, describe, it } from "@effect/vitest";

import { DEFAULT_SERVER_SETTINGS } from "@kata-sh/code-contracts";

import {
  applySandboxesOverride,
  presentServerSettingsForClient,
  sandboxesEnabled,
} from "./sandboxFeature.ts";

describe("sandbox feature flag", () => {
  it("defaults to the stored setting when the env override is unset", () => {
    assert.equal(sandboxesEnabled(undefined, false), false);
    assert.equal(sandboxesEnabled(undefined, true), true);
  });

  it("lets KATACODE_SANDBOXES override the stored setting", () => {
    assert.equal(sandboxesEnabled(true, false), true);
    assert.equal(sandboxesEnabled(false, true), false);
  });

  it("presents the process override on client-visible settings", () => {
    const stored = { ...DEFAULT_SERVER_SETTINGS, enableSandboxes: false };
    assert.equal(presentServerSettingsForClient(stored, undefined).enableSandboxes, false);
    assert.equal(presentServerSettingsForClient(stored, true).enableSandboxes, true);
    assert.equal(applySandboxesOverride(stored, false).enableSandboxes, false);
  });
});
