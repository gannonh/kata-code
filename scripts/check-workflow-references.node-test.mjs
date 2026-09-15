#!/usr/bin/env node
import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeTest from "node:test";

const script = NodeURL.fileURLToPath(new URL("./check-workflow-references.mjs", import.meta.url));

function run(root) {
  return NodeChildProcess.spawnSync(process.execPath, [script, root], { encoding: "utf8" });
}

function withRoot(callback) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-workflows-"));
  try {
    callback(root);
  } finally {
    NodeFS.rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(root, relativePath, contents) {
  const file = NodePath.join(root, relativePath);
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  NodeFS.writeFileSync(file, contents);
}

NodeTest.test("accepts resolvable workflow, action, needs, and script references", () => {
  withRoot((root) => {
    writeFile(root, "scripts/present.ts", "export {};\n");
    writeFile(root, ".github/actions/present/action.yml", "name: Present\n");
    writeFile(root, ".github/workflows/publish.yml", "name: Publish\non: workflow_call\n");
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: ./.github/actions/present
      - run: node scripts/present.ts
  publish:
    needs: [build]
    uses: ./.github/workflows/publish.yml
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 0, result.stderr);
  });
});

NodeTest.test("rejects a called workflow that is parked or absent", () => {
  withRoot((root) => {
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  missing:
    uses: ./.github/workflows/publish-aur.yml
  parked:
    uses: ./.github/disabled/publish-aur.yml
`,
    );
    writeFile(root, ".github/disabled/publish-aur.yml", "name: Parked\non: workflow_call\n");
    const result = run(root);
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(
      result.stderr,
      /release\.yml:5: local workflow reference does not exist: \.\/\.github\/workflows\/publish-aur\.yml/,
    );
    NodeAssert.match(
      result.stderr,
      /release\.yml:7: local workflow reference must live under \.github\/workflows: \.\/\.github\/disabled\/publish-aur\.yml/,
    );
  });
});

NodeTest.test("rejects a local action without an action manifest", () => {
  withRoot((root) => {
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: ./.github/actions/missing
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(
      result.stderr,
      /release\.yml:7: local action reference does not exist: \.\/\.github\/actions\/missing/,
    );
  });
});

NodeTest.test("rejects undefined jobs in scalar, flow, and block needs", () => {
  withRoot((root) => {
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  scalar:
    needs: ghost
    runs-on: ubuntu-24.04
  flow:
    needs: [ghost, scalar]
    runs-on: ubuntu-24.04
  block:
    needs:
      - ghost
      - flow
    runs-on: ubuntu-24.04
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(result.stderr, /release\.yml:5: job needs an undefined job: ghost/);
    NodeAssert.match(result.stderr, /release\.yml:8: job needs an undefined job: ghost/);
    NodeAssert.match(result.stderr, /release\.yml:12: job needs an undefined job: ghost/);
  });
});

NodeTest.test("rejects missing scripts in block and inline run steps", () => {
  withRoot((root) => {
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: Post announcement
        run: |
          node scripts/notify-discord-release.ts prerelease
      - run: bash packaging/aur/scripts/release.sh
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(
      result.stderr,
      /release\.yml:9: run step references a missing file: scripts\/notify-discord-release\.ts/,
    );
    NodeAssert.match(
      result.stderr,
      /release\.yml:10: run step references a missing file: packaging\/aur\/scripts\/release\.sh/,
    );
  });
});

NodeTest.test("rejects undefined jobs in multiline flow needs", () => {
  withRoot((root) => {
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  publish:
    needs:
      [
        ghost,
        build,
      ]
    runs-on: ubuntu-24.04
  build:
    runs-on: ubuntu-24.04
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(result.stderr, /release\.yml:5: job needs an undefined job: ghost/);
    NodeAssert.doesNotMatch(result.stderr, /job needs an undefined job: build/);
  });
});

NodeTest.test("rejects scripts after shell conditionals and interpreter option values", () => {
  withRoot((root) => {
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: Publish
        run: |
          if ! node scripts/removed.ts publish; then
            exit 1
          fi
      - run: node --import tsx scripts/also-removed.ts
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 1);
    NodeAssert.match(result.stderr, /run step references a missing file: scripts\/removed\.ts/);
    NodeAssert.match(
      result.stderr,
      /run step references a missing file: scripts\/also-removed\.ts/,
    );
  });
});

NodeTest.test("resolves scripts from a step working directory", () => {
  withRoot((root) => {
    writeFile(root, "apps/mobile/scripts/present.ts", "export {};\n");
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: Mobile
        working-directory: apps/mobile
        run: node scripts/present.ts
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 0, result.stderr);
  });
});

NodeTest.test("skips dynamic working directories instead of resolving from the root", () => {
  withRoot((root) => {
    writeFile(
      root,
      ".github/workflows/release.yml",
      `name: Release
on: workflow_dispatch
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: Matrix
        working-directory: \${{ matrix.dir }}
        run: node scripts/not-invented-here.ts
`,
    );
    const result = run(root);
    NodeAssert.equal(result.status, 0, result.stderr);
  });
});

NodeTest.test("passes the current repository workflows", () => {
  const result = NodeChildProcess.spawnSync(process.execPath, [script], { encoding: "utf8" });
  NodeAssert.equal(result.status, 0, result.stderr);
});
