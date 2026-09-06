import { describe, expect, it } from "vite-plus/test";

import { canShowHostSandboxes } from "./ConnectionsSettings.logic";

describe("Connections sandbox gate", () => {
  it("hides the Sandboxes section when the preview flag is off", () => {
    expect(canShowHostSandboxes({ canManageHostSandboxes: true, enableSandboxes: false })).toBe(
      false,
    );
  });

  it("hides the Sandboxes section when the session cannot manage host sandboxes", () => {
    expect(canShowHostSandboxes({ canManageHostSandboxes: false, enableSandboxes: true })).toBe(
      false,
    );
  });

  it("shows the Sandboxes section when scope and the preview flag are on", () => {
    expect(canShowHostSandboxes({ canManageHostSandboxes: true, enableSandboxes: true })).toBe(
      true,
    );
  });
});
