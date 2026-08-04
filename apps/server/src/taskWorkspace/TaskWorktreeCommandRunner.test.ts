// @effect-diagnostics nodeBuiltinImport:off - the runner executes real git and node processes in a fixture worktree.
import { execFile } from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { promisify } from "node:util";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import {
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
});
