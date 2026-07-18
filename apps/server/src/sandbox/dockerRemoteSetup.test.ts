import * as Effect from "effect/Effect";
import { it as vitIt } from "@effect/vitest";
import { describe, expect, it } from "vite-plus/test";

import type {
  SandboxExecResult,
  SandboxHandle,
  SandboxProvider,
} from "@kata-sh/code-sandbox/driver";

import {
  DOCKER_WORKSPACE,
  buildDockerShallowCloneCommand,
  cloneGitHubSourceIntoWorkspace,
  readDockerRemoteEnvironmentConfig,
} from "./dockerRemoteSetup.ts";

const handle: SandboxHandle = {
  driverKind: "docker" as never,
  instanceId: "docker_test",
  handle: {},
};

function execDriver(
  answer: (command: string) => SandboxExecResult | undefined,
): SandboxProvider & { readonly execs: ReadonlyArray<{ command: string; cwd?: string }> } {
  const execs: Array<{ command: string; cwd?: string }> = [];
  const driver = {
    kind: "docker" as never,
    validate: () => Effect.void,
    provision: () => Effect.succeed(handle),
    exec: (_h: SandboxHandle, command: string, opts?: { readonly cwd?: string }) => {
      execs.push({ command, ...(opts?.cwd !== undefined ? { cwd: opts.cwd } : {}) });
      const result = answer(command);
      return Effect.succeed(result ?? { exitCode: 0, stdout: "", stderr: "" });
    },
    reachability: () =>
      Effect.succeed({
        reachabilityKind: "loopback" as never,
        httpBaseUrl: "http://localhost:1",
        wsBaseUrl: "ws://localhost:1",
      }),
    dispose: () => Effect.void,
    describe: () =>
      Effect.succeed({
        kind: "docker" as never,
        reachabilityKind: "loopback" as never,
        supportsSnapshot: false,
        supportsRenewTimeout: false,
        supportsCopyInto: true,
        supportsLifecycle: true,
      }),
  } as unknown as SandboxProvider;
  return Object.assign(driver, { execs });
}

describe("dockerRemoteSetup", () => {
  it("builds a shallow single-branch clone into /workspace", () => {
    const command = buildDockerShallowCloneCommand({
      httpsUrl: "https://github.com/octocat/Hello-World.git",
      branch: "main",
    });
    expect(command).toContain("git clone --depth 1 --single-branch --branch 'main'");
    expect(command).toContain("'https://github.com/octocat/Hello-World.git'");
    expect(command).toContain(DOCKER_WORKSPACE);
    expect(command).toContain("export HOME=/home/katacode");
  });

  vitIt.effect("clone surfaces concrete stderr and fails loud", () =>
    Effect.gen(function* () {
      const driver = execDriver((command) =>
        command.includes("git clone")
          ? { exitCode: 128, stdout: "", stderr: "fatal: repository not found" }
          : undefined,
      );
      const error = yield* cloneGitHubSourceIntoWorkspace({
        driver,
        handle,
        httpsUrl: "https://github.com/octocat/missing.git",
        branch: "main",
      }).pipe(Effect.flip);
      expect(error._tag).toBe("DockerRemoteSetupError");
      expect(error.message).toContain("repository not found");
      expect(driver.execs[0]?.command).toContain("git clone");
    }),
  );

  vitIt.effect("clone succeeds on zero exit", () =>
    Effect.gen(function* () {
      const driver = execDriver(() => ({ exitCode: 0, stdout: "", stderr: "" }));
      yield* cloneGitHubSourceIntoWorkspace({
        driver,
        handle,
        httpsUrl: "https://github.com/octocat/Hello-World.git",
        branch: "main",
      });
      expect(driver.execs).toHaveLength(1);
    }),
  );

  vitIt.effect("returns null when .kata/environment.json is absent", () =>
    Effect.gen(function* () {
      const driver = execDriver((command) =>
        command.includes("test -f") ? { exitCode: 1, stdout: "", stderr: "" } : undefined,
      );
      const raw = yield* readDockerRemoteEnvironmentConfig(driver, handle);
      expect(raw).toBeNull();
      expect(driver.execs[0]?.cwd).toBe(DOCKER_WORKSPACE);
    }),
  );

  vitIt.effect("reads remote config text when present", () =>
    Effect.gen(function* () {
      const config = '{"install":"pnpm i"}';
      const driver = execDriver((command) => {
        if (command.includes("test -f")) return { exitCode: 0, stdout: "", stderr: "" };
        if (command.includes("cat ")) return { exitCode: 0, stdout: config, stderr: "" };
        return undefined;
      });
      const raw = yield* readDockerRemoteEnvironmentConfig(driver, handle);
      expect(raw).toBe(config);
    }),
  );
});
