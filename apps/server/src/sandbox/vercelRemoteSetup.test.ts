import * as Effect from "effect/Effect";
import { it as vitIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";

import type {
  SandboxExecResult,
  SandboxHandle,
  SandboxProvider,
} from "@kata-sh/code-sandbox/driver";

import {
  VERCEL_WORKSPACE,
  buildGitHubAuthSeedCommand,
  readRemoteEnvironmentConfig,
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
});
