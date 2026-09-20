// @effect-diagnostics nodeBuiltinImport:off - Source-launcher tests exercise the Node process boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { afterEach } from "vite-plus/test";

import {
  resolveSourceConnectInvocation,
  SourceConnectOutsideWorktreeError,
  SourceConnectUsageError,
} from "./connect.ts";

const scratchDirectories: Array<string> = [];
const linkedWorktrees: Array<string> = [];
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

function makeRealLinkedWorktree(): string {
  const cacheRoot = NodePath.join(sourceRoot, ".repos");
  NodeFS.mkdirSync(cacheRoot, { recursive: true });
  const scratchRoot = NodeFS.mkdtempSync(NodePath.join(cacheRoot, "kata-source-connect-"));
  const root = NodePath.join(scratchRoot, "worktree");
  scratchDirectories.push(scratchRoot);

  const result = NodeChildProcess.spawnSync("git", ["worktree", "add", "--detach", root, "HEAD"], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Could not create source Connect test worktree: ${result.stderr}`);
  }
  linkedWorktrees.push(root);
  NodeFS.copyFileSync(
    NodePath.join(sourceRoot, "scripts", "connect.ts"),
    NodePath.join(root, "scripts", "connect.ts"),
  );
  const linkType = NodeProcess.platform === "win32" ? "junction" : "dir";
  NodeFS.symlinkSync(
    NodePath.join(sourceRoot, "scripts", "node_modules"),
    NodePath.join(root, "scripts", "node_modules"),
    linkType,
  );
  NodeFS.symlinkSync(
    NodePath.join(sourceRoot, "apps", "server", "node_modules"),
    NodePath.join(root, "apps", "server", "node_modules"),
    linkType,
  );
  return root;
}

function resolveFixture(
  repoRoot: string,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = {},
) {
  return resolveSourceConnectInvocation({
    repoRoot,
    args,
    environment,
    executable: "/test/node",
  }).pipe(Effect.provide(NodeServices.layer));
}

afterEach(() => {
  for (const directory of linkedWorktrees.splice(0)) {
    const result = NodeChildProcess.spawnSync("git", ["worktree", "remove", "--force", directory], {
      cwd: sourceRoot,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`Could not remove source Connect test worktree: ${result.stderr}`);
    }
  }
  for (const directory of scratchDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("source Connect launcher", () => {
  it.effect("pins the child to the linked worktree and removes launcher-owned state", () =>
    Effect.gen(function* () {
      const repoRoot = makeLinkedWorktree();
      const invocation = yield* resolveFixture(repoRoot, ["status", "--json"], {
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
    }),
  );

  it.effect("rejects a checkout that is not a linked worktree", () =>
    Effect.gen(function* () {
      const repoRoot = NodeFS.mkdtempSync(
        NodePath.join(NodeOS.tmpdir(), "kata-source-connect-main-"),
      );
      scratchDirectories.push(repoRoot);
      NodeFS.mkdirSync(NodePath.join(repoRoot, ".git"));

      const error = yield* resolveFixture(repoRoot, ["status"]).pipe(Effect.flip);
      expect(error).toBeInstanceOf(SourceConnectOutsideWorktreeError);
    }),
  );

  it.effect("rejects arguments that can escape the managed worktree link", () =>
    Effect.gen(function* () {
      const invalidArguments = [
        ["status", "--base-dir", "/tmp/other-home"],
        ["status", "--base-dir=/tmp/other-home"],
        ["link", "--publish-only"],
        ["publish"],
      ];
      for (const args of invalidArguments) {
        const error = yield* resolveFixture(makeLinkedWorktree(), args).pipe(Effect.flip);
        expect(error).toBeInstanceOf(SourceConnectUsageError);
      }
    }),
  );

  it("exposes the configured source Connect command at the real process boundary", () => {
    const repoRoot = makeRealLinkedWorktree();
    const {
      OP_SERVICE_ACCOUNT_TOKEN: _token,
      OP_ENVIRONMENT_ID: _environmentId,
      ...baseEnv
    } = NodeProcess.env;
    const result = NodeChildProcess.spawnSync(
      NodeProcess.execPath,
      [NodePath.join(repoRoot, "scripts", "connect.ts"), "status", "--help"],
      {
        cwd: repoRoot,
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
