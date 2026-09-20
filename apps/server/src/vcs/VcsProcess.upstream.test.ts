import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { ChildProcessSpawner } from "effect/unstable/process";

import { VcsProcessExitError } from "@kata-sh/code-contracts";
import * as ProcessRunner from "../processRunner.ts";
import * as VcsProcess from "./VcsProcess.ts";

const encodeExitError = Schema.encodeEffect(Schema.fromJsonString(VcsProcessExitError));

const run = (input: VcsProcess.VcsProcessInput) =>
  Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    return yield* process.run(input);
  });

const liveLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));

const provideLive = <A, E, R>(effect: Effect.Effect<A, E, R | VcsProcess.VcsProcess>) =>
  effect.pipe(Effect.provide(liveLayer));

const baseInput = {
  operation: "test.process-boundary",
  command: "git",
  args: ["status", "--short"],
  cwd: "/workspace",
} satisfies VcsProcess.VcsProcessInput;

const captureProcessResult = (
  result: Effect.Effect<ProcessRunner.ProcessRunOutput, ProcessRunner.ProcessRunError>,
) =>
  VcsProcess.make.pipe(
    Effect.provideService(
      ProcessRunner.ProcessRunner,
      ProcessRunner.ProcessRunner.of({
        run: () => result,
        runBytes: () => Effect.die("unused binary process runner"),
      }),
    ),
    Effect.flatMap((service) => service.run(baseInput)),
    Effect.flip,
  );

describe("VcsProcess.run", () => {
  it.effect("streams all stdout bytes beyond the buffered output cap", () =>
    Effect.gen(function* () {
      const chunks: Uint8Array[] = [];
      const result = yield* run({
        operation: "test.stream-output",
        command: "node",
        args: ["-e", "process.stdout.write('x'.repeat(131072) + '\\0S final\\0')"],
        cwd: process.cwd(),
        maxOutputBytes: 8,
        onStdoutChunk: (chunk) => chunks.push(chunk),
      });

      expect(result.stdout).toBe("xxxxxxxx");
      expect(result.stdoutTruncated).toBe(true);
      expect(Buffer.concat(chunks).toString()).toBe("x".repeat(131072) + "\0S final\0");
    }).pipe(provideLive),
  );

  it.effect.each([
    { stderr: "fatal: Unable to create '/private/repo/index.lock': File exists", retryable: true },
    {
      stderr: "fatal: Unable to create '/private/repo/index.lock': Permission denied",
      retryable: false,
    },
    { stderr: 'error: open("/private/repo/file"): No such file or directory', retryable: true },
    {
      stderr: "fatal: unable to stat '/private/repo/file': No such file or directory",
      retryable: true,
    },
    { stderr: 'error: open("/private/repo/file"): Permission denied', retryable: false },
    {
      stderr: "error: '/private/repo/child/' does not have a commit checked out",
      retryable: false,
    },
    { stderr: "fatal: index file corrupt", retryable: false },
  ])(
    "classifies Git exit retryability without retaining stderr: $stderr",
    ({ stderr, retryable }) =>
      Effect.gen(function* () {
        const error = yield* captureProcessResult(
          Effect.succeed({
            stdout: "",
            stderr,
            code: ChildProcessSpawner.ExitCode(128),
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
          }),
        );
        assert.instanceOf(error, VcsProcessExitError);
        expect(error.retryable === true).toBe(retryable);
        const encoded = yield* encodeExitError(error);
        expect(encoded).not.toContain("/private/repo");
      }),
  );

  it.effect.each(["timeout", "spawn"] as const)(
    "checkpoint commands do not retry %s failures",
    (kind) =>
      Effect.gen(function* () {
        let attempts = 0;
        const fields = { command: "git", argumentCount: 2, cwd: "/workspace" };
        const failure =
          kind === "timeout"
            ? new ProcessRunner.ProcessTimeoutError({ ...fields, timeoutMs: 30_000 })
            : new ProcessRunner.ProcessSpawnError({ ...fields, cause: new Error("spawn failed") });
        const service = yield* VcsProcess.make.pipe(
          Effect.provideService(ProcessRunner.ProcessRunner, {
            run: () =>
              Effect.sync(() => {
                attempts += 1;
              }).pipe(Effect.andThen(Effect.fail(failure))),
            runBytes: () => Effect.die("unused binary process runner"),
          }),
        );
        const error = yield* service
          .run({
            ...baseInput,
            operation: VcsProcess.CHECKPOINT_CAPTURE_OPERATION,
          })
          .pipe(Effect.flip);
        expect(attempts).toBe(1);
        expect(error._tag).toBe(
          kind === "timeout" ? "VcsProcessTimeoutError" : "VcsProcessSpawnError",
        );
      }),
  );

  it.effect.each([
    {
      name: "recovers after two lock failures",
      failures: 2,
      attempts: 3,
      transient: true,
      capture: true,
      streaming: false,
    },
    {
      name: "bounds persistent lock failures",
      failures: Infinity,
      attempts: 3,
      transient: true,
      capture: true,
      streaming: false,
    },
    {
      name: "does not retry unknown exits",
      failures: Infinity,
      attempts: 1,
      transient: false,
      capture: true,
      streaming: false,
    },
    {
      name: "leaves other operations unchanged",
      failures: Infinity,
      attempts: 1,
      transient: true,
      capture: false,
      streaming: false,
    },
    {
      name: "does not replay stdout callbacks",
      failures: Infinity,
      attempts: 1,
      transient: true,
      capture: true,
      streaming: true,
    },
  ])(
    "checkpoint command retry $name",
    ({ failures, attempts: expectedAttempts, transient, capture, streaming }) =>
      Effect.gen(function* () {
        let attempts = 0;
        const service = yield* VcsProcess.make.pipe(
          Effect.provideService(ProcessRunner.ProcessRunner, {
            run: () =>
              Effect.sync(() => {
                attempts += 1;
                return {
                  stdout: "",
                  stderr:
                    attempts > failures
                      ? ""
                      : transient
                        ? "fatal: Unable to create '/repo/index.lock': File exists"
                        : "fatal: index file corrupt",
                  code: ChildProcessSpawner.ExitCode(attempts > failures ? 0 : attempts),
                  timedOut: false,
                  stdoutTruncated: false,
                  stderrTruncated: false,
                  stdoutInvalidUtf8: false,
                  stderrInvalidUtf8: false,
                };
              }),
            runBytes: () => Effect.die("unused binary process runner"),
          }),
        );
        const fiber = yield* service
          .run({
            ...baseInput,
            operation: capture ? VcsProcess.CHECKPOINT_CAPTURE_OPERATION : baseInput.operation,
            ...(streaming ? { onStdoutChunk: () => {} } : {}),
          })
          .pipe(Effect.exit, Effect.forkScoped);
        yield* TestClock.adjust("150 millis");
        const result = yield* Fiber.join(fiber);
        expect(attempts).toBe(expectedAttempts);
        if (failures === Infinity) {
          if (Exit.isSuccess(result))
            return yield* Effect.die("Expected a capture command failure");
          const error = Cause.findErrorOption(result.cause);
          if (error._tag === "None" || error.value._tag !== "VcsProcessExitError") {
            return yield* Effect.die("Expected a Git exit error");
          }
          expect(error.value.exitCode).toBe(expectedAttempts);
        } else {
          expect(Exit.isSuccess(result)).toBe(true);
        }
      }),
  );
});
