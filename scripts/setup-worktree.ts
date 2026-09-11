// @effect-diagnostics nodeBuiltinImport:off - worktree bootstrap, runs before any Effect runtime exists.
/**
 * Worktree setup for t3.json's single `runOnWorktreeCreate` action. Runs from
 * the new worktree's root under the env `projectScriptRuntimeEnv()` exports.
 * Node keeps this identical on every platform; a shell command would need one
 * variant per shell and `setupProjectScript()` only ever selects one action.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

if (!process.env.KATACODE_PROJECT_ROOT) {
  throw new Error("KATACODE_PROJECT_ROOT is not set; run this from a Kata Code worktree setup.");
}

const DOTENV_LEFTOVERS = [".env", ".env.local", NodePath.join("infra", "relay", ".env")] as const;

// oxlint-disable-next-line kata-code/no-global-process-runtime -- Bootstrap targets the actual host; no Effect runtime exists yet.
const shell = process.platform === "win32";

function run(command: string, args: ReadonlyArray<string>) {
  const result = NodeChildProcess.spawnSync(command, args, { stdio: "inherit", shell });
  if (result.status === 0) return;
  throw new Error(
    `[setup-worktree] '${[command, ...args].join(" ")}' exited with ${result.status ?? result.signal}`,
  );
}

run("vp", ["i"]);

for (const relativePath of DOTENV_LEFTOVERS) {
  NodeFS.rmSync(NodePath.resolve(relativePath), { force: true });
}

run("node", [NodePath.join("apps", "web", "scripts", "warm-dep-cache.ts")]);
