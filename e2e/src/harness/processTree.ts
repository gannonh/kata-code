import { execFileSync } from "node:child_process";

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
  while (queue.length > 0) {
    const next = queue.shift()!;
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
