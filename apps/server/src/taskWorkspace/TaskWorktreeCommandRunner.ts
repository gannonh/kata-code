import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Duration from "effect/Duration";
import { tokenizeCommandLine } from "@kata-sh/code-shared/shell";
import { ProcessRunner } from "../processRunner.ts";

export interface TaskWorktreeCommandInput {
  readonly worktreePath: string;
  readonly expectedBranch: string;
  readonly expectedBaseCommitSha: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes?: number;
}

export interface TaskWorktreeCommandResult {
  readonly status: "pass" | "fail" | "indeterminate";
  readonly output: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly startingCommitSha: string;
  readonly endingCommitSha: string | null;
  readonly startingStatus: string;
  readonly endingStatus: string | null;
}

export class TaskWorktreeCommandError extends Data.TaggedError("TaskWorktreeCommandError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface TaskWorktreeCommandRunnerShape {
  readonly run: (
    input: TaskWorktreeCommandInput,
  ) => Effect.Effect<TaskWorktreeCommandResult, TaskWorktreeCommandError>;
}

export class TaskWorktreeCommandRunner extends Context.Service<
  TaskWorktreeCommandRunner,
  TaskWorktreeCommandRunnerShape
>()("@kata-sh/code-cli/taskWorkspace/TaskWorktreeCommandRunner") {}

const scrubEnvironment = (): NodeJS.ProcessEnv => {
  const blocked = /(?:TOKEN|SECRET|PASSWORD|API[_-]?KEY|AUTH|BEARER|MCP|CREDENTIAL|PROVIDER)/iu;
  const allowed = new Set(["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "CI"]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => allowed.has(key) && !blocked.test(key)),
  );
};

const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner;
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

  const run: TaskWorktreeCommandRunnerShape["run"] = (input) =>
    Effect.gen(function* () {
      const branch = yield* git(input.worktreePath, ["symbolic-ref", "--short", "HEAD"]);
      if (branch.timedOut || branch.code !== 0 || branch.stdout.trim() !== input.expectedBranch) {
        return yield* new TaskWorktreeCommandError({
          message: "The task worktree branch is not canonical.",
        });
      }
      const base = yield* git(input.worktreePath, [
        "merge-base",
        "--is-ancestor",
        input.expectedBaseCommitSha,
        "HEAD",
      ]);
      if (base.timedOut || base.code !== 0) {
        return yield* new TaskWorktreeCommandError({
          message: "The task worktree base is not an ancestor.",
        });
      }
      const beforeHead = yield* git(input.worktreePath, ["rev-parse", "HEAD"]);
      const beforeStatus = yield* git(input.worktreePath, ["status", "--porcelain=v2"]);
      if (
        beforeHead.timedOut ||
        beforeHead.code !== 0 ||
        beforeStatus.timedOut ||
        beforeStatus.code !== 0
      ) {
        return yield* new TaskWorktreeCommandError({
          message: "Unable to observe the task worktree.",
        });
      }
      const argv = tokenizeCommandLine(input.command);
      if (argv.length === 0) {
        return yield* new TaskWorktreeCommandError({
          message: "The approved check command is empty.",
        });
      }
      const result = yield* processRunner
        .run({
          command: argv[0]!,
          args: argv.slice(1),
          cwd: input.worktreePath,
          timeout: Duration.millis(input.timeoutMs),
          env: scrubEnvironment(),
          maxOutputBytes: input.maxOutputBytes ?? 1024 * 1024,
          outputMode: "truncate",
          timeoutBehavior: "timedOutResult",
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TaskWorktreeCommandError({ message: "Task check execution failed.", cause }),
          ),
        );
      const afterHead = yield* git(input.worktreePath, ["rev-parse", "HEAD"]);
      const afterStatus = yield* git(input.worktreePath, ["status", "--porcelain=v2"]);
      const startingCommitSha = beforeHead.stdout.trim();
      const endingCommitSha =
        afterHead.code === 0 && !afterHead.timedOut ? afterHead.stdout.trim() : null;
      const startingStatus = beforeStatus.stdout.trim();
      const endingStatus =
        afterStatus.code === 0 && !afterStatus.timedOut ? afterStatus.stdout.trim() : null;
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
      } satisfies TaskWorktreeCommandResult;
    }).pipe(
      Effect.mapError((cause) =>
        cause instanceof TaskWorktreeCommandError
          ? cause
          : new TaskWorktreeCommandError({ message: "Task worktree command failed.", cause }),
      ),
    );

  return { run } satisfies TaskWorktreeCommandRunnerShape;
});

export const TaskWorktreeCommandRunnerLive = Layer.effect(TaskWorktreeCommandRunner, make);
