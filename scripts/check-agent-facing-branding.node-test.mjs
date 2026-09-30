import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";

const script = NodeURL.fileURLToPath(new URL("./check-agent-facing-branding.mjs", import.meta.url));

for (const [path, contents, expectedStatus] of [
  [
    "apps/server/src/mcp/toolkits/device/handlers.ts",
    'const text = "Arrange builds yourself. T3 provides discovery.";',
    1,
  ],
  [
    "apps/server/src/mcp/toolkits/preview/tools.ts",
    'const text = "Use the `t3-code` toolkit, T3_HOME, or https://t3.chat";',
    0,
  ],
  ["apps/server/src/mcp/toolkits/device/handlers.test.ts", 'const text = "T3 provides";', 0],
  ["apps/server/src/other/copy.ts", 'const text = "T3 provides discovery.";', 0],
]) {
  NodeTest.test(`agent-facing branding scope: ${path} exits ${expectedStatus}`, () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-agent-branding-"));
    try {
      const file = NodePath.join(root, path);
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, contents);
      const result = NodeChildProcess.spawnSync(process.execPath, [script, root], {
        encoding: "utf8",
      });
      NodeAssert.equal(result.status, expectedStatus, result.stderr);
      if (expectedStatus === 1) NodeAssert.ok(result.stderr.includes(`${path}:1:`));
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
}

NodeTest.test("passes the current repository", () => {
  const result = NodeChildProcess.spawnSync(process.execPath, [script], { encoding: "utf8" });
  NodeAssert.equal(result.status, 0, result.stderr);
});
