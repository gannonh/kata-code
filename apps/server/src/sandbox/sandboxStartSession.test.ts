import { describe, expect } from "vite-plus/test";
import { it as vitIt } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";

import { resolveBootstrapToken } from "./sandboxStartSession.ts";

const kind = SandboxProviderDriverKind.make("docker");

const handle: SandboxHandle = {
  driverKind: kind,
  instanceId: "docker_e2e_lifecycle",
  handle: { containerId: "c1", containerName: "kata-sandbox-x", hostPort: 1, containerPort: 2 },
};

function driverWithResolver(resolve: SandboxProvider["resolveBootstrapToken"]): SandboxProvider {
  return {
    kind,
    validate: () => Effect.void,
    provision: () => Effect.succeed(handle),
    exec: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
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
    ...(resolve ? { resolveBootstrapToken: resolve } : {}),
  };
}

describe("resolveBootstrapToken", () => {
  vitIt.effect("keeps the minted token when the driver has no resolver", () =>
    Effect.gen(function* () {
      const token = yield* resolveBootstrapToken(driverWithResolver(undefined), handle, "minted");
      expect(token).toBe("minted");
    }),
  );

  vitIt.effect("uses the driver-resolved create-time token when present", () =>
    Effect.gen(function* () {
      const token = yield* resolveBootstrapToken(
        driverWithResolver((_handle, _minted) => Effect.succeed("create-time-token")),
        handle,
        "minted",
      );
      expect(token).toBe("create-time-token");
    }),
  );
});
