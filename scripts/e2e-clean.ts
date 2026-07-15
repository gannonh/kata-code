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
import { setTimeout as delay } from "node:timers/promises";

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

function isLeakedManagedCloudflared(command: string): boolean {
  return command.includes("/.katacode/tools/cloudflared/") && /\btunnel\s+run\b/.test(command);
}

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
    if (
      COMMAND_MARKERS.some((marker) => command.includes(marker)) ||
      isLeakedManagedCloudflared(command)
    ) {
      matched.set(pid, command);
    }
  }
  return matched;
}

function commandFor(pid: number): string {
  return safeExec("ps", ["-p", String(pid), "-o", "command="]).trim();
}

const selfPid = process.pid;

function collectTargets(): Map<number, string> {
  const targets = new Map<number, string>();
  for (const [pid, command] of pidsMatchingCommand()) {
    if (pid !== selfPid) targets.set(pid, command);
  }
  for (const pid of pidsListeningInRanges()) {
    if (pid !== selfPid && !targets.has(pid)) {
      targets.set(pid, commandFor(pid) || "(port listener)");
    }
  }
  return targets;
}

const killedPids = new Set<number>();

function killTarget(pid: number, command: string): void {
  try {
    // Try the process group first (negative PID) so detached descendants
    // (esbuild workers, Vite children) are reaped alongside the leader. Fall
    // back to the single PID for standalone processes that aren't group
    // leaders.
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      process.kill(pid, "SIGKILL");
    }
    if (!killedPids.has(pid)) {
      killedPids.add(pid);
      Effect.runSync(Console.log(`[e2e:clean] killed pid ${pid}: ${command.slice(0, 100)}`));
    }
  } catch {
    // The process exited between discovery and the kill.
  }
}

// A process-group kill is asynchronous, and orphaned Vite children can become
// visible only after their dev-runner parent exits. Sweep until the managed
// process set stays empty so the next E2E stack cannot race a draining listener.
for (let attempt = 0; attempt < 50; attempt += 1) {
  const targets = collectTargets();
  if (targets.size === 0) break;

  for (const [pid, command] of targets) {
    killTarget(pid, command);
  }
  await delay(100);
}

const remaining = collectTargets();
if (remaining.size > 0) {
  Effect.runSync(
    Console.warn(`[e2e:clean] ${remaining.size} managed process(es) still remain after 5s.`),
  );
  process.exitCode = 1;
} else if (killedPids.size === 0) {
  Effect.runSync(Console.log("[e2e:clean] No leaked E2E dev stacks or Electron apps found."));
} else {
  Effect.runSync(Console.log(`[e2e:clean] Reaped ${killedPids.size} leaked process(es).`));
}
