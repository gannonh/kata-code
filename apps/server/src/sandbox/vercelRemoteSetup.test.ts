import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { it as vitIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";

import {
  SandboxProviderError,
  type SandboxExecResult,
  type SandboxHandle,
  type SandboxProvider,
} from "@kata-sh/code-sandbox/driver";

import {
  VERCEL_WORKSPACE,
  buildGitHubAuthSeedCommand,
  readRemoteEnvironmentConfig,
  seedGitHubAuth,
} from "./vercelRemoteSetup.ts";

const handle: SandboxHandle = {
  driverKind: "vercel" as never,
  instanceId: "inst_1",
  handle: {},
};

/** A driver stub that answers exec by matching a command substring. */
function execDriver(
  answer: (command: string) => SandboxExecResult | undefined,
): SandboxProvider & { readonly execs: ReadonlyArray<{ command: string; cwd?: string }> } {
  const execs: Array<{ command: string; cwd?: string }> = [];
  const driver = {
    kind: "vercel" as never,
    validate: () => Effect.void,
    provision: () => Effect.succeed(handle),
    exec: (_h: SandboxHandle, command: string, opts?: { readonly cwd?: string }) => {
      execs.push({ command, ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}) });
      const result = answer(command);
      return Effect.succeed(result ?? { exitCode: 0, stdout: "", stderr: "" });
    },
    reachability: () =>
      Effect.succeed({
        reachabilityKind: "public" as never,
        httpBaseUrl: "https://x",
        wsBaseUrl: "wss://x",
      }),
    dispose: () => Effect.void,
    describe: () =>
      Effect.succeed({
        kind: "vercel" as never,
        reachabilityKind: "public" as never,
        supportsSnapshot: false,
        supportsRenewTimeout: true,
        supportsCopyInto: true,
        supportsLifecycle: true,
        supportsProjectSource: false,
      }),
    copyInto: { copyInto: () => Effect.void },
  } as unknown as SandboxProvider;
  return Object.assign(driver, { execs });
}

describe("vercelRemoteSetup", () => {
  vitIt.effect("returns null when .kata/environment.json is absent (exit 1)", () =>
    Effect.gen(function* () {
      const driver = execDriver((command) =>
        command.includes("test -f") ? { exitCode: 1, stdout: "", stderr: "" } : undefined,
      );
      const raw = yield* readRemoteEnvironmentConfig(driver, handle);
      expect(raw).toBeNull();
      expect(driver.execs[0]?.cwd).toBe(VERCEL_WORKSPACE);
    }),
  );

  vitIt.effect("reads the remote config text when present (exit 0)", () =>
    Effect.gen(function* () {
      const config = '{"install":"pnpm i"}';
      const driver = execDriver((command) => {
        if (command.includes("test -f")) return { exitCode: 0, stdout: "", stderr: "" };
        if (command.includes("cat ")) return { exitCode: 0, stdout: config, stderr: "" };
        return undefined;
      });
      const raw = yield* readRemoteEnvironmentConfig(driver, handle);
      expect(raw).toBe(config);
    }),
  );

  vitIt.effect("fails loud when the remote read exits non-zero", () =>
    Effect.gen(function* () {
      const driver = execDriver((command) => {
        if (command.includes("test -f")) return { exitCode: 0, stdout: "", stderr: "" };
        if (command.includes("cat ")) return { exitCode: 2, stdout: "", stderr: "denied" };
        return undefined;
      });
      const outcome = yield* readRemoteEnvironmentConfig(driver, handle).pipe(Effect.result);
      expect(outcome._tag).toBe("Failure");
    }),
  );

  it("builds a gh auth seed command that never contains the token", () => {
    const command = buildGitHubAuthSeedCommand("/tmp/kata-github-auth-abc/token");
    expect(command).toContain("gh auth login --hostname github.com --with-token");
    expect(command).toContain("gh auth setup-git");
    expect(command).toContain("/tmp/kata-github-auth-abc/token");
    expect(command).toContain("trap");
  });

  vitIt.effect("rejects nonces outside the caller-generated lowercase hex format", () =>
    Effect.gen(function* () {
      const invalidNonces = [
        "../outside",
        "01234567/abcdefg",
        "01234567;rm-rf-x",
        "0123456789ABCDEF",
        "0123456789abcde",
      ];

      yield* Effect.forEach(invalidNonces, (nonce) =>
        Effect.gen(function* () {
          const driver = execDriver(() => undefined);
          const outcome = yield* seedGitHubAuth({
            driver,
            handle,
            token: "secret-token",
            nonce,
          }).pipe(Effect.exit);

          expect(outcome._tag).toBe("Failure");
          expect(driver.execs).toHaveLength(0);
          if (outcome._tag === "Failure") {
            expect(Cause.pretty(outcome.cause)).toContain("invalid GitHub credential nonce");
          }
        }),
      );
    }),
  );

  vitIt.effect("attempts independent cleanup when auth exec fails", () =>
    Effect.gen(function* () {
      const commands: string[] = [];
      const driver = execDriver(() => undefined);
      const failingDriver = {
        ...driver,
        exec: (_h: SandboxHandle, command: string) => {
          commands.push(command);
          return command.includes("gh auth login")
            ? Effect.fail(
                new SandboxProviderError({ reason: "unreachable", message: "transport failed" }),
              )
            : Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
        },
      } as SandboxProvider;

      const outcome = yield* seedGitHubAuth({
        driver: failingDriver,
        handle,
        token: "secret-token",
        nonce: "0000000000000001",
      }).pipe(Effect.result);

      expect(outcome._tag).toBe("Failure");
      expect(commands).toHaveLength(2);
      expect(commands[1]).toContain("rm -rf");
      expect(commands[1]).toContain("/tmp/kata-github-auth-0000000000000001");
      expect(commands.join(" ")).not.toContain("secret-token");
    }),
  );

  vitIt.effect("cleans the unique credential directory after successful auth", () =>
    Effect.gen(function* () {
      const driver = execDriver(() => undefined);
      yield* seedGitHubAuth({ driver, handle, token: "secret-token", nonce: "0000000000000002" });

      expect(driver.execs).toHaveLength(2);
      expect(driver.execs[1]?.command).toBe("rm -rf -- '/tmp/kata-github-auth-0000000000000002'");
      expect(driver.execs[1]?.cwd).toBe("/tmp");
    }),
  );

  vitIt.effect("cleans after a nonzero auth exit and redacts its output", () =>
    Effect.gen(function* () {
      const driver = execDriver((command) =>
        command.includes("gh auth login")
          ? { exitCode: 1, stdout: "", stderr: "rejected secret-token" }
          : undefined,
      );
      const outcome = yield* seedGitHubAuth({
        driver,
        handle,
        token: "secret-token",
        nonce: "0000000000000003",
      }).pipe(Effect.exit);

      expect(outcome._tag).toBe("Failure");
      expect(driver.execs[1]?.command).toContain("/tmp/kata-github-auth-0000000000000003");
      if (outcome._tag === "Failure") {
        const detail = Cause.pretty(outcome.cause);
        expect(detail).toContain("gh auth seed failed");
        expect(detail).not.toContain("secret-token");
      }
    }),
  );

  vitIt.effect("surfaces cleanup failure after successful auth", () =>
    Effect.gen(function* () {
      const driver = execDriver((command) =>
        command.startsWith("rm -rf")
          ? { exitCode: 2, stdout: "", stderr: "cleanup failed" }
          : undefined,
      );
      const outcome = yield* seedGitHubAuth({
        driver,
        handle,
        token: "secret-token",
        nonce: "0000000000000004",
      }).pipe(Effect.exit);

      expect(outcome._tag).toBe("Failure");
      if (outcome._tag === "Failure") {
        const detail = Cause.pretty(outcome.cause);
        expect(detail).toContain("failed to remove temporary GitHub credential directory");
        expect(detail).not.toContain("secret-token");
      }
    }),
  );

  vitIt.effect("surfaces redacted primary and cleanup failures together", () =>
    Effect.gen(function* () {
      const commands: string[] = [];
      const base = execDriver(() => undefined);
      const driver = {
        ...base,
        exec: (_h: SandboxHandle, command: string) => {
          commands.push(command);
          return Effect.succeed(
            command.includes("gh auth login")
              ? { exitCode: 1, stdout: "", stderr: "auth rejected secret-token" }
              : { exitCode: 2, stdout: "", stderr: "cleanup rejected secret-token" },
          );
        },
      } as SandboxProvider;
      const outcome = yield* seedGitHubAuth({
        driver,
        handle,
        token: "secret-token",
        nonce: "0000000000000005",
      }).pipe(Effect.exit);

      expect(outcome._tag).toBe("Failure");
      expect(commands).toHaveLength(2);
      if (outcome._tag === "Failure") {
        const detail = Cause.pretty(outcome.cause);
        expect(detail).toContain("gh auth seed failed");
        expect(detail).toContain("failed to remove temporary GitHub credential directory");
        expect(detail).not.toContain("secret-token");
      }
    }),
  );

  vitIt.effect("cleans after interruption once upload succeeds", () =>
    Effect.gen(function* () {
      const authStarted = yield* Deferred.make<void>();
      const commands: string[] = [];
      const base = execDriver(() => undefined);
      const driver = {
        ...base,
        exec: (_h: SandboxHandle, command: string) => {
          commands.push(command);
          return command.includes("gh auth login")
            ? Deferred.succeed(authStarted, undefined).pipe(Effect.andThen(Effect.never))
            : Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
        },
      } as SandboxProvider;
      const fiber = yield* seedGitHubAuth({
        driver,
        handle,
        token: "secret-token",
        nonce: "0000000000000006",
      }).pipe(Effect.forkChild);
      yield* Deferred.await(authStarted);
      yield* Fiber.interrupt(fiber);

      expect(commands).toHaveLength(2);
      expect(commands[1]).toBe("rm -rf -- '/tmp/kata-github-auth-0000000000000006'");
    }),
  );
});
