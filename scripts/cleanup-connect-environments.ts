#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - imperative maintainer CLI, not an Effect service.
// @effect-diagnostics globalConsole:off - prints usage and progress to stdout/stderr.
/**
 * List or bulk-delete Kata Code Connect environment records for the signed-in
 * Connect CLI account.
 *
 * E2E sandbox tests register Connect endpoints against the shared Google test
 * user. Fixture teardown unlinks when it runs, but aborted runs (Ctrl-C, crash)
 * and dispose paths that skip relay unlink leave remnants in the relay.
 *
 * Prerequisites:
 *   1. Build the CLI: `vp run --filter @kata-sh/code-cli build` (or full build)
 *   2. Sign in: `katacode connect login`
 *
 * Usage:
 *   pnpm run kill:connect                         # list
 *   pnpm run kill:connect -- --all --yes          # delete every record
 *   pnpm run kill:connect -- --older-than-hours 1 --yes
 *   pnpm run kill:connect -- --environment env_… --yes
 */
import { execFileSync } from "node:child_process";
import { accessSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bin = join(repoRoot, "apps/server/dist/bin.mjs");

function usage(): never {
  console.log(`Usage: scripts/cleanup-connect-environments.ts [options]

List or remove Kata Code Connect records for the signed-in CLI account.

Options:
  --all                     Delete every Connect record for the account
  --older-than-hours <n>    Delete records linked at least n hours ago
  --environment <id>        Delete one environment id
  --yes                     Confirm deletion without prompting
  --json                    Emit JSON
  --base-dir <path>         KATACODE_HOME override (default: ~/.katacode)
  -h, --help                Show this help

Examples:
  pnpm run kill:connect
  pnpm run kill:connect -- --all --yes
  pnpm run kill:connect -- --older-than-hours 0 --yes
`);
  process.exit(0);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  usage();
}

try {
  accessSync(bin);
} catch {
  console.error(
    `Missing ${bin}. Build the server CLI first:\n  vp run --filter @kata-sh/code-cli build`,
  );
  process.exit(1);
}

const wantsDelete =
  args.includes("--all") || args.includes("--environment") || args.includes("--older-than-hours");

if (wantsDelete && !args.includes("--yes") && !args.includes("--json")) {
  console.error("Refusing to delete without --yes. Re-run with --yes to confirm.");
  process.exit(2);
}

try {
  execFileSync(process.execPath, [bin, "connect", "cleanup", ...args], {
    stdio: "inherit",
    env: process.env,
  });
} catch (error) {
  const code =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : 1;
  process.exit(Number.isInteger(code) && code > 0 ? code : 1);
}
