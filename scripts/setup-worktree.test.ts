// @effect-diagnostics nodeBuiltinImport:off - Runs the real setup script against a disposable worktree.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import { expect, it } from "vite-plus/test";

import { symlinksSupported } from "@kata-sh/code-shared/testing/symlinks";

const script = NodePath.join(import.meta.dirname, "setup-worktree.ts");

function runSetup(worktree: string, env: Record<string, string>) {
  return NodeChildProcess.spawnSync(NodeProcess.execPath, [script], {
    cwd: worktree,
    env: { ...NodeProcess.env, ...env },
    encoding: "utf8",
  });
}

// oxlint-disable-next-line kata-code/no-global-process-runtime -- Skip decision about the actual host; the script under test has no Effect runtime.
it.skipIf(!symlinksSupported || NodeOS.platform() === "win32")(
  "links shared env files from KATACODE_PROJECT_ROOT",
  () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "setup-worktree-"));
    const projectRoot = NodePath.join(root, "project");
    const worktree = NodePath.join(root, "worktree");
    const bin = NodePath.join(root, "bin");
    const write = (file: string, content: string, mode?: number) => {
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, content, mode === undefined ? {} : { mode });
    };
    try {
      write(NodePath.join(projectRoot, ".env"), "ROOT=1\n");
      write(NodePath.join(projectRoot, "infra", "relay", ".env"), "RELAY=1\n");
      write(NodePath.join(worktree, ".env"), "stale\n");
      write(
        NodePath.join(bin, "vp"),
        `#!/bin/sh\nprintf '%s\\n' "$*" >> "${NodePath.join(root, "vp-calls")}"\n`,
        0o755,
      );
      write(
        NodePath.join(worktree, "apps", "web", "scripts", "warm-dep-cache.ts"),
        `import * as fs from "node:fs"; fs.writeFileSync(${JSON.stringify(NodePath.join(root, "warmed"))}, "");`,
      );

      const env = {
        KATACODE_PROJECT_ROOT: projectRoot,
        PATH: `${bin}${NodePath.delimiter}${NodeProcess.env.PATH ?? ""}`,
      };
      for (const attempt of [1, 2]) {
        const result = runSetup(worktree, env);
        expect(result.status, `attempt ${attempt}: ${result.stderr}`).toBe(0);
      }

      expect(NodeFS.readFileSync(NodePath.join(root, "vp-calls"), "utf8")).toBe("i\ni\n");
      expect(NodeFS.existsSync(NodePath.join(root, "warmed"))).toBe(true);
      for (const relativePath of [".env", NodePath.join("infra", "relay", ".env")]) {
        const link = NodePath.join(worktree, relativePath);
        expect(NodeFS.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(NodeFS.readlinkSync(link)).toBe(NodePath.join(projectRoot, relativePath));
      }

      const unset = runSetup(worktree, { ...env, KATACODE_PROJECT_ROOT: "" });
      expect(unset.status).not.toBe(0);
      expect(unset.stderr).toContain("KATACODE_PROJECT_ROOT");
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);
