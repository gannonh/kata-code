import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";

const script = NodeURL.fileURLToPath(new URL("./check-product-branding.mjs", import.meta.url));

for (const copy of [
  "T3 Connect",
  "T3 Code",
  "T3\nCode",
  "T3 Server",
  "T3 account",
  "T3 threads",
  "T3 preview",
  "T3 with sudo",
]) {
  NodeTest.test(`rejects new product copy: ${JSON.stringify(copy)}`, () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-branding-"));
    try {
      NodeFS.mkdirSync(NodePath.join(root, "apps/web/src/new-feature"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(root, "apps/web/src/new-feature/BrandNew.tsx"),
        `<h1>${copy}</h1>`,
      );
      const result = NodeChildProcess.spawnSync(process.execPath, [script, root], {
        encoding: "utf8",
      });
      NodeAssert.equal(result.status, 1);
      NodeAssert.match(result.stderr, /apps\/web\/src\/new-feature\/BrandNew.tsx:1:/);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
}

NodeTest.test("preserves internal identifiers, attribution, and excluded marketing", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-branding-"));
  try {
    NodeFS.mkdirSync(NodePath.join(root, "packages/shared/src"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "packages/shared/src/identity.ts"),
      `
      const T3ConnectClient = "t3code:session";
      const schema = "t3.json";
      const theme = "T3 Chat";
      const url = "https://t3.codes/legal";
    `,
    );
    NodeFS.mkdirSync(NodePath.join(root, "apps/marketing/src"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "apps/marketing/src/copy.ts"),
      'const title = "T3 Code";',
    );
    const result = NodeChildProcess.spawnSync(process.execPath, [script, root], {
      encoding: "utf8",
    });
    NodeAssert.equal(result.status, 0, result.stderr);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

NodeTest.test("passes the current repository with its exact comment exceptions", () => {
  const result = NodeChildProcess.spawnSync(process.execPath, [script], { encoding: "utf8" });
  NodeAssert.equal(result.status, 0, result.stderr);
});

NodeTest.test("does not exempt new copy elsewhere in an excepted file", () => {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-branding-"));
  try {
    NodeFS.mkdirSync(NodePath.join(root, "packages/contracts/src"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(root, "packages/contracts/src/browserImport.ts"),
      `
      /** T3 Code profile the cookies are written into. */
      const title = "T3 Code";
    `,
    );
    const result = NodeChildProcess.spawnSync(process.execPath, [script, root], {
      encoding: "utf8",
    });
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(result.stderr, /browserImport.ts:3:/);
    NodeAssert.doesNotMatch(result.stderr, /browserImport.ts:2:/);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
});

for (const [path, expectedStatus] of [
  ["native/kde-snap-shot/src/feedback.qml", 1],
  ["apps/web/src/test/reactElementTree.ts", 0],
  ["apps/web/test/environmentHttpTest.ts", 0],
  ["native/kde-snap-shot/tests/qml/feedback.qml", 0],
  ["native/browser-secret/test.c", 0],
  ["apps/web/src/test-product.ts", 1],
  ["apps/web/src/latest/copy.ts", 1],
]) {
  NodeTest.test(`branding scan scope: ${path}`, () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-branding-"));
    try {
      const file = NodePath.join(root, path);
      NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
      NodeFS.writeFileSync(file, 'const title = "T3 Code";');
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
