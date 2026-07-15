import { describe, expect, it } from "vite-plus/test";

import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import { listDescendantPidsFromTable, terminateChildProcessTree } from "./processTree.ts";

describe("listDescendantPidsFromTable", () => {
  it("walks a multi-level process table", () => {
    const table = ["  10   1", "  20  10", "  21  10", "  30  20", "  99   2"].join("\n");
    expect(listDescendantPidsFromTable(table, 10)).toEqual([20, 21, 30]);
  });

  it("returns an empty list when the root has no children", () => {
    expect(listDescendantPidsFromTable("  10   1\n  20   2\n", 10)).toEqual([]);
  });
});

describe("terminateChildProcessTree", () => {
  it("treats signal-terminated children as already exited", async () => {
    const child = Object.assign(new EventEmitter(), {
      // Non-existent PID so signalProcessTree is a no-op.
      pid: 2_147_483_646,
      exitCode: null,
      signalCode: "SIGTERM",
      killed: true,
      kill: () => true,
    }) as unknown as ChildProcess;

    // Must return immediately without waiting the full grace window.
    await expect(terminateChildProcessTree(child, { graceMs: 5_000 })).resolves.toBeUndefined();
  });
});
