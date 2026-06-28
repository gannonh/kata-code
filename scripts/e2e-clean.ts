#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - imperative CLI reaper, not an Effect service.
/**
 * Reap leaked Kata Code E2E dev stacks and dev Electron apps.
 *
 * E2E spawns isolated Vite dev stacks (dev-runner -> @voidzero-dev/vite-plus-core
 * -> esbuild) and Electron apps. They are cleaned up on graceful teardown, but
 * an aborted run (Ctrl-C, crash, killed command) orphans them — they keep
 * listening on dev ports and consuming memory, accumulating across runs.
 *
 * Strategy: find every PID listening on a port in the E2E dev range, plus every
 * process matching the E2E dev-stack / dev-Electron command signature in this
 * repo, and SIGKILL the union. The default dev ports (web 5733, server 13773)
 * are excluded so a foreground `pnpm run dev` is never touched; E2E always runs
 * at an offset (5734+/13774+).
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Default dev ports to spare (a foreground `pnpm run dev` binds these).
const SPARED_PORTS = new Set([5733, 13773]);
// E2E port search ranges (web base 5733, server base 13773; offset >= 1).
const PORT_RANGES = [
  [5734, 5833],
  [13774, 13873],
];

// Command-line markers unique to E2E-spawned processes.
const COMMAND_MARKERS = [
  "katacode-e2e-home",
  "katacode-e2e-electron-runtime",
  `--katacode-dev-root=${repoRoot}/apps/desktop`,
];

function safeExec(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: "utf8" });
  } catch {
    return "";
  }
}

function pidsListeningInRanges(): Set<number> {
  const pids = new Set<number>();
  for (const [start, end] of PORT_RANGES) {
    const out = safeExec("lsof", ["-nP", `-iTCP:${start}-${end}`, "-sTCP:LISTEN"]);
    for (const line of out.split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      const pid = Number.parseInt(cols[1] ?? "", 10);
      const addr = cols[8] ?? "";
      const port = Number.parseInt(addr.split(":").pop() ?? "", 10);
      if (Number.isInteger(pid) && Number.isInteger(port) && !SPARED_PORTS.has(port)) {
        pids.add(pid);
      }
    }
  }
  return pids;
}

function pidsMatchingCommand(): Map<number, string> {
  const matched = new Map<number, string>();
  const out = safeExec("ps", ["-eo", "pid=,command="]);
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1] ?? "", 10);
    const command = match[2];
    if (typeof command !== "string") continue;
    if (COMMAND_MARKERS.some((marker) => command.includes(marker))) {
      matched.set(pid, command);
    }
  }
  return matched;
}

function commandFor(pid: number): string {
  return safeExec("ps", ["-p", String(pid), "-o", "command="]).trim();
}

const selfPid = process.pid;
const byCommand = pidsMatchingCommand();
const byPort = pidsListeningInRanges();

const targets = new Map<number, string>();
for (const [pid, command] of byCommand) {
  if (pid !== selfPid) targets.set(pid, command);
}
for (const pid of byPort) {
  if (pid !== selfPid && !targets.has(pid)) {
    targets.set(pid, commandFor(pid) || "(port listener)");
  }
}

if (targets.size === 0) {
  Effect.runSync(Console.log("[e2e:clean] No leaked E2E dev stacks or Electron apps found."));
  process.exit(0);
}

let killed = 0;
for (const [pid, command] of targets) {
  try {
    process.kill(pid, "SIGKILL");
    killed += 1;
    Effect.runSync(Console.log(`[e2e:clean] killed pid ${pid}: ${command.slice(0, 100)}`));
  } catch (error) {
    Effect.runSync(
      Console.warn(`[e2e:clean] could not kill pid ${pid}: ${(error as Error).message}`),
    );
  }
}

Effect.runSync(Console.log(`[e2e:clean] Reaped ${killed} leaked process(es).`));
