// @effect-diagnostics nodeBuiltinImport:off - Source-launcher tests exercise the Node process boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  resolveSourceConnectInvocation,
  SourceConnectOutsideWorktreeError,
  SourceConnectUsageError,
} from "./connect.ts";

const scratchDirectories: Array<string> = [];
const sourceRoot = NodePath.resolve(import.meta.dirname, "..");

function makeLinkedWorktree(): string {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kata-source-connect-"));
  scratchDirectories.push(root);
  NodeFS.writeFileSync(
    NodePath.join(root, ".git"),
    `gitdir: ${NodePath.join(root, "common.git", "worktrees", "fixture")}\n`,
  );
  return root;
}

function resolveFixture(
  repoRoot: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = {},
) {
  return Effect.runPromise(
    resolveSourceConnectInvocation({
      repoRoot,
      args,
      environment,
      executable: "/test/node",
    }).pipe(Effect.provide(NodeServices.layer)),
  );
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("source Connect launcher", () => {
  it("pins the child to the linked worktree and removes launcher-owned state", async () => {
    const repoRoot = makeLinkedWorktree();
    const invocation = await resolveFixture(repoRoot, ["status", "--json"], {
      KATACODE_HOME: "/shared/installed-home",
      KATACODE_RELAY_URL: "https://relay.example.test",
      T3_BOOT_SERVICE_UNIT: "t3code.service",
      T3_SERVICE_LAUNCHER_CONTEXT: '{"protocol":2}',
    });

    expect(invocation.baseDir).toBe(NodePath.join(repoRoot, ".katacode"));
    expect(invocation.cwd).toBe(repoRoot);
    expect(invocation.executable).toBe("/test/node");
    expect(invocation.args).toEqual([
      NodePath.join(repoRoot, "apps", "server", "src", "bin.ts"),
      "connect",
      "status",
      "--json",
    ]);
    expect(invocation.environment.KATACODE_HOME).toBe(NodePath.join(repoRoot, ".katacode"));
    expect(invocation.environment.KATACODE_RELAY_URL).toBe("https://relay.example.test");
    expect(invocation.environment.T3_BOOT_SERVICE_UNIT).toBeUndefined();
    expect(invocation.environment.T3_SERVICE_LAUNCHER_CONTEXT).toBeUndefined();
  });

  it("rejects a checkout that is not a linked worktree", async () => {
    const repoRoot = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "kata-source-connect-main-"),
    );
    scratchDirectories.push(repoRoot);
    NodeFS.mkdirSync(NodePath.join(repoRoot, ".git"));

    await expect(resolveFixture(repoRoot, ["status"])).rejects.toBeInstanceOf(
      SourceConnectOutsideWorktreeError,
    );
  });

  it.each([
    ["status", "--base-dir", "/tmp/other-home"],
    ["status", "--base-dir=/tmp/other-home"],
    ["link", "--publish-only"],
    ["publish"],
  ])("rejects arguments that can escape the managed worktree link", async (...args) => {
    await expect(resolveFixture(makeLinkedWorktree(), args)).rejects.toBeInstanceOf(
      SourceConnectUsageError,
    );
  });

  it("exposes the configured source Connect command at the real process boundary", () => {
    const {
      OP_SERVICE_ACCOUNT_TOKEN: _token,
      OP_ENVIRONMENT_ID: _environmentId,
      ...baseEnv
    } = NodeProcess.env;
    const result = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [NodePath.join(sourceRoot, "scripts", "connect.ts"), "status", "--help"],
      {
        cwd: sourceRoot,
        encoding: "utf8",
        env: {
          ...baseEnv,
          KATACODE_RELAY_URL: "https://relay.example.test",
          KATACODE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==",
          KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_client_test",
          T3_BOOT_SERVICE_UNIT: "t3code.service",
          T3_SERVICE_LAUNCHER_CONTEXT: '{"protocol":2,"childVersion":"installed"}',
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Show persisted Kata Code Connect and relay client state.");
    expect(result.stderr).not.toContain("commands are unavailable");
  });
});
