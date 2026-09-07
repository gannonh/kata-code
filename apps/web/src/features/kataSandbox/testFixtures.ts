import * as Schema from "effect/Schema";
import { SandboxListResponse } from "@kata-sh/code-kata-sandbox-contracts/http";
const decodeSandboxList = Schema.decodeUnknownSync(SandboxListResponse);
export function discoveredList(status: "Running" | "Succeeded", count = 1) {
  const at = "2026-09-07T00:00:00.000Z";
  const imageDigest = "sha256:" + "a".repeat(64);
  return decodeSandboxList({
    profiles: [],
    providers: [],
    deployments: Array.from({ length: count }, (_, index) => {
      const id = `sandbox-${index}`;
      const profile = {
        profileId: "profile",
        name: "Docker",
        driverKind: "docker",
        socketPath: "/var/run/docker.sock",
        imageDigest,
        enabled: true,
        revision: 1,
        createdAt: at,
        updatedAt: at,
      };
      const intent = {
        deploymentId: id,
        controlEnvironmentId: "control",
        profileId: "profile",
        providerInstanceId: "codex",
        label: id,
        source: { repository: "owner/repo", ref: "main", resolvedCommitSha: "b".repeat(40) },
        workspaceRoot: "/workspace",
        kataHome: "/var/lib/katacode",
        requestedAt: at,
      };
      const deployment =
        status === "Running"
          ? {
              state: "Preparing",
              revision: 1,
              intent: {
                ...intent,
                image: { kind: "custom", digest: imageDigest },
                socketPath: profile.socketPath,
              },
            }
          : {
              state: "Identified",
              revision: 4,
              intent: {
                ...intent,
                profileRevision: 1,
                profileSnapshot: profile,
                bootstrapManifest: {
                  version: 1,
                  imageDigest,
                  kataVersion: "0.0.42",
                  serverVersion: "0.0.42",
                  serverArtifactSha256: "c".repeat(64),
                  codexVersion: "1",
                  codexArtifactSha256: "d".repeat(64),
                },
              },
              resource: {
                containerId: "container",
                containerName: id,
                containerPort: 3773,
                ownership: {
                  controlEnvironmentId: "control",
                  deploymentId: id,
                  profileId: "profile",
                  profileRevision: 1,
                  schemaVersion: "v1",
                },
              },
              environmentId: `environment-${index}`,
              endpoint: "http://localhost:3774",
              workspaceRoot: "/workspace",
              kataHome: "/var/lib/katacode",
              identifiedAt: at,
            };
      return {
        deployment,
        createReceipt: {
          operationId: `operation-${index}`,
          requestId: `request-${index}`,
          command: "create",
          payloadHash: "hash",
          status,
          deploymentId: id,
          acceptedAt: at,
          updatedAt: at,
        },
      };
    }),
  });
}
