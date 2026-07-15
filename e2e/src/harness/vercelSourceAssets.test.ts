import { describe, expect, it, vi } from "vitest";

import {
  assertVercelSourceAssetBudget,
  inspectSmallVercelSource,
  summarizeVercelGitTree,
  VERCEL_E2E_SOURCE_MAX_BYTES,
} from "./vercelSourceAssets.ts";

describe("summarizeVercelGitTree", () => {
  it("counts only checked-out file blobs", () => {
    expect(
      summarizeVercelGitTree({
        truncated: false,
        tree: [
          { path: "src/index.ts", type: "blob", size: 120 },
          { path: "src", type: "tree" },
          { path: "README.md", type: "blob", size: 80 },
        ],
      }),
    ).toEqual({ bytes: 200, files: 2 });
  });

  it("fails when GitHub truncates the recursive tree", () => {
    expect(() => summarizeVercelGitTree({ truncated: true, tree: [] })).toThrow("GitHub truncated");
  });
});

describe("assertVercelSourceAssetBudget", () => {
  it("rejects a source tree above the fixed Vercel E2E budget", () => {
    expect(() =>
      assertVercelSourceAssetBudget({
        bytes: VERCEL_E2E_SOURCE_MAX_BYTES + 1,
        files: 1,
      }),
    ).toThrow("exceeds the Vercel E2E source limit");
  });
});

describe("inspectSmallVercelSource", () => {
  it("measures the selected branch before accepting it", async () => {
    const runGh = vi.fn(async () =>
      JSON.stringify({
        truncated: false,
        tree: [{ path: "README.md", type: "blob", size: 42 }],
      }),
    );

    await expect(
      inspectSmallVercelSource({ repository: "gannonh/uat-vercel", branch: "master" }, { runGh }),
    ).resolves.toEqual({ bytes: 42, files: 1, branch: "master" });
    expect(runGh).toHaveBeenCalledWith([
      "api",
      "repos/gannonh/uat-vercel/git/trees/master?recursive=1",
    ]);
  });

  it("resolves and measures the repository default branch", async () => {
    const runGh = vi
      .fn<(args: ReadonlyArray<string>) => Promise<string>>()
      .mockResolvedValueOnce(JSON.stringify({ default_branch: "main" }))
      .mockResolvedValueOnce(JSON.stringify({ truncated: false, tree: [] }));

    await expect(
      inspectSmallVercelSource({ repository: "gannonh/uat-vercel", branch: undefined }, { runGh }),
    ).resolves.toEqual({ bytes: 0, files: 0, branch: "main" });
    expect(runGh.mock.calls).toEqual([
      [["api", "repos/gannonh/uat-vercel"]],
      [["api", "repos/gannonh/uat-vercel/git/trees/main?recursive=1"]],
    ]);
  });
});
