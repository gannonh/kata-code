// @effect-diagnostics nodeBuiltinImport:off - this test scans the repository source tree.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

const repositoryRoot = NodePath.resolve(
  NodeURL.fileURLToPath(new URL("../../../../", import.meta.url)),
);
const scannedRoots = [
  "packages/contracts/src",
  "packages/client-runtime/src",
  "apps/server/src/environment",
  "apps/web/src/environments",
] as const;

function sourceFiles(directory: string): ReadonlyArray<string> {
  return NodeFS.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = NodePath.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

it("keeps Sandbox package imports out of shared contracts and environment consumers", () => {
  const offenders = scannedRoots.flatMap((root) =>
    sourceFiles(NodePath.join(repositoryRoot, root)).filter((path) =>
      NodeFS.readFileSync(path, "utf8").includes("@kata-sh/code-kata-sandbox"),
    ),
  );

  assert.deepEqual(offenders, []);
});
