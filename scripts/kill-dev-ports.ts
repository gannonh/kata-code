#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - imperative CLI reaper, not an Effect service.
/**
 * Kill Kata Code dev-server node processes listening on the dev port ranges,
 * without touching unrelated node processes elsewhere on the machine.
 *
 * Covers both the web (5733 + offset) and server (13773 + offset) ranges used
 * by `pnpm run dev` and E2E. By default the foreground default ports (web 5733,
 * server 13773) are spared so a running `pnpm run dev` survives; pass `--all`
 * to include them too.
 *
 * This targets listeners by port + the kata-code repo command signature, so it
 * never SIGKILLs an unrelated node process that merely happens to listen in the
 * range.
 *
 *   pnpm run kill-dev-ports          # kill E2E/offset dev servers, spare 5733/13773
 *   pnpm run kill-dev-ports --all    # also kill the default foreground dev server
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const killAll = process.argv.includes("--all");

// Web base 5733 + offset (<=3000) and server base 13773 + offset.
const PORT_RANGES = [
  [5733, 8733],
  [13773, 16773],
];
const SPARED_PORTS = killAll ? new Set<number>() : new Set([5733, 13773]);

function safeExec(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function commandFor(pid: number): string {
  return safeExec("ps", ["-p", String(pid), "-o", "command="]).trim();
}

/**
 * Only kill listeners whose command belongs to this repo's dev tooling: the
 * Vite dev stack, dev-runner, or the dev Electron launch. This guards against
 * killing an unrelated node server that happens to bind a port in the range.
 */
function isKataDevProcess(command: string): boolean {
  if (command.includes("vite-plus-core") && command.includes(repoRoot)) return true;
  if (command.includes("scripts/dev-runner.ts")) return true;
  if (command.includes(`--katacode-dev-root=${repoRoot}/apps/desktop`)) return true;
  if (command.includes("katacode-e2e-home") || command.includes("katacode-e2e-electron-runtime")) {
    return true;
  }
  return false;
}

const selfPid = process.pid;
const targets = new Map<number, string>();

for (const [start, end] of PORT_RANGES) {
  const out = safeExec("lsof", ["-nP", `-iTCP:${start}-${end}`, "-sTCP:LISTEN"]);
  for (const line of out.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/);
    const pid = Number.parseInt(cols[1] ?? "", 10);
    const addr = cols[8] ?? "";
    const port = Number.parseInt(addr.split(":").pop() ?? "", 10);
    if (!Number.isInteger(pid) || pid === selfPid) continue;
    if (Number.isInteger(port) && SPARED_PORTS.has(port)) continue;
    if (targets.has(pid)) continue;
    const command = commandFor(pid);
    if (isKataDevProcess(command)) {
      targets.set(pid, command);
    }
  }
}

if (targets.size === 0) {
  Effect.runSync(
    Console.log(
      killAll
        ? "[kill-dev-ports] No Kata Code dev servers listening on the dev port ranges."
        : "[kill-dev-ports] No Kata Code dev servers found (default ports 5733/13773 spared; pass --all to include them).",
    ),
  );
  process.exit(0);
}

let killed = 0;
for (const [pid, command] of targets) {
  try {
    process.kill(pid, "SIGKILL");
    killed += 1;
    Effect.runSync(Console.log(`[kill-dev-ports] killed pid ${pid}: ${command.slice(0, 100)}`));
  } catch (error) {
    Effect.runSync(
      Console.warn(`[kill-dev-ports] could not kill pid ${pid}: ${(error as Error).message}`),
    );
  }
}

Effect.runSync(Console.log(`[kill-dev-ports] Reaped ${killed} Kata Code dev server process(es).`));
