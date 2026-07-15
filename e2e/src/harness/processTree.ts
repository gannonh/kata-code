import { type ChildProcess, execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Snapshot every live descendant PID of `rootPid` (recursive ppid walk).
 *
 * The dev stack tree spans multiple process groups (`vp run` places the
 * watched server in its own group), so a group signal on the spawned leader
 * misses part of the tree. The snapshot must be taken while the tree is still
 * rooted — once the leader dies, orphans reparent to PID 1 and become
 * undiscoverable.
 */
export function listDescendantPids(rootPid: number): readonly number[] {
  let table: string;
  try {
    table = execFileSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" });
  } catch {
    return [];
  }
  return listDescendantPidsFromTable(table, rootPid);
}

/** Pure table walk used by {@link listDescendantPids} (exported for unit tests). */
export function listDescendantPidsFromTable(table: string, rootPid: number): readonly number[] {
  const childrenByParent = new Map<number, number[]>();
  for (const line of table.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number.parseInt(match[1]!, 10);
    const ppid = Number.parseInt(match[2]!, 10);
    const siblings = childrenByParent.get(ppid);
    if (siblings) siblings.push(pid);
    else childrenByParent.set(ppid, [pid]);
  }
  const descendants: number[] = [];
  const queue = [rootPid];
  for (let index = 0; index < queue.length; index += 1) {
    const next = queue[index]!;
    for (const childPid of childrenByParent.get(next) ?? []) {
      descendants.push(childPid);
      queue.push(childPid);
    }
  }
  return descendants;
}

/** SIGNAL a list of PIDs, ignoring processes that already exited. */
export function killPids(pids: readonly number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Already gone.
    }
  }
}

/** Signal a process group by negative PID, ignoring "no such process". */
export function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone, or never created (spawn failed) — nothing to reap.
  }
}

/**
 * Snapshot → group signal → descendant signal. Callers that escalate after a
 * grace window should invoke this again so children spawned during the grace
 * period are included in the escalate pass.
 */
export function signalProcessTree(rootPid: number, signal: NodeJS.Signals): void {
  const descendants = listDescendantPids(rootPid);
  signalProcessGroup(rootPid, signal);
  if (signal === "SIGKILL") {
    try {
      process.kill(rootPid, "SIGKILL");
    } catch {
      // The group kill already reaped the direct child.
    }
  }
  killPids(descendants, signal);
}

export interface TerminateProcessTreeOptions {
  readonly graceMs?: number;
}

/**
 * Canonical harness terminator: SIGTERM the tree, wait up to `graceMs`, then
 * re-snapshot and SIGKILL. Re-snapshotting before escalate catches children
 * spawned under surviving multi-group Vite/`vp` trees during the grace window.
 */
export async function terminateProcessTree(
  rootPid: number,
  options: TerminateProcessTreeOptions = {},
): Promise<void> {
  const graceMs = options.graceMs ?? 5_000;
  signalProcessTree(rootPid, "SIGTERM");
  await delay(graceMs);
  signalProcessTree(rootPid, "SIGKILL");
}

/**
 * Terminate a ChildProcess with the same tree policy as {@link terminateProcessTree}.
 * Falls back to `child.kill` when the PID was never assigned.
 */
export async function terminateChildProcessTree(
  child: ChildProcess,
  options: TerminateProcessTreeOptions = {},
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) {
    if (!child.killed) {
      child.kill("SIGKILL");
    }
    return;
  }

  if (child.exitCode !== null || child.signalCode !== null) {
    // Direct child already exited (code or signal); still reap detached descendants.
    signalProcessTree(pid, "SIGKILL");
    return;
  }

  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const graceMs = options.graceMs ?? 5_000;
  signalProcessTree(pid, "SIGTERM");
  await Promise.race([exited, delay(graceMs)]);

  // Always escalate: the leader can exit on SIGTERM while descendants in other
  // process groups survive and leak listeners onto subsequent stack boots.
  signalProcessTree(pid, "SIGKILL");

  // Teardown must remain bounded even if Node never observes the detached
  // child's exit event after a forced process-group kill.
  await Promise.race([exited, delay(1_000)]);
}
