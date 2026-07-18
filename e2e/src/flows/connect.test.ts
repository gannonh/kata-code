import { describe, expect, it } from "vite-plus/test";

import { buildConnectEnvironmentCleanupArgs } from "./connect.ts";

describe("buildConnectEnvironmentCleanupArgs", () => {
  it("targets only the environment created by the current run", () => {
    const args = buildConnectEnvironmentCleanupArgs(
      "environment-e2e-run",
      "/tmp/katacode-e2e-home",
    );

    expect(args).toEqual([
      "cleanup",
      "--environment",
      "environment-e2e-run",
      "--yes",
      "--base-dir",
      "/tmp/katacode-e2e-home",
    ]);
    expect(args).not.toContain("--all");
    expect(args).not.toContain("--older-than-hours");
  });
});
