import { EnvironmentId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  DockerResourceHandle,
  SandboxDeploymentIntent,
  SandboxEndpoint,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  allocateDeployment,
  decide,
  deleteDeployment,
  identifyDeployment,
  project,
  requestDeployment,
} from "./deployment.ts";

const decodeIntent = Schema.decodeUnknownSync(SandboxDeploymentIntent);
const decodeResource = Schema.decodeUnknownSync(DockerResourceHandle);

const intent = decodeIntent({
  deploymentId: "deployment-1",
  controlEnvironmentId: "control-1",
  profileId: "profile-1",
  profileRevision: 1,
  profileSnapshot: {
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
  },
  providerInstanceId: "codex-1",
  label: "Issue 159",
  source: {
    repository: "gannonh/kata-code",
    ref: "main",
    resolvedCommitSha: "0123456789abcdef0123456789abcdef01234567",
  },
  bootstrapManifest: {
    version: 1,
    imageDigest:
      "ghcr.io/kata-sh/kata@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
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

const resource = decodeResource({
  containerId: "container-1",
  containerName: "kata-sandbox-deployment-1",
  hostPort: 41001,
  containerPort: 3773,
  ownership: {
    controlEnvironmentId: "control-1",
    deploymentId: "deployment-1",
    profileId: "profile-1",
    profileRevision: 1,
    schemaVersion: "v1",
  },
});

describe("sandbox deployment state", () => {
  it("projects the only legal allocation and identification path", () => {
    const requested = requestDeployment(intent);
    const allocated = allocateDeployment(requested, resource, "2026-08-30T00:01:00.000Z");
    if (allocated.state !== "Allocated") throw new Error("Expected allocated deployment.");
    const identified = identifyDeployment(
      allocated,
      EnvironmentId.make("sandbox-environment-1"),
      SandboxEndpoint.make("http://127.0.0.1:41001"),
      resource,
      "2026-08-30T00:01:30.000Z",
    );

    expect(requested).toMatchObject({ state: "Requested", revision: 1 });
    expect(allocated).toMatchObject({ state: "Allocated", revision: 2, resource });
    expect(identified).toMatchObject({
      state: "Identified",
      revision: 3,
      environmentId: "sandbox-environment-1",
      workspaceRoot: "/workspace",
    });
  });

  it("replays an identical allocation without a second event", () => {
    const requested = requestDeployment(intent);
    const allocated = allocateDeployment(requested, resource, "2026-08-30T00:01:00.000Z");

    expect(
      decide(allocated, {
        kind: "allocate",
        resource,
        expectedRevision: allocated.revision,
        at: "2026-08-30T00:01:00.000Z",
      }),
    ).toEqual([]);
  });

  it("rejects stale revisions before external work can be repeated", () => {
    const requested = requestDeployment(intent);

    expect(() =>
      decide(requested, {
        kind: "allocate",
        resource,
        expectedRevision: 0,
        at: "2026-08-30T00:01:00.000Z",
      }),
    ).toThrow(/Expected deployment revision 0, found 1/);
  });

  it("permits compensation from allocated and tombstones only after deletion is confirmed", () => {
    const requested = requestDeployment(intent);
    const allocated = allocateDeployment(requested, resource, "2026-08-30T00:01:00.000Z");
    const deleted = deleteDeployment(allocated, "2026-08-30T00:02:00.000Z");

    expect(deleted).toEqual({
      state: "Deleted",
      revision: 3,
      deploymentId: "deployment-1",
      profileId: "profile-1",
      deletedAt: "2026-08-30T00:02:00.000Z",
    });
  });

  it("preserves the event timestamp during projection", () => {
    const requested = requestDeployment(intent);
    const allocated = project(requested, { kind: "Allocated", resource }, 2);
    const identifiedEvent = {
      kind: "Identified" as const,
      environmentId: EnvironmentId.make("sandbox-environment-1"),
      endpoint: SandboxEndpoint.make("http://127.0.0.1:41001"),
      resource,
      identifiedAt: "2026-08-30T00:03:00.000Z",
    };

    expect(project(allocated, identifiedEvent, 3)).toMatchObject({
      state: "Identified",
      identifiedAt: "2026-08-30T00:03:00.000Z",
    });
  });
});
