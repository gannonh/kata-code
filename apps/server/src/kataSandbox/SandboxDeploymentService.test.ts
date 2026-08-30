import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EnvironmentId, ProviderInstanceId } from "@kata-sh/code-contracts";
import {
  CommitSha,
  DockerResourceHandle,
  GitHubRef,
  GitHubRepository,
  OciImageDigest,
  SandboxContainerId,
  SandboxContainerName,
  SandboxProfile,
  SandboxProviderProfileId,
  SandboxRequestId,
  type ProviderObservation,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import { SandboxDriverError, type SandboxProviderDriver } from "@kata-sh/code-kata-sandbox/driver";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { SandboxDeploymentRepository } from "./SandboxDeploymentRepository.ts";
import { layer as sandboxDeploymentRepositoryLayer } from "./SandboxDeploymentRepository.ts";
import {
  makeSandboxDeploymentService,
  SandboxDeploymentServiceError,
} from "./SandboxDeploymentService.ts";
import type { SandboxCredentialSeedShape } from "./SandboxCredentialSeed.ts";
import type { SandboxSourceResolverShape } from "./SandboxSourceResolver.ts";

const imageDigest = OciImageDigest.make("ghcr.io/kata-sh/sandbox@sha256:" + "a".repeat(64));
const profileId = SandboxProviderProfileId.make("profile-1");
const controlEnvironmentId = EnvironmentId.make("control-env");
const providerInstanceId = ProviderInstanceId.make("codex");

const profile: SandboxProfile = {
  profileId,
  name: "Local Docker",
  driverKind: "docker",
  socketPath: "/var/run/docker.sock",
  imageDigest,
  enabled: true,
  revision: 1,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const source = {
  repository: GitHubRepository.make("gannonh/kata-code"),
  ref: GitHubRef.make("main"),
  resolvedCommitSha: CommitSha.make("b".repeat(40)),
};

const testBootstrapManifest = (sandboxProfile: SandboxProfile) => ({
  version: 1 as const,
  imageDigest: sandboxProfile.imageDigest,
  kataVersion: "0.0.42",
  serverVersion: "0.0.42",
  serverArtifactSha256: "c".repeat(64),
  codexVersion: "0.1.0",
  codexArtifactSha256: "d".repeat(64),
});

function makeDriver(
  options: {
    readonly identify?: SandboxProviderDriver["identify"];
    readonly observe?: SandboxProviderDriver["observe"];
    readonly delete?: SandboxProviderDriver["delete"];
  } = {},
): SandboxProviderDriver {
  return {
    kind: "docker",
    validateProfile: () => Effect.succeed({ daemonVersion: "1.0", imageDigest }),
    allocate: (input) =>
      Effect.succeed({
        containerId: SandboxContainerId.make("container-1"),
        containerName: SandboxContainerName.make("kata-sandbox-" + input.intent.deploymentId),
        hostPort: 3774,
        containerPort: 3773,
        ownership: {
          controlEnvironmentId: input.intent.controlEnvironmentId,
          deploymentId: input.intent.deploymentId,
          profileId: input.intent.profileId,
          profileRevision: input.intent.profileRevision,
          schemaVersion: "v1" as const,
        },
      } satisfies DockerResourceHandle),
    identify:
      options.identify ??
      ((input) =>
        Effect.succeed({
          environmentId: "sandbox-env",
          endpoint: "http://127.0.0.1:3774",
          workspaceRoot: "/workspace",
          resource: {
            ...input.resource,
            hostPort: 3774,
          },
        })),
    observe:
      options.observe ??
      (() =>
        Effect.succeed<ProviderObservation>({
          state: "Running",
          observedAt: "2026-08-30T00:00:04.000Z",
        })),
    delete:
      options.delete ??
      (() =>
        Effect.succeed<ProviderObservation>({
          state: "Gone",
          observedAt: "2026-08-30T00:00:05.000Z",
        })),
  };
}

const makeSecretStore = (): ServerSecretStore.ServerSecretStore["Service"] => ({
  get: () => Effect.succeed(Option.none()),
  set: () => Effect.void,
  create: () => Effect.void,
  getOrCreateRandom: () => Effect.succeed(new Uint8Array(32)),
  remove: () => Effect.void,
});

const runWithService = <A>(
  test: (
    service: ReturnType<typeof makeSandboxDeploymentService>,
  ) => Effect.Effect<A, SandboxDeploymentServiceError>,
  options?: Parameters<typeof makeSandboxDeploymentService>[1],
) =>
  Effect.gen(function* () {
    const dependencies = {
      crypto: yield* Crypto.Crypto,
      repository: yield* SandboxDeploymentRepository,
      sourceResolver: {
        resolve: () => Effect.succeed(source),
      } satisfies SandboxSourceResolverShape,
      credentialSeed: {
        resolve: (selectedProviderInstanceId) =>
          Effect.succeed({
            authJson: new TextEncoder().encode("selected-auth-json"),
            modelSelection: {
              instanceId: selectedProviderInstanceId,
              model: "gpt-5.6-luna",
            },
          }),
      } satisfies SandboxCredentialSeedShape,
      secretStore: makeSecretStore(),
      environment: { getEnvironmentId: Effect.succeed(controlEnvironmentId) },
    };
    const service = makeSandboxDeploymentService(dependencies, {
      bootstrapManifestFor: testBootstrapManifest,
      ...options,
      schedule: (effect) => effect,
    });
    return yield* test(service);
  }).pipe(
    Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
  );

const createInput = (requestId: string, label = "Issue 159") => ({
  requestId: SandboxRequestId.make(requestId),
  profileId,
  label,
  source: { repository: source.repository, ref: source.ref },
  providerInstanceId,
});

it.layer(NodeServices.layer)("SandboxDeploymentService", (it) => {
  it.effect("captures an exact source, runs the durable lifecycle, and deduplicates retries", () =>
    Effect.gen(function* () {
      const result = yield* runWithService(
        (service) =>
          Effect.gen(function* () {
            yield* service.upsertProfile("desktop-bootstrap", {
              requestId: SandboxRequestId.make("profile-request"),
              name: profile.name,
              driverKind: "docker",
              socketPath: profile.socketPath,
              imageDigest: profile.imageDigest,
              enabled: true,
              profileId,
            });
            const input = createInput("request-1");
            const first = yield* service.create("desktop-bootstrap", input);
            const second = yield* service.create("desktop-bootstrap", input);
            const deployment = yield* service.list();
            return { first, second, deployment };
          }),
        {
          driverFor: () => makeDriver(),
          now: () => "2026-08-30T00:00:01.000Z",
        },
      );

      expect(result.first).toEqual(result.second);
      expect(result.deployment.deployments).toHaveLength(1);
      const identified = result.deployment.deployments[0]?.deployment;
      expect(identified?.state).toBe("Identified");
      if (identified?.state === "Identified") {
        expect(identified.endpoint).toBe("http://127.0.0.1:3774");
      }
    }),
  );

  it.effect("rejects a reused request id with a different payload", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-request"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            imageDigest: profile.imageDigest,
            enabled: true,
            profileId,
          });
          yield* service.create("desktop-bootstrap", createInput("request-1"));
          const result = yield* Effect.result(
            service.create("desktop-bootstrap", createInput("request-1", "Different label")),
          );
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure") {
            expect(result.failure).toBeInstanceOf(SandboxDeploymentServiceError);
            expect(result.failure.kind).toBe("conflict");
          }
        }),
      { driverFor: () => makeDriver() },
    ),
  );

  it.effect("retains an allocated container when compensation cannot prove deletion", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-request"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            imageDigest: profile.imageDigest,
            enabled: true,
            profileId,
          });
          const accepted = yield* service.create("desktop-bootstrap", createInput("request-2"));
          const failed = yield* service.getOperation(accepted.operationId);
          expect(failed.status).toBe("Failed");
          const deployments = yield* service.list();
          expect(deployments.deployments[0]?.deployment.state).toBe("Allocated");
          expect(deployments.deployments[0]?.observation?.state).toBe("Unknown");
        }),
      {
        driverFor: () =>
          makeDriver({
            identify: () =>
              Effect.fail(
                new SandboxDriverError({
                  reason: "setup-failed",
                  message: "target did not become ready",
                }),
              ),
            delete: () =>
              Effect.succeed<ProviderObservation>({
                state: "Unknown",
                observedAt: "2026-08-30T00:00:05.000Z",
                diagnostic: "Docker could not confirm deletion.",
              }),
            observe: () =>
              Effect.succeed<ProviderObservation>({
                state: "Unknown",
                observedAt: "2026-08-30T00:00:06.000Z",
                diagnostic: "Docker could not confirm deletion.",
              }),
          }),
      },
    ),
  );

  it.effect("remints a one-use target handoff without persisting its credential", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-request"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            imageDigest: profile.imageDigest,
            enabled: true,
            profileId,
          });
          const accepted = yield* service.create("desktop-bootstrap", createInput("request-3"));
          const created = yield* service.getOperation(accepted.operationId);
          const deploymentId = created.deploymentId;
          if (deploymentId === undefined) throw new Error("Expected a deployment id.");
          const first = yield* service.mintHandoff(deploymentId);
          const second = yield* service.mintHandoff(deploymentId);
          expect(first.pairingUrl).toContain("first-token");
          expect(second.pairingUrl).toContain("second-token");
          expect(first.expiresAt).toBe("2026-08-30T00:05:00.000Z");
        }),
      {
        driverFor: () => makeDriver(),
        issuePairingCredential: (() => {
          let count = 0;
          return () => {
            count += 1;
            return Effect.succeed({
              credential: count === 1 ? "first-token" : "second-token",
              expiresAt: "2026-08-30T00:05:00.000Z",
            });
          };
        })(),
      },
    ),
  );

  it.effect("requires a current running observation before minting a handoff", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-request"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            imageDigest: profile.imageDigest,
            enabled: true,
            profileId,
          });
          const accepted = yield* service.create("desktop-bootstrap", createInput("request-4"));
          const created = yield* service.getOperation(accepted.operationId);
          if (created.deploymentId === undefined) throw new Error("Expected a deployment id.");

          const result = yield* Effect.result(service.mintHandoff(created.deploymentId));
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure") expect(result.failure.kind).toBe("conflict");
        }),
      {
        driverFor: () =>
          makeDriver({
            observe: () =>
              Effect.succeed<ProviderObservation>({
                state: "Unknown",
                observedAt: "2026-08-30T00:00:06.000Z",
                diagnostic: "Docker state is unknown.",
              }),
          }),
        issuePairingCredential: () => Effect.die("handoff issuance should not run"),
      },
    ),
  );

  it.effect("requires a profile to be disabled before deleting it", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-disabled-request"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            imageDigest: profile.imageDigest,
            enabled: false,
            profileId,
          });
          const accepted = yield* service.deleteProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-delete-request"),
            profileId,
            expectedRevision: 1,
          });
          const receipt = yield* service.getOperation(accepted.operationId);
          expect(receipt.status).toBe("Succeeded");
          expect((yield* service.list()).profiles).toHaveLength(0);
        }),
      { driverFor: () => makeDriver() },
    ),
  );
});
