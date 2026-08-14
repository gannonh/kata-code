// @effect-diagnostics nodeBuiltinImport:off -- the PATH shim test inspects the written file on disk.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  ensureTaskCliInvocationPath,
  renderTaskCliShimScript,
  resolveTaskCliLaunchTarget,
} from "./taskCliInvocationPath.ts";

describe("task CLI invocation path", () => {
  it("launches the server entry through the current interpreter", () => {
    expect(
      resolveTaskCliLaunchTarget(
        {},
        ["node", "/repo/apps/server/dist/bin.mjs"],
        "/usr/local/bin/node",
      ),
    ).toEqual({
      interpreter: "/usr/local/bin/node",
      entry: "/repo/apps/server/dist/bin.mjs",
      needsElectronNode: false,
    });
  });

  it("renders a named katacode shim that execs Electron in Node mode", () => {
    const script = renderTaskCliShimScript({
      interpreter: "/App/Kata Code.app/Contents/MacOS/Kata Code",
      entry: "/App/Kata Code.app/Contents/Resources/server/bin.mjs",
      needsElectronNode: true,
    });
    expect(script).toContain("export ELECTRON_RUN_AS_NODE=1");
    expect(script).toContain('exec "/App/Kata Code.app/Contents/MacOS/Kata Code"');
    expect(script).toContain('"/App/Kata Code.app/Contents/Resources/server/bin.mjs" "$@"');
  });

  it("writes a PATH-visible katacode executable", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "kata-task-cli-path-"));
    try {
      const path = ensureTaskCliInvocationPath({
        stateDir,
        env: {},
        argv: ["node", "/repo/apps/server/dist/bin.mjs"],
        execPath: "/usr/local/bin/node",
      });
      expect(path.executablePath).toBe(join(stateDir, "bin", "katacode"));
      expect(path.pathPrepend).toEqual([join(stateDir, "bin")]);
      expect(readFileSync(path.executablePath, "utf8")).toContain(
        'exec "/usr/local/bin/node" "/repo/apps/server/dist/bin.mjs" "$@"',
      );
    } finally {
      rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
