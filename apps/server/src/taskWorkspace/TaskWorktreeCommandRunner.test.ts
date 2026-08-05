// @effect-diagnostics nodeBuiltinImport:off - the runner executes real git and node processes in a fixture worktree.
import { execFile } from "node:child_process";
import * as NodeFileSystem from "node:fs";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { promisify } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { HostProcessPlatform } from "@kata-sh/code-shared/hostProcess";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, vi } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import {
  macSandboxProfile,
  sandboxApprovedCheckCommand,
  taskCheckEnvironment,
  taskCheckTempPath,
  TaskWorktreeCommandRunner,
  TaskWorktreeCommandRunnerLive,
} from "./TaskWorktreeCommandRunner.ts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Kata Code Test",
      GIT_AUTHOR_EMAIL: "test@kata.sh",
      GIT_COMMITTER_NAME: "Kata Code Test",
      GIT_COMMITTER_EMAIL: "test@kata.sh",
    },
  });
  return stdout.trim();
}

const runnerLayer = TaskWorktreeCommandRunnerLive.pipe(
  Layer.provide(ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer))),
);

// Wraps the real ProcessRunner so the two after-state git observations of a
// check run report a timeout; everything else (including the check command
// itself) executes normally.
const afterStateTimeoutRunnerLayer = TaskWorktreeCommandRunnerLive.pipe(
  Layer.provide(
    Layer.effect(
      ProcessRunner.ProcessRunner,
      Effect.gen(function* () {
        const real = yield* ProcessRunner.ProcessRunner;
        let gitCalls = 0;
        return {
          run: (input) => {
            if (input.command === "git") {
              gitCalls += 1;
              // The runner makes four git observations before the command;
              // the two after-state observations come next.
              if (gitCalls >= 5) {
                return Effect.succeed({
                  stdout: "",
                  stderr: "",
                  code: null,
                  timedOut: true,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                });
              }
            }
            return real.run(input);
          },
        };
      }),
    ).pipe(Layer.provide(ProcessRunner.layer.pipe(Layer.provide(NodeServices.layer)))),
  ),
);

const setup = Effect.gen(function* () {
  const root = yield* Effect.tryPromise(() =>
    NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-check-runner-")),
  );
  yield* Effect.addFinalizer(() =>
    Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(Effect.orDie),
  );
  yield* Effect.tryPromise(() => git(root, ["init", "-b", "main"]));
  yield* Effect.tryPromise(() => NodeFs.writeFile(NodePath.join(root, "README.md"), "# fixture\n"));
  yield* Effect.tryPromise(() => git(root, ["add", "README.md"]));
  yield* Effect.tryPromise(() => git(root, ["commit", "-m", "chore: seed"]));
  const baseCommitSha = yield* Effect.tryPromise(() => git(root, ["rev-parse", "HEAD"]));
  return { worktreePath: root, expectedBranch: "main", expectedBaseCommitSha: baseCommitSha };
});

effectIt.layer(runnerLayer)("TaskWorktreeCommandRunner", (it) => {
  it.effect("runs a bare executable resolved through PATH", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner.run({
        worktreePath,
        expectedBranch,
        expectedBaseCommitSha,
        command: "pwd",
        timeoutMs: 15_000,
      });
      expect(result.status).toBe("pass");
      expect(result.exitCode).toBe(0);
      expect(result.output.trim().endsWith(NodePath.basename(worktreePath))).toBe(true);
    }),
  );

  it.effect("runs a multi-word command as argv with PATH resolution", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner.run({
        worktreePath,
        expectedBranch,
        expectedBaseCommitSha,
        command: "git rev-parse --abbrev-ref HEAD",
        timeoutMs: 15_000,
      });
      expect(result.status).toBe("pass");
      expect(result.output.trim()).toBe("main");
      expect(result.endingCommitSha).toBe(result.startingCommitSha);
    }),
  );

  it.effect("preserves quoted arguments across process boundaries", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner.run({
        worktreePath,
        expectedBranch,
        expectedBaseCommitSha,
        command: "node -e \"const s = 'hello world'; process.stdout.write(s)\"",
        timeoutMs: 15_000,
      });
      expect(result.status).toBe("pass");
      expect(result.output.trim()).toBe("hello world");
    }),
  );

  it.effect("fails an attempt whose command moves HEAD and returns the before/after state", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner.run({
        worktreePath,
        expectedBranch,
        expectedBaseCommitSha,
        command: "git commit --allow-empty -m move-head",
        timeoutMs: 15_000,
      });
      expect(result.status).toBe("fail");
      expect(result.output).toContain("HEAD moved");
      expect(result.endingCommitSha).not.toBe(result.startingCommitSha);
      // The changed state stays visible for recovery.
      const head = yield* Effect.tryPromise(() => git(worktreePath, ["rev-parse", "HEAD"]));
      expect(head).toBe(result.endingCommitSha);
    }),
  );

  it.effect("fails an attempt whose command dirties the canonical worktree status", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner.run({
        worktreePath,
        expectedBranch,
        expectedBaseCommitSha,
        command: "node -e \"require('node:fs').writeFileSync('dirty.txt', 'x')\"",
        timeoutMs: 15_000,
      });
      expect(result.status).toBe("fail");
      expect(result.output).toContain("status changed");
      expect(result.startingStatus).toBe("");
      expect(result.endingStatus).not.toBe("");
      const dirty = yield* Effect.tryPromise(() =>
        NodeFs.readFile(NodePath.join(worktreePath, "dirty.txt"), "utf8"),
      );
      expect(dirty).toBe("x");
    }),
  );

  it.effect("ignores task-local temp files after cleaning TMPDIR before status observation", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner.run({
        worktreePath,
        expectedBranch,
        expectedBaseCommitSha,
        command:
          "node -e \"require('node:fs').writeFileSync(require('node:path').join(process.env.TMPDIR, 'scratch.txt'), 'x')\"",
        timeoutMs: 15_000,
      });
      expect(result.status).toBe("pass");
      expect(result.startingStatus).toBe("");
      expect(result.endingStatus).toBe("");
      const tempExists = yield* Effect.tryPromise(() =>
        NodeFs.access(taskCheckTempPath(worktreePath)).then(
          () => true,
          () => false,
        ),
      );
      expect(tempExists).toBe(false);
    }),
  );

  it.effect("surfaces task temp cleanup failures as handled command errors", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const rmSpy = vi
        .spyOn(NodeFileSystem.promises, "rm")
        .mockRejectedValueOnce(new Error("rm denied"));
      // Restore even when an assertion below fails so the leaked spy cannot
      // change the temp-directory cleanup of later tests and the setup
      // finalizer.
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSpy.mockRestore()));
      const result = yield* runner
        .run({
          worktreePath,
          expectedBranch,
          expectedBaseCommitSha,
          command: "pwd",
          timeoutMs: 15_000,
        })
        .pipe(Effect.exit);
      expect(result._tag).toBe("Failure");
      expect(rmSpy).toHaveBeenCalledWith(taskCheckTempPath(worktreePath), {
        recursive: true,
        force: true,
      });
    }),
  );

  it.effect("rejects a non-canonical branch before running any command", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner
        .run({
          worktreePath,
          expectedBranch: "katacode/task-other",
          expectedBaseCommitSha,
          command: "git status",
          timeoutMs: 15_000,
        })
        .pipe(Effect.exit);
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("rejects an empty command without spawning a process", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const result = yield* runner
        .run({
          worktreePath,
          expectedBranch,
          expectedBaseCommitSha,
          command: "   ",
          timeoutMs: 15_000,
        })
        .pipe(Effect.exit);
      expect(result._tag).toBe("Failure");
    }),
  );

  it.effect("settles a malformed command line as a handled failure, not a defect", () =>
    Effect.gen(function* () {
      const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
      const runner = yield* TaskWorktreeCommandRunner;
      const trailingBackslash = yield* runner
        .run({
          worktreePath,
          expectedBranch,
          expectedBaseCommitSha,
          command: "echo \\",
          timeoutMs: 15_000,
        })
        .pipe(Effect.exit);
      expect(trailingBackslash._tag).toBe("Failure");
      const unterminatedQuote = yield* runner
        .run({
          worktreePath,
          expectedBranch,
          expectedBaseCommitSha,
          command: "echo 'unterminated",
          timeoutMs: 15_000,
        })
        .pipe(Effect.exit);
      expect(unterminatedQuote._tag).toBe("Failure");
    }),
  );

  it("keeps macOS sandbox writes inside the task worktree", () => {
    const worktreePath = "/Users/test/worktrees/katacode-task-1";
    const profile = macSandboxProfile(worktreePath);
    const writeRule = profile.split("\n").find((line) => line.startsWith("(allow file-write*"));

    expect(writeRule).toContain(worktreePath);
    expect(writeRule).not.toContain(NodeOs.tmpdir());
    expect(writeRule).not.toContain("/private/tmp");
    expect(writeRule).not.toContain("/tmp");
  });

  it("limits macOS sandbox reads to runtime/system paths and the task worktree", () => {
    const worktreePath = "/Users/test/worktrees/katacode-task-1";
    const profile = macSandboxProfile(worktreePath);

    expect(profile).toContain(worktreePath);
    expect(profile).toContain(".vite-plus");
    expect(profile).not.toContain("/private/etc");
    expect(profile).not.toContain("/private/tmp");
    expect(profile).not.toContain("/tmp");
    expect(profile).not.toContain(".nvm");
    expect(profile).not.toContain(".bun");
    expect(profile).not.toContain("Library/pnpm");
    expect(profile).not.toContain(".ssh");
    expect(profile).not.toContain(".config");
  });

  it("uses a task-local temp root for approved check subprocesses", () => {
    const worktreePath = "/Users/test/worktrees/katacode-task-1";
    const tempPath = taskCheckTempPath(worktreePath);
    const env = taskCheckEnvironment(worktreePath);

    expect(tempPath).toBe(NodePath.join(worktreePath, ".kata-check-tmp"));
    expect(env.HOME).toBe(tempPath);
    expect(env.TMPDIR).toBe(tempPath);
    expect(env.TMP).toBe(tempPath);
    expect(env.TEMP).toBe(tempPath);
  });

  it.effect("wraps approved commands in the OS sandbox command for supported hosts", () =>
    Effect.gen(function* () {
      const platform = yield* HostProcessPlatform;
      const wrapped = sandboxApprovedCheckCommand({
        argv: ["vp", "run", "typecheck"],
        worktreePath: "/Users/test/worktrees/katacode-task-1",
        platform,
      });

      // The host OS alone does not prove the sandbox executable exists; a null
      // wrapper (e.g. no /usr/bin/sandbox-exec or bwrap on PATH) is a valid
      // outcome that needs no further shape assertions.
      if (wrapped === null) return;
      if (platform === "darwin") {
        expect(wrapped?.command).toBe("/usr/bin/sandbox-exec");
        expect(wrapped?.args).toContain("vp");
      } else if (platform === "linux") {
        expect(wrapped?.command).toMatch(/(?:^|\/)bwrap$/u);
        expect(wrapped?.args).toContain("vp");
      } else {
        expect(wrapped).toBeNull();
      }
    }),
  );

  it("reports unsupported sandbox capability without a host execution fallback", () => {
    expect(
      sandboxApprovedCheckCommand({
        argv: ["echo", "unsafe"],
        worktreePath: "/tmp/kata-check-worktree",
        platform: "freebsd",
      }),
    ).toBeNull();
  });
});

effectIt.layer(afterStateTimeoutRunnerLayer)(
  "TaskWorktreeCommandRunner after-state timeout",
  (it) => {
    it.effect("reports indeterminate when the after-state observation times out", () =>
      Effect.gen(function* () {
        const platform = yield* HostProcessPlatform;
        const { worktreePath, expectedBranch, expectedBaseCommitSha } = yield* setup;
        // The after-state timeout path only runs the check command when a
        // sandbox is available; without sandbox-exec/bwrap the runner
        // short-circuits with the no-sandbox indeterminate result before the
        // mocked after-observations, so there is nothing to assert.
        const sandboxed = sandboxApprovedCheckCommand({
          argv: ["true"],
          worktreePath,
          platform,
        });
        if (sandboxed === null) return;
        const runner = yield* TaskWorktreeCommandRunner;
        const result = yield* runner.run({
          worktreePath,
          expectedBranch,
          expectedBaseCommitSha,
          command: "pwd",
          timeoutMs: 15_000,
        });
        // A pass cannot be claimed on evidence the worktree is unchanged when
        // the after-state was never observed.
        expect(result.status).toBe("indeterminate");
        expect(result.endingCommitSha).toBeNull();
        expect(result.endingStatus).toBeNull();
      }),
    );
  },
);
