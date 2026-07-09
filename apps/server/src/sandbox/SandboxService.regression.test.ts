// @effect-diagnostics nodeBuiltinImport:off - tmp-dir setup for store-backed dispose regression.
/* eslint-disable kata-code/no-manual-effect-runtime-in-tests -- regression tests use Effect.runPromise for busy-dispose assertions. */
import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import { SandboxProviderInstanceId } from "@kata-sh/code-contracts/sandboxProviderInstance";
import type { ServerSettings } from "@kata-sh/code-contracts";

import * as CloudCliTokenManager from "../cloud/CliTokenManager.ts";
import {
  SandboxServiceLive,
  clearSandboxInstanceBusyForTests,
  configureSandboxRuntime,
  makeTestConnectionProbeInstanceId,
  markSandboxInstanceBusyForTests,
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

describe("SandboxService regression guards", () => {
  it("makeTestConnectionProbeInstanceId never equals the durable instance id", () => {
    const durable = "docker_docker_test_01";
    const probe = makeTestConnectionProbeInstanceId(durable);
    expect(probe).not.toBe(durable);
    expect(probe.startsWith(`${durable}__probe_`)).toBe(true);
    expect(makeTestConnectionProbeInstanceId(durable)).not.toBe(probe);
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
