#!/usr/bin/env node

// @effect-diagnostics nodeBuiltinImport:off - Source bootstrap runs before an Effect runtime exists.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { resolveGitWorktreePath } from "@kata-sh/code-shared/devHome";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { loadRepoEnv } from "./lib/public-config.ts";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");
const SUPPORTED_SUBCOMMANDS = new Set(["link", "status", "unlink", "logout"]);

export interface SourceConnectInvocation {
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly baseDir: string;
  readonly environment: NodeJS.ProcessEnv;
}

export class SourceConnectOutsideWorktreeError extends Error {
  readonly _tag = "SourceConnectOutsideWorktreeError";

  constructor(repoRoot: string) {
    super(`Source Connect requires a linked git worktree. ${repoRoot} is not a linked worktree.`);
    this.name = this._tag;
  }
}

export class SourceConnectUsageError extends Error {
  readonly _tag = "SourceConnectUsageError";

  constructor(detail: string) {
    super(`${detail}\nSupported commands: link --headless, status, unlink, logout, and --help.`);
    this.name = this._tag;
  }
}

export function resolveSourceConnectInvocation(input: {
  readonly repoRoot: string;
  readonly args: ReadonlyArray<string>;
  readonly environment: NodeJS.ProcessEnv;
  readonly executable?: string;
}): Effect.Effect<
  SourceConnectInvocation,
  SourceConnectOutsideWorktreeError | SourceConnectUsageError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const path = yield* Path.Path;
    const repoRoot = path.resolve(input.repoRoot);
    const worktreeRoot = yield* resolveGitWorktreePath(repoRoot);
    if (worktreeRoot === undefined || path.resolve(worktreeRoot) !== repoRoot) {
      return yield* Effect.fail(new SourceConnectOutsideWorktreeError(repoRoot));
    }

    const args = input.args.length === 0 ? ["--help"] : [...input.args];
    const subcommand = args[0];
    if (
      subcommand !== "--help" &&
      subcommand !== "-h" &&
      !SUPPORTED_SUBCOMMANDS.has(subcommand ?? "")
    ) {
      return yield* Effect.fail(
        new SourceConnectUsageError(
          `Unsupported source Connect command: ${subcommand ?? "<missing>"}.`,
        ),
      );
    }
    if (args.some((argument) => argument === "--base-dir" || argument.startsWith("--base-dir="))) {
      return yield* Effect.fail(
        new SourceConnectUsageError(
          "The source Connect launcher owns --base-dir so it cannot target another environment.",
        ),
      );
    }
    if (
      args.some(
        (argument) => argument === "--publish-only" || argument.startsWith("--publish-only="),
      )
    ) {
      return yield* Effect.fail(
        new SourceConnectUsageError(
          "The source Connect launcher provisions a managed endpoint and does not support --publish-only.",
        ),
      );
    }

    const baseDir = path.join(repoRoot, ".katacode");
    const environment: NodeJS.ProcessEnv = {
      ...input.environment,
      KATACODE_HOME: baseDir,
    };
    delete environment.T3_BOOT_SERVICE_UNIT;
    delete environment.T3_SERVICE_LAUNCHER_CONTEXT;

    return {
      executable: input.executable ?? process.execPath,
      args: [path.join(repoRoot, "apps", "server", "src", "bin.ts"), "connect", ...args],
      cwd: repoRoot,
      baseDir,
      environment,
    };
  });
}

export async function runSourceConnect(
  args: ReadonlyArray<string>,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const environment = loadRepoEnv({ baseEnv: baseEnvironment });
  const invocation = await Effect.runPromise(
    resolveSourceConnectInvocation({
      repoRoot: REPO_ROOT,
      args,
      environment,
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  const result = NodeChildProcess.spawnSync(invocation.executable, [...invocation.args], {
    cwd: invocation.cwd,
    env: invocation.environment,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`Could not start the source Connect command: ${result.error.message}`);
  }
  if (result.status !== null) {
    return result.status;
  }
  return 128 + (result.signal === null ? 1 : (NodeOS.constants.signals[result.signal] ?? 1));
}

if (import.meta.main) {
  void runSourceConnect(process.argv.slice(2)).then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : "Unknown source Connect failure.";
      process.stderr.write(`[source-connect] ${message}\n`);
      process.exitCode = 1;
    },
  );
}
