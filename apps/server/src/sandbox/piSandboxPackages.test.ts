import { describe, expect, it } from "vite-plus/test";

import {
  buildPiPackageInstallCommand,
  filterSandboxInstallablePiPackages,
  readPiPackagesFromSettings,
} from "./piSandboxPackages.ts";

describe("filterSandboxInstallablePiPackages", () => {
  it("keeps npm specs and drops host-only ones", () => {
    // Local specs point at host trees the sandbox cannot resolve; leaving them
    // in settings.json makes the in-container Pi SDK fail at startup.
    expect(
      filterSandboxInstallablePiPackages([
        "npm:pi-anthropic-oauth",
        "file:/Users/host/ext",
        "/Users/host/other-ext",
        42,
      ]),
    ).toEqual(["npm:pi-anthropic-oauth"]);
  });

  it("dedupes repeated specs so install runs once per package", () => {
    expect(
      filterSandboxInstallablePiPackages(["npm:pi-subagents", "npm:pi-subagents", "npm:"]),
    ).toEqual(["npm:pi-subagents"]);
  });
});

describe("readPiPackagesFromSettings", () => {
  it("reads the declared package list", () => {
    expect(
      readPiPackagesFromSettings(
        JSON.stringify({ packages: ["npm:pi-anthropic-oauth", "npm:pi-intercom"] }),
      ),
    ).toEqual(["npm:pi-anthropic-oauth", "npm:pi-intercom"]);
  });

  it("returns nothing for unparseable or package-less settings", () => {
    // A sandbox without extensions still starts, so these are no-ops rather
    // than provisioning failures.
    expect(readPiPackagesFromSettings("{not json")).toEqual([]);
    expect(readPiPackagesFromSettings(JSON.stringify({ theme: "dark" }))).toEqual([]);
    expect(readPiPackagesFromSettings(JSON.stringify({ packages: "npm:x" }))).toEqual([]);
  });
});

describe("buildPiPackageInstallCommand", () => {
  it("installs into the sandbox agent dir the credential seed wrote", () => {
    const command = buildPiPackageInstallCommand({
      packages: ["npm:pi-anthropic-oauth"],
      home: "/home/katacode",
    });

    expect(command).toBe("HOME='/home/katacode' pi install 'npm:pi-anthropic-oauth'");
  });

  it("returns null when nothing is installable so callers skip the exec", () => {
    expect(buildPiPackageInstallCommand({ packages: [], home: "/home/katacode" })).toBeNull();
    expect(
      buildPiPackageInstallCommand({ packages: ["file:/Users/host/ext"], home: "/home/katacode" }),
    ).toBeNull();
  });

  it("quotes specs so shell metacharacters cannot break out of the command", () => {
    const command = buildPiPackageInstallCommand({
      packages: ["npm:evil'; rm -rf /; echo '"],
      home: "/home/katacode",
    });

    expect(command).toBe("HOME='/home/katacode' pi install 'npm:evil'\\''; rm -rf /; echo '\\'''");
  });
});
