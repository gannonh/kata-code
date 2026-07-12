// @effect-diagnostics nodeBuiltinImport:off - tmp-dir setup for store-backed dispose regression.
/* eslint-disable kata-code/no-manual-effect-runtime-in-tests -- regression tests use Effect.runPromise for busy-dispose assertions. */
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { SandboxProviderInstanceId } from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { ServerSettings } from "@kata-sh/code-contracts";
import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CloudCliTokenManager from "../cloud/CliTokenManager.ts";
import {
  SandboxServiceLive,
  clearLiveSessionForTests,
  clearSandboxInstanceBusyForTests,
  configureSandboxRuntime,
  makeTestConnectionProbeInstanceId,
  markSandboxInstanceBusyForTests,
  renewSandboxRelayLeases,
  setLiveSessionForTests,
} from "./SandboxService.ts";

const either = <A, E>(
  eff: Effect.Effect<A, E>,
): Effect.Effect<{ _tag: "Left"; left: E } | { _tag: "Right"; right: A }, never> =>
  Effect.matchEffect(eff, {
    onFailure: (left) => Effect.succeed<{ _tag: "Left"; left: E }>({ _tag: "Left", left }),
    onSuccess: (right) => Effect.succeed<{ _tag: "Right"; right: A }>({ _tag: "Right", right }),
  });

/** Minimal CLI token manager so disposeSession's R channel is satisfied. */
const stubCloudCliTokenManager = Layer.mock(CloudCliTokenManager.CloudCliTokenManager)({
  get: Effect.die(new Error("Unexpected Kata Code Connect CLI authorization request.")),
  getExisting: Effect.succeed(Option.none()),
  hasCredential: Effect.succeed(false),
  clear: Effect.void,
});

const stubServerSecretStore = Layer.mock(ServerSecretStore.ServerSecretStore)({
  get: () => Effect.succeed(null),
  set: () => Effect.void,
  create: () => Effect.void,
  getOrCreateRandom: () => Effect.die(new Error("Unexpected secret generation request.")),
  remove: () => Effect.void,
});

const startSessionTestLayer = Layer.mergeAll(
  stubCloudCliTokenManager,
  stubServerSecretStore,
  NodeServices.layer,
);

describe("SandboxService regression guards", () => {
  it("makeTestConnectionProbeInstanceId never equals the durable instance id", () => {
    const durable = "docker_docker_test_01";
    const probe = makeTestConnectionProbeInstanceId(durable);
    expect(probe).not.toBe(durable);
    expect(probe.startsWith(`${durable}__probe_`)).toBe(true);
    expect(makeTestConnectionProbeInstanceId(durable)).not.toBe(probe);
  });

  it("providerLoginStart refuses when the durable store marks the session stopped", async () => {
    const home = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-sandbox-login-"));
    const instanceId = SandboxProviderInstanceId.make("docker_login_stopped");
    try {
      await NodeFs.mkdir(home, { recursive: true });
      await NodeFs.writeFile(
        NodePath.join(home, "sandbox-sessions.json"),
        JSON.stringify({
          records: [
            {
              instanceId: instanceId as string,
              driverKind: "docker",
              environmentId: instanceId as string,
              sandboxEnvironmentId: "env_login_stopped",
              handle: {
                driverKind: "docker",
                handle: {
                  containerId: "c1",
                  containerName: "kata-sandbox-docker_login_stopped",
                  hostPort: 1,
                  containerPort: 13773,
                },
              },
              endpoint: {
                id: "sandbox-docker_login_stopped",
                label: "Stopped",
                httpBaseUrl: "http://localhost:1",
              },
              status: "stopped",
            },
          ],
        }),
        "utf8",
      );
      configureSandboxRuntime({ stateDir: home });

      const kind = SandboxProviderDriverKind.make("docker");
      const handle: SandboxHandle = {
        driverKind: kind,
        instanceId: instanceId as string,
        handle: { containerId: "c1" },
      };
      const driver: SandboxProvider = {
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
      };
      // Live cache can still hold a handle after stopSession; store status wins.
      setLiveSessionForTests(instanceId as string, {
        handle,
        driver,
        instanceConfig: { driver: kind, config: {} },
        environmentId: "env_login_stopped",
      });

      const result = await Effect.runPromise(
        either(
          Stream.runCollect(
            SandboxServiceLive.providerLoginStart({ instanceId, providerId: "claude" }),
          ),
        ),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.reason).toBe("not-running");
        expect(result.left.message).toContain("No running sandbox session");
      }
    } finally {
      clearLiveSessionForTests(instanceId as string);
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });

  it("startSession resolves the configured store when the effect executes", async () => {
    const firstHome = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-sandbox-first-"));
    const secondHome = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-sandbox-second-"));
    const instanceId = SandboxProviderInstanceId.make("missing_lazy_store");
    const settings = {
      sandboxProviderInstances: {
        [instanceId]: { driver: "missing-driver", config: {} },
      },
      savedSandboxEnvironments: {},
    } as unknown as ServerSettings;

    try {
      configureSandboxRuntime({ stateDir: firstHome });
      const start = SandboxServiceLive.startSession(instanceId, settings).pipe(
        Effect.provide(startSessionTestLayer),
      );

      await NodeFs.writeFile(
        NodePath.join(secondHome, "sandbox-sessions.json"),
        JSON.stringify({
          records: [
            {
              instanceId: instanceId as string,
              driverKind: "missing-driver",
              environmentId: instanceId as string,
              sandboxEnvironmentId: "env_lazy_store",
              handle: { driverKind: "missing-driver", handle: {} },
              endpoint: {
                id: "sandbox-missing_lazy_store",
                label: "Lazy store",
                httpBaseUrl: "http://localhost:1",
              },
              status: "running",
            },
          ],
        }),
        "utf8",
      );
      configureSandboxRuntime({ stateDir: secondHome });
      await Effect.runPromise(
        renewSandboxRelayLeases().pipe(Effect.provide(stubCloudCliTokenManager)),
      );

      const result = await Effect.runPromise(either(start));
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("already running");
      }
    } finally {
      clearSandboxInstanceBusyForTests(instanceId as string);
      await Promise.all([
        NodeFs.rm(firstHome, { recursive: true, force: true }),
        NodeFs.rm(secondHome, { recursive: true, force: true }),
      ]);
    }
  });

  it("disposeSession fails loud when the instance is already busy", async () => {
    const home = await NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-sandbox-busy-"));
    try {
      const instanceId = SandboxProviderInstanceId.make("docker_busy_01");
      // Seed the store file before configure so the service loads the record.
      await NodeFs.mkdir(home, { recursive: true });
      await NodeFs.writeFile(
        NodePath.join(home, "sandbox-sessions.json"),
        JSON.stringify({
          records: [
            {
              instanceId: instanceId as string,
              driverKind: "docker",
              environmentId: instanceId as string,
              sandboxEnvironmentId: "env_busy",
              handle: {
                driverKind: "docker",
                handle: {
                  containerId: "c1",
                  containerName: "kata-sandbox-docker_busy_01",
                  hostPort: 1,
                  containerPort: 13773,
                },
              },
              endpoint: {
                id: "sandbox-docker_busy_01",
                label: "Busy",
                httpBaseUrl: "http://localhost:1",
              },
              status: "running",
            },
          ],
        }),
        "utf8",
      );
      configureSandboxRuntime({ stateDir: home });
      markSandboxInstanceBusyForTests(instanceId as string);
      const settings = {
        sandboxProviderInstances: {
          [instanceId]: { driver: "docker", config: {} },
        },
        savedSandboxEnvironments: {},
      } as unknown as ServerSettings;
      const result = await Effect.runPromise(
        either(
          SandboxServiceLive.disposeSession(instanceId, settings).pipe(
            Effect.provide(stubCloudCliTokenManager),
          ),
        ),
      );
      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("already in progress");
      }
    } finally {
      clearSandboxInstanceBusyForTests("docker_busy_01");
      await NodeFs.rm(home, { recursive: true, force: true });
    }
  });
});
