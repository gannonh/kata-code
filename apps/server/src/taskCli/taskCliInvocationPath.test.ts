// @effect-diagnostics nodeBuiltinImport:off -- the PATH shim test inspects the written file on disk.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  ensureTaskCliInvocationPath,
  renderTaskCliShimScript,
  resolveNodeInterpreter,
  resolveTaskCliLaunchTarget,
} from "./taskCliInvocationPath.ts";

describe("task CLI invocation path", () => {
  it("launches the server entry through the current interpreter", () => {
    expect(
      resolveTaskCliLaunchTarget(
        { PATH: "/usr/local/bin" },
        ["node", "/repo/apps/server/dist/bin.mjs"],
        "/usr/local/bin/node",
      ),
    ).toEqual({
      interpreter: "/usr/local/bin/node",
      entry: "/repo/apps/server/dist/bin.mjs",
    });
  });

  it("prefers a PATH node over the Electron binary", () => {
    const pathRoot = mkdtempSync(join(tmpdir(), "kata-task-cli-node-"));
    try {
      const binDir = join(pathRoot, "bin");
      mkdirSync(binDir, { recursive: true });
      const nodePath = join(binDir, "node");
      writeFileSync(nodePath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      expect(
        resolveNodeInterpreter("/App/Kata Code.app/Contents/MacOS/Kata Code", {
          ELECTRON_RUN_AS_NODE: "1",
          PATH: binDir,
        }),
      ).toBe(nodePath);
      expect(
        resolveTaskCliLaunchTarget(
          { ELECTRON_RUN_AS_NODE: "1", PATH: binDir },
          ["electron", "/repo/apps/server/dist/bin.mjs"],
          "/App/Kata Code.app/Contents/MacOS/Kata Code",
        ).interpreter,
      ).toBe(nodePath);
    } finally {
      rmSync(pathRoot, { recursive: true, force: true });
    }
  });

  it("renders a named katacode shim that execs node against the CLI entry", () => {
    const script = renderTaskCliShimScript({
      interpreter: "/usr/local/bin/node",
      entry: "/App/Contents/Resources/server/bin.mjs",
    });
    expect(script).not.toContain("ELECTRON_RUN_AS_NODE");
    expect(script).toContain(
      'exec "/usr/local/bin/node" "/App/Contents/Resources/server/bin.mjs" "$@"',
    );
  });

  it("writes a PATH-visible katacode executable", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "kata-task-cli-path-"));
    try {
      const path = ensureTaskCliInvocationPath({
        stateDir,
        env: { PATH: "/usr/local/bin" },
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
