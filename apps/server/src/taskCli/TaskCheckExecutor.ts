// @effect-diagnostics nodeBuiltinImport:off - Task check sandbox profiles need synchronous host path discovery before execution.
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Duration from "effect/Duration";
import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";
import { tokenizeCommandLine } from "@kata-sh/code-shared/shell";
import { ProcessRunner } from "../processRunner.ts";

export interface TaskCheckExecutorInput {
  readonly worktreePath: string;
  /** The commit the server bound to this attempt. The CLI runs the check only
   * when its own before-observation matches this sha; the branch and base are
   * server-side concerns the CLI never learns (and never needs). */
  readonly expectedStartingCommitSha: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
}

export interface TaskCheckExecutorResult {
  readonly status: "pass" | "fail" | "indeterminate";
  readonly output: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly startingCommitSha: string;
  readonly endingCommitSha: string | null;
  readonly startingStatus: string;
  readonly endingStatus: string | null;
}

export class TaskCheckExecutorError extends Data.TaggedError("TaskCheckExecutorError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface TaskCheckExecutorShape {
  readonly run: (
    input: TaskCheckExecutorInput,
  ) => Effect.Effect<TaskCheckExecutorResult, TaskCheckExecutorError>;
}

export class TaskCheckExecutor extends Context.Service<
  TaskCheckExecutor,
  TaskCheckExecutorShape
>()("@kata-sh/code-cli/taskCli/TaskCheckExecutor") {}

const scrubEnvironment = (): NodeJS.ProcessEnv => {
  const blocked = /(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTH|BEARER|MCP|CREDENTIAL|PROVIDER)/iu;
  const allowed = new Set([
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "CI",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
  ]);
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => allowed.has(key) && !blocked.test(key)),
    ),
    // The deterministic identity must win over any host git identity copied
    // from the environment by the allowlist spread above.
    GIT_AUTHOR_NAME: "Kata Code Task Check",
    GIT_AUTHOR_EMAIL: "tasks@kata.sh",
    GIT_COMMITTER_NAME: "Kata Code Task Check",
    GIT_COMMITTER_EMAIL: "tasks@kata.sh",
  };
};

function sandboxString(value: string): string {
  return JSON.stringify(value);
}

function existingReadablePaths(paths: ReadonlyArray<string>): ReadonlyArray<string> {
  return paths.filter((path) => {
    try {
      return NodeFs.existsSync(path);
    } catch {
      return false;
    }
  });
}

function executableOnPath(name: string): string | null {
  for (const entry of (process.env.PATH ?? "").split(NodePath.delimiter)) {
    if (!entry) continue;
    const candidate = NodePath.join(entry, name);
    try {
      if (NodeFs.existsSync(candidate)) return candidate;
    } catch {
      // Ignore unreadable PATH entries.
    }
  }
  return null;
}

function realPath(path: string): string {
  try {
    return NodeFs.realpathSync.native(path);
  } catch {
    return path;
  }
}

/**
 * Resolve the canonical git metadata a linked task worktree needs to run git
 * read commands inside the check sandbox. The worktree's `.git` gitfile is
 * writable by the task implementation; when `expectedBranch` is supplied, the
 * resolved gitdir is only trusted when its HEAD references that branch and
 * anything else yields no mounts. When the branch is omitted (CLI check
 * executor), the server has already bound the starting commit and cwd, so the
 * resolved gitdir and common directory are mounted read-only without a HEAD
 * branch assertion.
 */
export function taskGitMetadataReadPaths(
  worktreePath: string,
  expectedBranch?: string,
): ReadonlyArray<string> {
  const gitFile = (() => {
    try {
      return NodeFs.readFileSync(NodePath.join(worktreePath, ".git"), "utf8");
    } catch {
      return null;
    }
  })();
  if (gitFile === null) return [];
  const gitDirectoryValue = gitFile.match(/^gitdir:\s*(.+)$/mu)?.[1]?.trim();
  if (!gitDirectoryValue) return [];
  const gitDirectoryPath = NodePath.isAbsolute(gitDirectoryValue)
    ? gitDirectoryValue
    : NodePath.resolve(worktreePath, gitDirectoryValue);
  const gitDirectory = realPath(gitDirectoryPath);
  if (expectedBranch !== undefined) {
    const head = (() => {
      try {
        return NodeFs.readFileSync(NodePath.join(gitDirectory, "HEAD"), "utf8");
      } catch {
        return "";
      }
    })();
    if (head.trim() !== `ref: refs/heads/${expectedBranch}`) return [];
  }
  const commonDirectoryValue = (() => {
    try {
      return NodeFs.readFileSync(NodePath.join(gitDirectory, "commondir"), "utf8").trim();
    } catch {
      return "../..";
    }
  })();
  const commonDirectoryPath = NodePath.isAbsolute(commonDirectoryValue)
    ? commonDirectoryValue
    : NodePath.resolve(gitDirectory, commonDirectoryValue);
  return Array.from(new Set([gitDirectory, realPath(commonDirectoryPath)]));
}

export function taskCheckTempPath(worktreePath: string): string {
  return NodePath.join(worktreePath, ".kata-check-tmp");
}

export function taskCheckEnvironment(worktreePath: string): NodeJS.ProcessEnv {
  const tempPath = taskCheckTempPath(worktreePath);
  return {
    ...scrubEnvironment(),
    HOME: tempPath,
    TMPDIR: tempPath,
    TMP: tempPath,
    TEMP: tempPath,
    KATA_TASK_WORKTREE: worktreePath,
  };
}

export function macSandboxProfile(
  worktreePath: string,
  extraReadPaths: ReadonlyArray<string> = [],
): string {
  const home = NodeOs.homedir();
  const worktreePaths = Array.from(new Set([worktreePath, realPath(worktreePath)]));
  const runtimeReadPaths = existingReadablePaths([
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/private/var/db/timezone",
    "/opt/homebrew",
    "/usr/local",
    // Vite+ resolves `vp` through rotating version symlinks under this
    // directory. Keep that toolchain available without exposing other user
    // package-manager and credential directories to checks.
    NodePath.join(home, ".vite-plus"),
    ...extraReadPaths,
  ]);
  return [
    "(version 1)",
    "(deny default)",
    '(import "system.sb")',
    "(allow process-exec)",
    "(allow process-fork)",
    "(deny network*)",
    `(allow file-read-metadata (subpath ${sandboxString("/")}) (subpath ${sandboxString(home)}))`,
    `(allow file-read* ${[...runtimeReadPaths, ...worktreePaths]
      .map((path) => `(subpath ${sandboxString(path)}) (literal ${sandboxString(path)})`)
      .join(" ")})`,
    `(allow file-write* ${worktreePaths
      .map((path) => `(subpath ${sandboxString(path)}) (literal ${sandboxString(path)})`)
      .join(" ")})`,
  ].join("\n");
}

function cleanupTaskCheckTempPath(
  worktreePath: string,
): Effect.Effect<void, TaskCheckExecutorError> {
  return Effect.tryPromise({
    try: () =>
      NodeFs.promises.rm(taskCheckTempPath(worktreePath), { recursive: true, force: true }),
    catch: (cause) =>
      new TaskCheckExecutorError({
        message: "Unable to clean the task check temp directory.",
        cause,
      }),
  });
}

function linuxBwrapArgs(
  worktreePath: string,
  argv: ReadonlyArray<string>,
  extraReadPaths: ReadonlyArray<string> = [],
): ReadonlyArray<string> {
  const readOnlyPaths = existingReadablePaths([
    "/usr",
    "/bin",
    "/sbin",
    "/lib",
    "/lib64",
    "/etc/alternatives",
    "/etc/ssl",
    "/etc/ca-certificates",
    NodePath.join(NodeOs.homedir(), ".vite-plus"),
    NodePath.dirname(realPath(process.execPath)),
    ...extraReadPaths,
  ]).flatMap((path) => ["--ro-bind", path, path]);
  return [
    "--unshare-all",
    "--unshare-net",
    "--die-with-parent",
    "--new-session",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/tmp",
    ...readOnlyPaths,
    "--bind",
    worktreePath,
    worktreePath,
    "--chdir",
    worktreePath,
    "--",
    ...argv,
  ];
}

export function sandboxApprovedCheckCommand(input: {
  readonly argv: ReadonlyArray<string>;
  readonly worktreePath: string;
  readonly expectedBranch?: string;
  readonly platform: NodeJS.Platform;
}): { readonly command: string; readonly args: ReadonlyArray<string> } | null {
  const platform = input.platform;
  const gitMetadataReadPaths = taskGitMetadataReadPaths(input.worktreePath, input.expectedBranch);
  if (platform === "darwin" && NodeFs.existsSync("/usr/bin/sandbox-exec")) {
    return {
      command: "/usr/bin/sandbox-exec",
      args: [
        "-p",
        macSandboxProfile(input.worktreePath, gitMetadataReadPaths),
        "--",
        ...input.argv,
      ],
    };
  }
  if (platform === "linux") {
    const bwrap = executableOnPath("bwrap");
    if (bwrap)
      return {
        command: bwrap,
        args: linuxBwrapArgs(input.worktreePath, input.argv, gitMetadataReadPaths),
      };
  }
  return null;
}

const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner;
  const hostPlatform = yield* HostProcessPlatform;
  const git = (cwd: string, args: ReadonlyArray<string>) =>
    processRunner.run({
      command: "git",
      args,
      cwd,
      timeout: "10 seconds",
      env: scrubEnvironment(),
      maxOutputBytes: 64 * 1024,
      outputMode: "truncate",
      timeoutBehavior: "timedOutResult",
    });

  const run: TaskCheckExecutorShape["run"] = (input) =>
    Effect.gen(function* () {
      // A previous interrupted run may have left the check temp directory
      // behind. Remove it before observing the before-state so a stale
      // directory cannot be counted as a change the check itself made.
      yield* cleanupTaskCheckTempPath(input.worktreePath);
      const beforeHead = yield* git(input.worktreePath, ["rev-parse", "HEAD"]);
      const beforeStatus = yield* git(input.worktreePath, ["status", "--porcelain=v2"]);
      if (
        beforeHead.timedOut ||
        beforeHead.code !== 0 ||
        beforeStatus.timedOut ||
        beforeStatus.code !== 0
      ) {
        return yield* new TaskCheckExecutorError({
          message: "Unable to observe the task worktree.",
        });
      }
      const startingCommitSha = beforeHead.stdout.trim();
      if (startingCommitSha !== input.expectedStartingCommitSha) {
        return yield* new TaskCheckExecutorError({
          message: "The starting Git state does not match the bound attempt.",
        });
      }
      // A malformed command line (unterminated quote or escape) throws; keep it
      // a handled failure so the CLI maps it to a stable envelope instead of a
      // Die defect killing the command.
      const argv = yield* Effect.try({
        try: () => tokenizeCommandLine(input.command),
        catch: (cause) =>
          new TaskCheckExecutorError({ message: "Malformed check command.", cause }),
      });
      if (argv.length === 0) {
        return yield* new TaskCheckExecutorError({
          message: "The approved check command is empty.",
        });
      }
      // Scope the temp directory to the execution block: the finalizer removes
      // it on every exit path, including interruption, so it can never leak
      // into the worktree and poison the next attempt's before-state
      // comparison.
      const executed = yield* Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () =>
            NodeFs.promises.mkdir(taskCheckTempPath(input.worktreePath), { recursive: true }),
          catch: (cause) =>
            new TaskCheckExecutorError({
              message: "Unable to create the task check temp directory.",
              cause,
            }),
        });
        const sandboxed = sandboxApprovedCheckCommand({
          argv,
          worktreePath: input.worktreePath,
          platform: hostPlatform,
        });
        if (!sandboxed) return null;
        return yield* processRunner.run({
          command: sandboxed.command,
          args: sandboxed.args,
          cwd: input.worktreePath,
          timeout: Duration.millis(input.timeoutMs),
          env: taskCheckEnvironment(input.worktreePath),
          maxOutputBytes: input.maxOutputBytes ?? 1024 * 1024,
          outputMode: "truncate",
          timeoutBehavior: "timedOutResult",
        });
      }).pipe(
        Effect.mapError(
          (cause) =>
            new TaskCheckExecutorError({ message: "Task check execution failed.", cause }),
        ),
        Effect.ensuring(cleanupTaskCheckTempPath(input.worktreePath).pipe(Effect.orDie)),
      );
      if (executed === null) {
        return {
          status: "indeterminate" as const,
          output: "No supported OS-enforced task check sandbox is available on this host.",
          exitCode: null,
          timedOut: false,
          startingCommitSha,
          endingCommitSha: startingCommitSha,
          startingStatus: beforeStatus.stdout.trim(),
          endingStatus: beforeStatus.stdout.trim(),
        } satisfies TaskCheckExecutorResult;
      }
      const result = executed;
      // Explicit release point: the temp directory must be gone before the
      // after-state is observed so the check's own scratch files are never
      // counted as worktree changes.
      yield* cleanupTaskCheckTempPath(input.worktreePath);
      const afterHead = yield* git(input.worktreePath, ["rev-parse", "HEAD"]);
      const afterStatus = yield* git(input.worktreePath, ["status", "--porcelain=v2"]);
      const endingCommitSha =
        afterHead.code === 0 && !afterHead.timedOut ? afterHead.stdout.trim() : null;
      const startingStatus = beforeStatus.stdout.trim();
      const endingStatus =
        afterStatus.code === 0 && !afterStatus.timedOut ? afterStatus.stdout.trim() : null;
      // A failed after-observation is insufficient evidence that the worktree is
      // unchanged; report indeterminate instead of trusting a stale snapshot.
      const observedAfterState = endingCommitSha !== null && endingStatus !== null;
      const worktreeChanged =
        (endingCommitSha !== null && endingCommitSha !== startingCommitSha) ||
        (endingStatus !== null && endingStatus !== startingStatus);
      let output = `${result.stdout}${result.stderr.length > 0 ? `\n${result.stderr}` : ""}`;
      if (worktreeChanged) {
        const changeNotes: string[] = [];
        if (endingCommitSha !== null && endingCommitSha !== startingCommitSha) {
          changeNotes.push(`HEAD moved from ${startingCommitSha} to ${endingCommitSha}.`);
        }
        if (endingStatus !== null && endingStatus !== startingStatus) {
          changeNotes.push("The canonical worktree status changed.");
        }
        output = `${output}${output.length > 0 ? "\n" : ""}[worktree changed: ${changeNotes.join(" ")} The changed state is left visible for recovery.]`;
      }
      return {
        status: result.timedOut
          ? "indeterminate"
          : worktreeChanged
            ? "fail"
            : !observedAfterState
              ? "indeterminate"
              : result.code === 0
                ? "pass"
                : "fail",
        output,
        exitCode: result.code === null ? null : Number(result.code),
        timedOut: result.timedOut,
        startingCommitSha,
        endingCommitSha,
        startingStatus,
        endingStatus,
      } satisfies TaskCheckExecutorResult;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof TaskCheckExecutorError
          ? cause
          : new TaskCheckExecutorError({ message: "Task worktree command failed.", cause }),
      ),
    );

  return { run } satisfies TaskCheckExecutorShape;
});

export const TaskCheckExecutorLive = Layer.effect(TaskCheckExecutor, make);
