import { ProviderInstanceId, type ModelSelection } from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DockerResourceHandle,
  SandboxDeploymentIntent,
  SandboxProfile,
  SandboxProviderLabels,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import type { DockerEngine, DockerRequest, DockerResponse } from "./engine.ts";
import {
  DOCKER_KIND,
  buildAuthArchive,
  buildProviderSettingsArchive,
  dockerContainerName,
  dockerOwnershipLabels,
  makeDockerSandboxDriver,
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
  };
}

describe("Docker sandbox driver", () => {
  it.effect("validates the daemon and exact local image without pulling", () => {
    const requests: DockerRequest[] = [];
    const driver = makeDockerSandboxDriver({
      engine: fakeEngine((request) => {
        requests.push(request);
        if (request.path === "/_ping") return response(200, "OK");
        if (request.path.startsWith("/images/")) return response(200, "{}");
        if (request.path === "/version") return response(200, '{"ApiVersion":"1.45"}');
        return response(404);
      }),
    });

    return Effect.gen(function* () {
      const result = yield* driver.validateProfile(profile);
      expect(result.imageDigest).toBe(profile.imageDigest);
      expect(requests.map((request) => request.path)).toEqual([
        "/_ping",
        "/images/" + encodeURIComponent(profile.imageDigest) + "/json",
        "/version",
      ]);
      expect(requests.some((request) => request.path.startsWith("/images/create"))).toBe(false);
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

  it("creates an archive containing only auth.json with mode 0600", () => {
    const archive = Buffer.from(buildAuthArchive(Buffer.from('{"token":"value"}')));
    expect(archive.subarray(0, 9).toString("utf8")).toBe("auth.json");
    expect(archive.subarray(100, 107).toString("ascii")).toBe("0000600");
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
