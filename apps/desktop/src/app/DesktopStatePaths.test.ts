import { assert, describe, it } from "@effect/vitest";

import { desktopLegacyUserDataDirName, resolveDesktopUserDataPath } from "./DesktopStatePaths.ts";

describe("DesktopStatePaths userData helpers", () => {
  const joinPath = (...parts: string[]) => parts.join("/");

  it("names legacy userData directories from development mode", () => {
    assert.equal(desktopLegacyUserDataDirName(true), "Kata Code (Dev)");
    assert.equal(desktopLegacyUserDataDirName(false), "Kata Code (Alpha)");
  });

  it("prefers an existing legacy userData directory", () => {
    const path = resolveDesktopUserDataPath({
      appDataDirectory: "/tmp/app-data",
      exists: (candidate) => candidate === "/tmp/app-data/Kata Code (Alpha)",
      isDevelopment: false,
      joinPath,
      legacyUserDataDirName: "Kata Code (Alpha)",
      userDataDirName: "katacode",
    });

    assert.equal(path, "/tmp/app-data/Kata Code (Alpha)");
  });

  it("falls back to the canonical userData directory", () => {
    const path = resolveDesktopUserDataPath({
      appDataDirectory: "/tmp/app-data",
      exists: () => false,
      isDevelopment: false,
      joinPath,
      legacyUserDataDirName: "Kata Code (Alpha)",
      userDataDirName: "katacode",
    });

    assert.equal(path, "/tmp/app-data/katacode");
  });
});
