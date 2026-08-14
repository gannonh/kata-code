// @effect-diagnostics nodeBuiltinImport:off - deletion search reads the live source tree.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

const DELETED_PATHS = [
  "apps/server/src/taskWorkspace/TaskStageBridge.ts",
  "apps/server/src/mcp/toolkits/taskStage/tools.ts",
  "apps/server/src/mcp/toolkits/taskStage/handlers.ts",
] as const;

const SEARCH_ROOTS = [
  "apps/server/src",
  "apps/web/src",
  "packages/contracts/src",
  "packages/client-runtime/src",
  "e2e",
] as const;

const FORBIDDEN = [
  /task_stage_context/u,
  /task_stage_complete/u,
  /TaskStageBridge/u,
  /mcp\/toolkits\/taskStage/u,
  /has\("task-stage"\)/u,
];

const collectSourceFiles = (dir: string, acc: string[]): void => {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "taskStageMcpDeleted.test.ts") {
      continue;
    }
    const full = NodePath.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (/\.(?:[cm]?js|tsx?)$/u.test(entry)) acc.push(full);
  }
};

describe("Task-stage MCP deletion", () => {
  it("removes the planning MCP bridge, toolkit, and capability registration", () => {
    for (const relative of DELETED_PATHS) {
      expect(existsSync(NodePath.join(repoRoot, relative))).toBe(false);
    }

    const capabilitySource = readFileSync(
      NodePath.join(repoRoot, "apps/server/src/mcp/McpInvocationContext.ts"),
      "utf8",
    );
    expect(capabilitySource).toContain('"preview" | "task-implementation"');
    expect(capabilitySource).not.toContain('"task-stage"');

    const httpSource = readFileSync(
      NodePath.join(repoRoot, "apps/server/src/mcp/McpHttpServer.ts"),
      "utf8",
    );
    expect(httpSource).toContain("TaskImplementationToolkit");
    expect(httpSource).not.toMatch(/TaskStageToolkit|taskStage\/tools|task_stage_/u);

    const hits: string[] = [];
    for (const root of SEARCH_ROOTS) {
      const files: string[] = [];
      collectSourceFiles(NodePath.join(repoRoot, root), files);
      for (const file of files) {
        const text = readFileSync(file, "utf8");
        if (FORBIDDEN.some((pattern) => pattern.test(text))) {
          hits.push(NodePath.relative(repoRoot, file));
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
