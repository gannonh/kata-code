/**
 * Process registry for E2E-spawned dev stacks (dev-runner + its Vite/esbuild
 * descendants), tracked by process-group leader PID.
 *
 * Cleanup normally runs through Playwright fixture teardown, but an aborted run
 * (Ctrl-C, crash, killed command) skips teardown and orphans the spawned
 * stacks. They keep listening on dev ports and consume memory, accumulating
 * across runs. This module installs process-level signal/exit handlers that
 * reap every tracked group so a leaked stack can't survive the harness process.
 */

import { killPids, listDescendantPids } from "./processTree.ts";

const trackedPids = new Set<number>();
let handlersInstalled = false;

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone — nothing to reap.
  }
}

/** Synchronously SIGKILL every tracked process group. Safe to call on exit. */
export function reapAllSpawnedStacks(): void {
  for (const pid of trackedPids) {
    // Snapshot descendants before killing the leader: the dev stack spans
    // multiple process groups (`vp run` re-groups the watched server), and
    // survivors reparent to PID 1 once the leader dies.
    const descendants = listDescendantPids(pid);
    killGroup(pid, "SIGKILL");
    killPids(descendants, "SIGKILL");
  }
  trackedPids.clear();
}

function installHandlersOnce(): void {
  if (handlersInstalled) {
    return;
  }
  handlersInstalled = true;

  // Best-effort synchronous reap on process exit covers normal and most
  // abnormal terminations of the harness/worker process.
  process.once("exit", () => {
    reapAllSpawnedStacks();
  });

  // For signals, reap then re-raise the default so the exit code is correct.
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(signal, () => {
      reapAllSpawnedStacks();
      // Remove our handler and re-send so default termination behavior applies.
      process.kill(process.pid, signal);
    });
  }
}

export function trackSpawnedStack(pid: number): void {
  installHandlersOnce();
  trackedPids.add(pid);
}

export function untrackSpawnedStack(pid: number): void {
  trackedPids.delete(pid);
}
