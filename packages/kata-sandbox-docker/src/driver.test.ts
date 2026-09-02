// @effect-diagnostics preferSchemaOverJson:off - these tests inspect private Docker request JSON.

import { ProviderInstanceId, type ModelSelection } from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { SandboxGitHubCheckoutCredential } from "@kata-sh/code-kata-sandbox/driver";

import {
  DockerResourceHandle,
  SandboxDeploymentIntent,
  SandboxProfile,
  SandboxProviderLabels,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  DockerEngineError,
  type DockerEngine,
  type DockerRequest,
  type DockerResponse,
} from "./engine.ts";
import {
  DOCKER_KIND,
  SANDBOX_RUNTIME_GID,
  SANDBOX_RUNTIME_UID,
  buildAuthArchive,
  buildProviderSettingsArchive,
  dockerContainerName,
  dockerOwnershipLabels,
  IMAGE_NOT_BUILT_BY_KATA,
  hostIpForEndpoint,
  makeDockerSandboxDriver,
  publishHostForBind,
  sandboxImageLabels,
} from "./driver.ts";

const decodeProfile = Schema.decodeUnknownSync(SandboxProfile);
const decodeIntent = Schema.decodeUnknownSync(SandboxDeploymentIntent);
const decodeResource = Schema.decodeUnknownSync(DockerResourceHandle);

const profile = decodeProfile({
  profileId: "profile-1",
  name: "Local Docker",
  driverKind: "docker",
  socketPath: "/var/run/docker.sock",
  imageDigest:
    "ghcr.io/kata-sh/kata@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  enabled: true,
  revision: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
});

const intent = decodeIntent({
  deploymentId: "deployment-1",
  controlEnvironmentId: "control-1",
  profileId: "profile-1",
  profileRevision: 1,
  profileSnapshot: profile,
  providerInstanceId: ProviderInstanceId.make("codex-1"),
  label: "Docker sandbox",
  source: {
    repository: "gannonh/kata-code",
    ref: "main",
    resolvedCommitSha: "0123456789abcdef0123456789abcdef01234567",
  },
  bootstrapManifest: {
    version: 1,
    imageDigest: profile.imageDigest,
    kataVersion: "0.0.42",
    serverVersion: "0.0.42",
    serverArtifactSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    codexVersion: "0.1.0",
    codexArtifactSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  },
  workspaceRoot: "/workspace",
  kataHome: "/var/lib/katacode",
  requestedAt: "2026-08-30T00:00:00.000Z",
});

const manifest = intent.bootstrapManifest;
const labeledImageInspect = JSON.stringify({
  Config: {
    Labels: sandboxImageLabels({
      kataVersion: manifest.kataVersion,
      serverVersion: manifest.serverVersion,
      serverArtifactSha256: manifest.serverArtifactSha256,
      codexVersion: manifest.codexVersion,
      codexArtifactSha256: manifest.codexArtifactSha256,
    }),
  },
});

const inspect = (labels: Record<string, string>, running = false) => ({
  Id: "container-1",
  Name: "/" + dockerContainerName(intent.deploymentId),
  State: { Running: running },
  Config: { Labels: labels },
  NetworkSettings: {
    Ports: {
      "3773/tcp": [{ HostPort: "41001" }],
    },
  },
});

function response(status: number, body = ""): DockerResponse {
  return { status, body };
}

function fakeEngine(request: (request: DockerRequest) => DockerResponse): DockerEngine {
  return {
    request: (input) => Effect.succeed(request(input)),
    requestBuffer: () => Effect.succeed({ status: 200, body: new Uint8Array() }),
    requestStdin: () => Effect.succeed({ status: 101, body: new Uint8Array() }),
  };
}

describe("Docker sandbox driver", () => {
  it.effect("validates the daemon and exact local image", () => {
    const requests: DockerRequest[] = [];
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        requests.push(request);
        if (request.path === "/_ping") return response(200, "OK");
        if (request.path.startsWith("/images/")) return response(200, labeledImageInspect);
        if (request.path === "/version") return response(200, '{"ApiVersion":"1.45"}');
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      const result = yield* driver.validateProfile(profile);
      expect(result.imageDigest).toBe(profile.imageDigest);
      expect(result.kataVersion).toBe(manifest.kataVersion);
      expect(result.serverArtifactSha256).toBe(manifest.serverArtifactSha256);
      expect(result.codexVersion).toBe(manifest.codexVersion);
      expect(requests.map((request) => request.path)).toEqual([
        "/_ping",
        "/images/" + encodeURIComponent(profile.imageDigest) + "/json",
        "/version",
      ]);
      expect(requests.some((request) => request.path.startsWith("/images/create"))).toBe(false);
    });
  });

  it.effect("reports a missing Kata image label as an unavailable profile", () => {
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        if (request.path === "/_ping") return response(200, "OK");
        if (request.path.startsWith("/images/")) return response(200, "{}");
        if (request.path === "/version") return response(200, '{"ApiVersion":"1.45"}');
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      const result = yield* Effect.flip(driver.validateProfile(profile));
      expect(result.reason).toBe("invalid-profile");
      expect(result.message).toBe(IMAGE_NOT_BUILT_BY_KATA);
    });
  });

  it.effect("does not pull a missing local content-addressed image id", () => {
    const requests: DockerRequest[] = [];
    const localProfile = decodeProfile({
      ...profile,
      imageDigest: "sha256:" + "f".repeat(64),
    });
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        requests.push(request);
        if (request.path === "/_ping") return response(200, "OK");
        if (request.path.startsWith("/images/")) return response(404);
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      const result = yield* Effect.exit(driver.validateProfile(localProfile));
      expect(result._tag).toBe("Failure");
      expect(requests.some((request) => request.path.startsWith("/images/create"))).toBe(false);
    });
  });

  it.effect("pulls a missing image and reports bounded validation stages", () => {
    const requests: DockerRequest[] = [];
    const stages: string[] = [];
    const counts: Array<{
      readonly downloadedBytes?: number;
      readonly totalBytes?: number | null;
      readonly layersCompleted?: number;
      readonly layersTotal?: number | null;
    }> = [];
    let inspectCount = 0;
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        requests.push(request);
        if (request.path === "/_ping") return response(200, "OK");
        if (request.path.startsWith("/images/") && request.path.endsWith("/json")) {
          inspectCount += 1;
          return inspectCount === 1 ? response(404) : response(200, labeledImageInspect);
        }
        if (request.path.startsWith("/images/create")) {
          return response(
            200,
            '{"id":"layer-1","status":"Downloading","progressDetail":{"current":1,"total":2}}\n{"id":"layer-1","status":"Pull complete"}',
          );
        }
        if (request.path === "/version") return response(200, '{"ApiVersion":"1.45"}');
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      yield* driver.validateProfile(profile, (progress) => {
        stages.push(progress.stage);
        if (progress.stage === "pulling-image" && progress.downloadedBytes !== undefined) {
          counts.push({
            downloadedBytes: progress.downloadedBytes,
            ...(progress.totalBytes === undefined ? {} : { totalBytes: progress.totalBytes }),
            ...(progress.layersCompleted === undefined
              ? {}
              : { layersCompleted: progress.layersCompleted }),
            ...(progress.layersTotal === undefined ? {} : { layersTotal: progress.layersTotal }),
          });
        }
        return Effect.void;
      });
      expect(stages).toEqual([
        "pulling-image",
        "pulling-image",
        "pulling-image",
        "validating-image",
      ]);
      expect(counts).toEqual([
        {
          downloadedBytes: 0,
          totalBytes: null,
          layersCompleted: 0,
          layersTotal: null,
        },
        {
          downloadedBytes: 1,
          totalBytes: 2,
          layersCompleted: 0,
          layersTotal: 1,
        },
        {
          downloadedBytes: 0,
          totalBytes: null,
          layersCompleted: 1,
          layersTotal: 1,
        },
      ]);
      expect(requests.map((request) => request.path)).toEqual([
        "/_ping",
        "/images/" + encodeURIComponent(profile.imageDigest) + "/json",
        "/images/create?fromImage=" + encodeURIComponent(profile.imageDigest),
        "/images/" + encodeURIComponent(profile.imageDigest) + "/json",
        "/version",
      ]);
    });
  });

  it.effect("fails a 200 Docker pull that reports an error line", () => {
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        if (request.path === "/_ping") return response(200, "OK");
        if (request.path.startsWith("/images/") && request.path.endsWith("/json")) {
          return response(404);
        }
        if (request.path.startsWith("/images/create")) {
          return response(
            200,
            '{"status":"Pulling from library/missing"}\n{"error":"pull access denied","errorDetail":{"message":"pull access denied"}}',
          );
        }
        if (request.path === "/version") return response(200, '{"ApiVersion":"1.45"}');
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      const result = yield* Effect.result(driver.validateProfile(profile));
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.reason).toBe("image-unavailable");
        expect(result.failure.message).toBe("pull access denied");
      }
    });
  });

  it.effect("adopts a resource only when every ownership label matches", () => {
    const labels = dockerOwnershipLabels(intent);
    const requests: DockerRequest[] = [];
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        requests.push(request);
        return request.path.includes("/containers/")
          ? response(200, JSON.stringify(inspect(labels)))
          : response(404);
      }),
    });

    return Effect.gen(function* () {
      const resource = yield* driver.allocate({
        profile,
        intent,
        manifest,
        codexAuthJson: new Uint8Array([123]),
      });
      expect(resource.containerId).toBe("container-1");
      expect(resource.containerName).toBe(dockerContainerName(intent.deploymentId));
      expect(resource.hostPort).toBe(41001);
      expect(requests.every((request) => request.method !== "POST")).toBe(true);
    });
  });

  it.effect("persists a newly created container before Docker assigns its host port", () => {
    const labels = dockerOwnershipLabels(intent);
    const requests: DockerRequest[] = [];
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        requests.push(request);
        if (request.path.startsWith("/containers/create?")) {
          return response(201, '{"Id":"container-1"}');
        }
        if (request.path === "/containers/container-1/json") {
          return response(
            200,
            JSON.stringify({
              ...inspect(labels),
              NetworkSettings: { Ports: { "3773/tcp": null } },
            }),
          );
        }
        if (request.path.includes("/containers/") && request.path.endsWith("/json")) {
          return response(404);
        }
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      const resource = yield* driver.allocate({
        profile,
        intent,
        manifest,
        codexAuthJson: new Uint8Array([123]),
      });
      expect(resource.hostPort).toBeUndefined();
      expect(requests.some((request) => request.path.endsWith("/start"))).toBe(false);
    });
  });

  it.effect("publishes remote sandboxes and gates server startup on checkout", () => {
    const labels = dockerOwnershipLabels(intent);
    let createRequest: DockerRequest | undefined;
    const driver = makeDockerSandboxDriver({
      endpointHost: "192.168.1.42",
      engine: fakeEngine((request) => {
        if (request.path.startsWith("/containers/create?")) {
          createRequest = request;
          return response(201, '{"Id":"container-1"}');
        }
        if (request.path === "/containers/container-1/json") {
          return response(200, JSON.stringify(inspect(labels)));
        }
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      yield* driver.allocate({
        profile,
        intent,
        manifest,
        codexAuthJson: new Uint8Array([123]),
      });

      const body = JSON.parse(createRequest?.body ?? "{}") as {
        readonly Cmd?: ReadonlyArray<string>;
        readonly HostConfig?: {
          readonly Tmpfs?: Record<string, string>;
          readonly PortBindings?: Record<
            string,
            ReadonlyArray<{ readonly HostIp?: string; readonly HostPort?: string }>
          >;
        };
      };
      expect(body.Cmd?.[0]).toBe("sh");
      expect(body.Cmd?.[2]).toContain("while [ ! -f '/tmp/kata-sandbox-checkout-ready'");
      expect(body.Cmd?.[2]).toContain("exec katacode serve --host 0.0.0.0 --port 3773");
      expect(body.HostConfig?.PortBindings?.["3773/tcp"]?.[0]?.HostIp).toBe("192.168.1.42");
      expect(body.HostConfig?.Tmpfs).toEqual({
        "/run/kata-credentials": "rw,exec,nosuid,nodev,size=65536,uid=1001,gid=1001,mode=0700",
      });
    });
  });

  it("binds published ports to loopback unless the control server opted into a host address", () => {
    expect(hostIpForEndpoint("127.0.0.1")).toBe("127.0.0.1");
    expect(hostIpForEndpoint("localhost")).toBe("127.0.0.1");
    expect(hostIpForEndpoint("0.0.0.0")).toBe("127.0.0.1");
    expect(hostIpForEndpoint("192.168.1.42")).toBe("192.168.1.42");
    expect(publishHostForBind(undefined)).toBe("127.0.0.1");
    expect(publishHostForBind("0.0.0.0")).toBe("127.0.0.1");
    expect(publishHostForBind("192.168.1.42")).toBe("192.168.1.42");
  });

  it.effect(
    "publishes loopback by default when the endpoint host is the machine LAN address",
    () => {
      let createRequest: DockerRequest | undefined;
      const driver = makeDockerSandboxDriver({
        endpointHost: "192.168.1.42",
        publishHost: "127.0.0.1",
        engine: fakeEngine((request) => {
          if (request.path.startsWith("/containers/create?")) {
            createRequest = request;
            return response(201, '{"Id":"container-1"}');
          }
          if (request.path === "/containers/container-1/json") {
            return response(200, JSON.stringify(inspect(dockerOwnershipLabels(intent))));
          }
          return response(404);
        }),
      });

      return Effect.gen(function* () {
        yield* driver.allocate({
          profile,
          intent,
          manifest,
          codexAuthJson: new Uint8Array([123]),
        });
        const body = JSON.parse(createRequest?.body ?? "{}") as {
          readonly HostConfig?: {
            readonly PortBindings?: Record<string, ReadonlyArray<{ readonly HostIp?: string }>>;
          };
        };
        expect(body.HostConfig?.PortBindings?.["3773/tcp"]?.[0]?.HostIp).toBe("127.0.0.1");
      });
    },
  );

  it.effect("streams the GitHub token only through upgraded exec stdin", () => {
    const labels = dockerOwnershipLabels(intent);
    const sentinel = "github-token-sentinel";
    const captured: DockerRequest[] = [];
    const execCommands = new Map<string, string>();
    let execId = 0;
    let credentialCalls = 0;
    let inspectCalls = 0;
    const stdinWrites: Array<{ readonly request: DockerRequest; readonly bytes: Uint8Array }> = [];
    const credential: SandboxGitHubCheckoutCredential = {
      withToken: (use) => {
        credentialCalls += 1;
        return use(Buffer.from(sentinel));
      },
    };
    const engine: DockerEngine = {
      request: (request) =>
        Effect.sync(() => {
          captured.push({
            ...request,
            ...(request.bodyBytes === undefined
              ? {}
              : { bodyBytes: Uint8Array.from(request.bodyBytes) }),
          });
          if (request.path.includes("/archive?path=")) return response(200);
          if (request.path === "/containers/container-1/json") {
            inspectCalls += 1;
            return response(200, JSON.stringify(inspect(labels, inspectCalls > 1)));
          }
          if (request.path === "/containers/container-1/start") return response(204);
          if (request.path === "/containers/container-1/exec") {
            const id = `exec-${++execId}`;
            const body = JSON.parse(request.body ?? "{}") as { Cmd?: string[] };
            execCommands.set(id, body.Cmd?.[2] ?? "");
            return response(201, JSON.stringify({ Id: id }));
          }
          if (request.path.startsWith("/exec/") && request.path.endsWith("/json")) {
            const id = request.path.split("/")[2] ?? "";
            const command = execCommands.get(id) ?? "";
            return response(
              200,
              JSON.stringify({
                ExitCode:
                  command.includes("rev-parse HEAD") && !command.includes(" fetch --depth=1 ")
                    ? 1
                    : 0,
              }),
            );
          }
          return response(404);
        }),
      requestBuffer: (request) =>
        Effect.sync(() => {
          captured.push({ ...request });
          return { status: 200, body: new Uint8Array() };
        }),
      requestStdin: (request, bytes) =>
        Effect.sync(() => {
          captured.push({ ...request });
          stdinWrites.push({ request: { ...request }, bytes: Uint8Array.from(bytes) });
          return { status: 101, body: new Uint8Array() };
        }),
    };
    const driver = makeDockerSandboxDriver({
      engine,
      checkoutCredential: credential,
      readinessProbe: () =>
        Effect.succeed({
          environmentId: "sandbox-env",
          serverVersion: intent.bootstrapManifest.serverVersion,
        }),
    });
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });

    return Effect.gen(function* () {
      yield* driver.identify({
        profile,
        intent,
        manifest,
        codexAuthJson: new Uint8Array([123]),
        resource,
      });

      expect(credentialCalls).toBe(1);
      expect(stdinWrites).toHaveLength(1);
      expect(Buffer.from(stdinWrites[0]?.bytes ?? []).toString("utf8")).toBe(sentinel);
      expect(stdinWrites[0]?.request.path).toMatch(/^\/exec\/exec-\d+\/start$/);
      for (const request of captured) {
        expect(request.path).not.toContain(sentinel);
        expect(request.body ?? "").not.toContain(sentinel);
        expect(
          request.bodyBytes === undefined ? "" : Buffer.from(request.bodyBytes).toString("utf8"),
        ).not.toContain(sentinel);
      }
      const commands = [...execCommands.values()];
      expect(commands.some((command) => command.includes(" fetch --depth=1 origin"))).toBe(true);
      expect(commands.some((command) => command.includes("GIT_ASKPASS"))).toBe(true);
      expect(commands.some((command) => command.includes("AttachStdin"))).toBe(false);
      expect(
        commands.some((command) =>
          command.includes(`https://github.com/${intent.source.repository}.git`),
        ),
      ).toBe(true);
      expect(commands.every((command) => !command.includes(sentinel))).toBe(true);
      expect(
        commands.filter((command) => command.includes("rm -f '/run/kata-credentials/github-token'"))
          .length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it.effect("skips credential acquisition when the ready marker and exact HEAD match", () => {
    const labels = dockerOwnershipLabels(intent);
    let credentialCalls = 0;
    let execCreates = 0;
    const driver = makeDockerSandboxDriver({
      checkoutCredential: {
        withToken: (use) => {
          credentialCalls += 1;
          return use(Buffer.from("unused-token"));
        },
      },
      readinessProbe: () =>
        Effect.succeed({
          environmentId: "sandbox-env",
          serverVersion: intent.bootstrapManifest.serverVersion,
        }),
      engine: {
        request: (request) =>
          Effect.sync(() => {
            if (request.path.includes("/archive?path=")) return response(200);
            if (request.path === "/containers/container-1/json") {
              return response(200, JSON.stringify(inspect(labels, true)));
            }
            if (request.path === "/containers/container-1/exec") {
              execCreates += 1;
              return response(201, '{"Id":"exec-ready"}');
            }
            if (request.path === "/exec/exec-ready/json") return response(200, '{"ExitCode":0}');
            return response(404);
          }),
        requestBuffer: () => Effect.succeed({ status: 200, body: new Uint8Array() }),
        requestStdin: () => Effect.succeed({ status: 101, body: new Uint8Array() }),
      },
    });
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });

    return Effect.gen(function* () {
      yield* driver.identify({
        profile,
        intent,
        manifest,
        codexAuthJson: new Uint8Array([123]),
        resource,
      });
      expect(execCreates).toBe(2);
      expect(credentialCalls).toBe(0);
    });
  });

  it.effect("cleans transient credentials when authenticated checkout fails", () => {
    const labels = dockerOwnershipLabels(intent);
    const sentinel = "checkout-failure-sentinel";
    const commands = new Map<string, string>();
    let nextExec = 0;
    let inspectCalls = 0;
    const driver = makeDockerSandboxDriver({
      checkoutCredential: {
        withToken: (use) => use(Buffer.from(sentinel)),
      },
      engine: {
        request: (request) =>
          Effect.sync(() => {
            if (request.path.includes("/archive?path=")) return response(200);
            if (request.path === "/containers/container-1/json") {
              inspectCalls += 1;
              return response(200, JSON.stringify(inspect(labels, inspectCalls > 1)));
            }
            if (request.path === "/containers/container-1/start") return response(204);
            if (request.path === "/containers/container-1/exec") {
              const id = `exec-${++nextExec}`;
              const body = JSON.parse(request.body ?? "{}") as { Cmd?: string[] };
              commands.set(id, body.Cmd?.[2] ?? "");
              return response(201, JSON.stringify({ Id: id }));
            }
            if (request.path.startsWith("/exec/") && request.path.endsWith("/json")) {
              const id = request.path.split("/")[2] ?? "";
              const command = commands.get(id) ?? "";
              const exitCode = command.includes(" fetch --depth=1 origin")
                ? 43
                : command.includes("rev-parse HEAD") && !command.includes("rm -f ")
                  ? 1
                  : 0;
              return response(200, JSON.stringify({ ExitCode: exitCode }));
            }
            return response(404);
          }),
        requestBuffer: () => Effect.succeed({ status: 200, body: new Uint8Array() }),
        requestStdin: () => Effect.succeed({ status: 101, body: new Uint8Array() }),
      },
    });
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });

    return Effect.gen(function* () {
      const error = yield* driver
        .identify({
          profile,
          intent,
          manifest,
          codexAuthJson: new Uint8Array([123]),
          resource,
        })
        .pipe(Effect.flip);

      expect(error.message).toBe("Authenticated Git fetch failed.");
      expect(error.message).not.toContain(sentinel);
      expect(
        [...commands.values()].filter((command) =>
          command.includes("rm -f '/run/kata-credentials/github-token'"),
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it.effect("cleans credentials when Docker stdin streaming fails", () => {
    const labels = dockerOwnershipLabels(intent);
    const sentinel = "stdin-failure-sentinel";
    const commands = new Map<string, string>();
    const stdinWrites: Uint8Array[] = [];
    let nextExec = 0;
    let inspectCalls = 0;
    const driver = makeDockerSandboxDriver({
      checkoutCredential: {
        withToken: (use) => use(Buffer.from(sentinel)),
      },
      engine: {
        request: (request) =>
          Effect.sync(() => {
            if (request.path.includes("/archive?path=")) return response(200);
            if (request.path === "/containers/container-1/json") {
              inspectCalls += 1;
              return response(200, JSON.stringify(inspect(labels, inspectCalls > 1)));
            }
            if (request.path === "/containers/container-1/start") return response(204);
            if (request.path === "/containers/container-1/exec") {
              const id = `exec-${++nextExec}`;
              const body = JSON.parse(request.body ?? "{}") as { Cmd?: string[] };
              commands.set(id, body.Cmd?.[2] ?? "");
              return response(201, JSON.stringify({ Id: id }));
            }
            if (request.path.startsWith("/exec/") && request.path.endsWith("/json")) {
              const id = request.path.split("/")[2] ?? "";
              const command = commands.get(id) ?? "";
              return response(
                200,
                JSON.stringify({
                  ExitCode:
                    command.includes("rev-parse HEAD") && !command.includes("rm -f ") ? 1 : 0,
                }),
              );
            }
            return response(404);
          }),
        requestBuffer: () => Effect.succeed({ status: 200, body: new Uint8Array() }),
        requestStdin: (_request, bytes) => {
          stdinWrites.push(Uint8Array.from(bytes));
          return Effect.fail(new DockerEngineError({ message: "raw transport diagnostics" }));
        },
      },
    });
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });

    return Effect.gen(function* () {
      const error = yield* driver
        .identify({
          profile,
          intent,
          manifest,
          codexAuthJson: new Uint8Array([123]),
          resource,
        })
        .pipe(Effect.flip);

      expect(error.message).toBe("Authenticated Git checkout failed.");
      expect(error.message).not.toContain("raw transport diagnostics");
      expect(Buffer.from(stdinWrites[0] ?? []).toString("utf8")).toBe(sentinel);
      expect([...commands.values()].every((command) => !command.includes(sentinel))).toBe(true);
      expect(
        [...commands.values()].filter((command) =>
          command.includes("rm -f '/run/kata-credentials/github-token'"),
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it.effect("rejects a stored container identity mismatch before seeding credentials", () => {
    const labels = dockerOwnershipLabels(intent);
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });
    const requests: DockerRequest[] = [];
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        requests.push(request);
        return request.path.endsWith("/json")
          ? response(200, JSON.stringify({ ...inspect(labels), Name: "/a-different-container" }))
          : response(404);
      }),
    });

    return Effect.gen(function* () {
      const result = yield* Effect.result(
        driver.identify({
          profile,
          intent,
          manifest,
          codexAuthJson: new Uint8Array([123]),
          resource,
        }),
      );
      expect(result._tag).toBe("Failure");
      expect(requests.some((request) => request.path.includes("/archive?path="))).toBe(false);
    });
  });

  it.effect("returns the configured reachable host in identified endpoint facts", () => {
    const labels = dockerOwnershipLabels(intent);
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });
    let inspectCalls = 0;
    const execRequests: DockerRequest[] = [];
    let execCount = 0;
    const driver = makeDockerSandboxDriver({
      endpointHost: "192.168.1.42",
      checkoutCredential: {
        withToken: (use) => use(Buffer.from("private-token")),
      },
      readinessProbe: (endpoint, readinessManifest) => {
        expect(endpoint).toBe("http://192.168.1.42:41001");
        return Effect.succeed({
          environmentId: "sandbox-env",
          serverVersion: readinessManifest.serverVersion,
        });
      },
      engine: {
        request: (request) =>
          Effect.sync(() => {
            if (request.path.includes("/archive?path=")) return response(200);
            if (request.path === "/containers/container-1/json") {
              inspectCalls += 1;
              return response(200, JSON.stringify(inspect(labels, inspectCalls > 1)));
            }
            if (request.path === "/containers/container-1/start") return response(204);
            if (request.path === "/containers/container-1/exec") {
              execRequests.push(request);
              execCount += 1;
              return response(201, JSON.stringify({ Id: `exec-${execCount}` }));
            }
            if (request.path.startsWith("/exec/") && request.path.endsWith("/json")) {
              const id = request.path.split("/")[2] ?? "";
              const created = execRequests[Number(id.replace("exec-", "")) - 1];
              return response(
                200,
                JSON.stringify({
                  ExitCode:
                    created?.body?.includes("rev-parse HEAD") &&
                    !created.body.includes(" fetch --depth=1 ")
                      ? 1
                      : 0,
                }),
              );
            }
            return response(404);
          }),
        requestBuffer: () => Effect.succeed({ status: 200, body: new Uint8Array() }),
        requestStdin: () => Effect.succeed({ status: 101, body: new Uint8Array() }),
      },
    });

    return Effect.gen(function* () {
      const identified = yield* driver.identify({
        profile,
        intent,
        manifest,
        codexAuthJson: new Uint8Array([123]),
        resource,
      });

      expect(identified.endpoint).toBe("http://192.168.1.42:41001");
      expect(
        execRequests.some((request) =>
          request.body?.includes("touch '/tmp/kata-sandbox-checkout-ready'"),
        ),
      ).toBe(true);
    });
  });

  it.effect("refuses a display-label-only match as foreign ownership", () => {
    const labels = { "com.katacode.sandbox.display-label": intent.label };
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((_request) => response(200, JSON.stringify(inspect(labels)))),
    });

    return Effect.gen(function* () {
      const result = yield* Effect.result(
        driver.allocate({
          profile,
          intent,
          manifest,
          codexAuthJson: new Uint8Array([123]),
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.reason).toBe("allocation-failed");
      }
    });
  });

  it("creates an archive containing only auth.json with mode 0600 owned by the runtime user", () => {
    const archive = Buffer.from(buildAuthArchive(Buffer.from('{"token":"value"}')));
    expect(archive.subarray(0, 9).toString("utf8")).toBe("auth.json");
    expect(archive.subarray(100, 107).toString("ascii")).toBe("0000600");
    expect(archive.subarray(108, 115).toString("ascii")).toBe(
      SANDBOX_RUNTIME_UID.toString(8).padStart(7, "0"),
    );
    expect(archive.subarray(116, 123).toString("ascii")).toBe(
      SANDBOX_RUNTIME_GID.toString(8).padStart(7, "0"),
    );
    expect(archive.includes(Buffer.from("config.toml"))).toBe(false);
    expect(archive.includes(Buffer.from("sessions"))).toBe(false);
  });

  it("creates provider settings containing only the selected Codex instance", () => {
    const modelSelection: ModelSelection = {
      instanceId: ProviderInstanceId.make("codex-selected"),
      model: "gpt-5.6-luna",
    };
    const archive = Buffer.from(buildProviderSettingsArchive(modelSelection));
    expect(archive.toString("utf8")).toContain('"codex-selected"');
    expect(archive.toString("utf8")).toContain('"gpt-5.6-luna"');
    expect(archive.toString("utf8")).not.toContain("auth.json");
  });

  it.effect("returns Stopped and resumes the exact owned container", () => {
    const labels = dockerOwnershipLabels(intent);
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      hostPort: 41001,
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });
    let running = false;
    let probeCalls = 0;
    const paths: string[] = [];
    const driver = makeDockerSandboxDriver({
      readinessProbe: () => {
        probeCalls++;
        return Effect.succeed({
          environmentId: "sandbox-env",
          serverVersion: intent.bootstrapManifest.serverVersion,
        });
      },
      engine: fakeEngine((request) => {
        paths.push(request.path);
        if (request.path.endsWith("/json")) {
          return response(200, JSON.stringify(inspect(labels, running)));
        }
        if (request.path.endsWith("/stop")) {
          running = false;
          return response(204);
        }
        if (request.path.endsWith("/start")) {
          running = true;
          return response(204);
        }
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      const power = driver.power;
      if (power === undefined) throw new Error("Expected Docker power capability.");
      expect(yield* power.inspect({ profile, resource, intent })).toEqual({
        state: "Stopped",
        observedAt: expect.any(String),
      });
      const started = yield* power.start({
        profile,
        resource,
        intent,
        expectedEnvironmentId: "sandbox-env",
      });
      expect(started).toMatchObject({
        environmentId: "sandbox-env",
        endpoint: "http://127.0.0.1:41001",
        resource: { containerId: "container-1", hostPort: 41001 },
        connectorOrigin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
      });
      expect(probeCalls).toBe(1);
      expect(
        yield* power.inspect({
          profile,
          resource,
          intent,
          expectedEnvironmentId: "sandbox-env",
        }),
      ).toMatchObject({ state: "Running" });
      expect(probeCalls).toBe(1);
      expect(paths).toEqual([
        "/containers/container-1/json",
        "/containers/container-1/json",
        "/containers/container-1/start",
        "/containers/container-1/json",
        "/containers/container-1/json",
      ]);
      expect(yield* power.stop({ profile, resource, intent })).toMatchObject({
        state: "Stopped",
      });
    });
  });

  it.effect("reports Unknown for an identity collision", () => {
    const labels = dockerOwnershipLabels(intent);
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      hostPort: 41001,
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) =>
        request.path.endsWith("/json")
          ? response(200, JSON.stringify({ ...inspect(labels), Id: "a-different-container" }))
          : response(404),
      ),
    });

    return Effect.gen(function* () {
      const observation = yield* driver.observe({ profile, resource });
      expect(observation.state).toBe("Unknown");
    });
  });

  it.effect("records Gone for an authoritative missing container", () => {
    const resource = decodeResource({
      containerId: "container-1",
      containerName: dockerContainerName(intent.deploymentId),
      hostPort: 41001,
      containerPort: 3773,
      ownership: {
        controlEnvironmentId: intent.controlEnvironmentId,
        deploymentId: intent.deploymentId,
        profileId: intent.profileId,
        profileRevision: intent.profileRevision,
        schemaVersion: "v1",
      },
    });
    const driver = makeDockerSandboxDriver({
      now: () => "2026-08-30T00:01:00.000Z",
      engine: fakeEngine(() => response(404)),
    });

    return Effect.gen(function* () {
      expect(yield* driver.observe({ profile, resource })).toEqual({
        state: "Gone",
        observedAt: "2026-08-30T00:01:00.000Z",
      });
    });
  });

  it("uses the complete label set and never the display label for ownership", () => {
    const labels = dockerOwnershipLabels(intent);
    expect(Object.keys(labels)).toEqual(
      expect.arrayContaining([
        SandboxProviderLabels.controlEnvironmentId,
        SandboxProviderLabels.deploymentId,
        SandboxProviderLabels.profileId,
        SandboxProviderLabels.schemaVersion,
      ]),
    );
    expect(labels["com.katacode.sandbox.display-label"]).toBe(intent.label);
    expect(DOCKER_KIND).toBe("docker");
  });
});
