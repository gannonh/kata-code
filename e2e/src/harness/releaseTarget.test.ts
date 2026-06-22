import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveReleaseExecutablePath } from "./releaseTarget.ts";

describe("resolveReleaseExecutablePath", () => {
  const previous = process.env.KATACODE_E2E_RELEASE_APP;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.KATACODE_E2E_RELEASE_APP;
    } else {
      process.env.KATACODE_E2E_RELEASE_APP = previous;
    }
  });

  it("fails with a setup message when no release app path is configured", () => {
    delete process.env.KATACODE_E2E_RELEASE_APP;

    expect(() => resolveReleaseExecutablePath()).toThrow(/KATACODE_E2E_RELEASE_APP/i);
  });

  it("resolves the macOS executable inside a supplied .app bundle", () => {
    const bundleRoot = mkdtempSync(join(tmpdir(), "kata-e2e-release-"));
    const contentsMacOs = join(bundleRoot, "Contents", "MacOS");
    mkdirSync(contentsMacOs, { recursive: true });
    const executablePath = join(contentsMacOs, "Kata Code");
    writeFileSync(executablePath, "#!/bin/sh\n", "utf8");

    process.env.KATACODE_E2E_RELEASE_APP = bundleRoot;

    expect(resolveReleaseExecutablePath()).toBe(executablePath);
  });
});
