import { describe, expect, it } from "vite-plus/test";

import { listDescendantPidsFromTable } from "./processTree.ts";

describe("listDescendantPidsFromTable", () => {
  it("walks a multi-level process table", () => {
    const table = ["  10   1", "  20  10", "  21  10", "  30  20", "  99   2"].join("\n");
    expect(listDescendantPidsFromTable(table, 10)).toEqual([20, 21, 30]);
  });

  it("returns an empty list when the root has no children", () => {
    expect(listDescendantPidsFromTable("  10   1\n  20   2\n", 10)).toEqual([]);
  });
});
