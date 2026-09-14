// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { expect, it } from "@effect/vitest";

import { loadFffNode } from "./loadFffNode.ts";

it("loads FileFinder through the patched require export", async () => {
  const loaded = await loadFffNode();
  expect(typeof loaded.FileFinder.create).toBe("function");
});

it("falls back to import when package exports block require", async () => {
  const requireFn = () => {
    const error = new Error("Package path not exported") as Error & { code: string };
    error.code = "ERR_PACKAGE_PATH_NOT_EXPORTED";
    throw error;
  };

  const loaded = await loadFffNode(requireFn);
  expect(typeof loaded.FileFinder.create).toBe("function");
});

it("does not emit an ESM import of fff-node for the SEA scanner", () => {
  const source = NodeFS.readFileSync(
    NodeURL.fileURLToPath(new URL("./loadFffNode.ts", import.meta.url)),
    "utf8",
  );
  expect(source).toContain('["@ff-labs", "fff-node"].join("/")');
  expect(source).toContain("return import(FFF_NODE_SPECIFIER)");
  expect(source).not.toMatch(/(?:^|\n)import\s+(?!type\s).*@ff-labs\/fff-node/);
});
