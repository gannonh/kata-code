import { describe, expect } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";

import { recoverDockerBootstrapToken } from "./sandboxStartSession.ts";

const kind = SandboxProviderDriverKind.make("docker");

const handle: SandboxHandle = {
  driverKind: kind,
  instanceId: "docker_e2e_lifecycle",
  handle: { containerId: "c1", containerName: "kata-sandbox-x", hostPort: 1, containerPort: 2 },
};

function driverWithEnvToken(stdout: string): SandboxProvider {
  return {
    kind,
    validate: () => Effect.void,
    provision: () => Effect.succeed(handle),
    exec: () => Effect.succeed({ exitCode: 0, stdout, stderr: "" }),
    reachability: () =>
      Effect.succeed({
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        httpBaseUrl: "http://localhost:1",
        wsBaseUrl: "ws://localhost:1",
      }),
    dispose: () => Effect.void,
    describe: () =>
      Effect.succeed({
        kind,
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        supportsSnapshot: false,
        supportsRenewTimeout: false,
        supportsCopyInto: false,
        supportsLifecycle: true,
      }),
  };
}

describe("recoverDockerBootstrapToken", () => {
  // Docker container env is fixed at create time. Both the lifecycle-start
  // path and the provision path that ADOPTS an existing named container must
  // register with the token the in-container server actually booted with;
  // registering with a freshly minted token fails `invalid_credential`.
  vitIt.effect("returns the create-time token from the container environment", () =>
    Effect.gen(function* () {
      const token = yield* recoverDockerBootstrapToken(
        driverWithEnvToken("create-time-token\n"),
        handle,
      );
      expect(token).toBe("create-time-token");
    }),
  );

  vitIt.effect("fails loud when the container has no bootstrap token", () =>
    Effect.gen(function* () {
      const result = yield* recoverDockerBootstrapToken(driverWithEnvToken(""), handle).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.succeed(error),
          onSuccess: () => Effect.succeed(null),
        }),
      );
      expect(result).not.toBeNull();
      expect(result?.reason).toBe("connect-failed");
      expect(result?.message).toContain("KATACODE_DESKTOP_BOOTSTRAP_TOKEN");
    }),
  );
});
