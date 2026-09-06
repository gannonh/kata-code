import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

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
import {
  makeOciRegistry,
  SandboxDriverError,
  type SandboxProviderDriver,
  type SandboxProviderPowerCapability,
} from "@kata-sh/code-kata-sandbox";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  SandboxDeploymentRepository,
  type SandboxDeploymentRepositoryShape,
} from "./SandboxDeploymentRepository.ts";
import { layer as sandboxDeploymentRepositoryLayer } from "./SandboxDeploymentRepository.ts";
import {
  decodeTargetPairing,
  makeSandboxDeploymentService,
  probeSandboxHostAvailability,
  SandboxDeploymentServiceError,
  type SandboxDeploymentServiceDependencies,
} from "./SandboxDeploymentService.ts";
import type { SandboxCredentialSeedShape } from "./SandboxCredentialSeed.ts";
import type { SandboxGitHubAccessShape } from "./SandboxGitHubAccess.ts";

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

const testBootstrapFacts = {
  kataVersion: "0.0.42",
  serverVersion: "0.0.42",
  serverArtifactSha256: "c".repeat(64),
  codexVersion: "0.1.0",
  codexArtifactSha256: "d".repeat(64),
};

const testBootstrapManifest = (sandboxProfile: SandboxProfile) => ({
  version: 1 as const,
  imageDigest: sandboxProfile.imageDigest,
  ...testBootstrapFacts,
});

function makeDriver(
  options: {
    readonly validateProfile?: SandboxProviderDriver["validateProfile"];
    readonly identify?: SandboxProviderDriver["identify"];
    readonly observe?: SandboxProviderDriver["observe"];
    readonly delete?: SandboxProviderDriver["delete"];
    readonly power?: SandboxProviderPowerCapability;
  } = {},
): SandboxProviderDriver {
  return {
    kind: "docker",
    descriptor: {
      driverKind: "docker",
      category: "local-container",
      displayName: "Docker",
      profileForm: "docker",
    },
    validateProfile:
      options.validateProfile ??
      (() => Effect.succeed({ daemonVersion: "1.0", imageDigest, ...testBootstrapFacts })),
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
    ...(options.power === undefined ? {} : { power: options.power }),
  };
}

const makeSecretStore = (): ServerSecretStore.ServerSecretStore["Service"] => ({
  get: () => Effect.succeed(Option.none()),
  set: () => Effect.void,
  create: () => Effect.void,
  getOrCreateRandom: () => Effect.succeed(new Uint8Array(32)),
  remove: () => Effect.void,
});

function makeRelayFixture(
  options: {
    readonly malformedLink?: boolean;
    readonly configStatus?: number;
  } = {},
) {
  const requests: Array<{ readonly url: string; readonly body: string }> = [];
  const httpClient = HttpClient.make((request) =>
    Effect.sync(() => {
      const body =
        request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
      requests.push({ url: request.url, body });
      const responseBody = request.url.endsWith("/environment-link-challenges")
        ? {
            challenge: "challenge-1",
            expiresAt: "2026-08-30T00:05:00.000Z",
          }
        : request.url.endsWith("/oauth/token")
          ? {
              access_token: "sandbox-access-token",
              issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
              token_type: "Bearer",
              expires_in: 300,
              scope: "relay:read relay:write",
            }
          : request.url.endsWith("/api/connect/link-proof")
            ? "signed-link-proof"
            : request.url.endsWith("/environment-links")
              ? options.malformedLink
                ? { malformed: true }
                : {
                    ok: true,
                    cloudUserId: "cloud-user-1",
                    environmentId: "sandbox-env",
                    endpoint: {
                      httpBaseUrl: "https://sandbox.example.test",
                      wsBaseUrl: "wss://sandbox.example.test",
                      providerKind: "cloudflare_tunnel",
                    },
                    endpointRuntime: null,
                    relayIssuer: "https://relay.example.test",
                    environmentCredential: "environment-credential",
                    cloudMintPublicKey: "public-key",
                  }
              : { ok: true };
      if (request.url.endsWith("/api/connect/relay-config") && options.configStatus !== undefined) {
        return HttpClientResponse.fromWeb(
          request,
          new Response(null, {
            status: options.configStatus,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return HttpClientResponse.fromWeb(request, Response.json(responseBody));
    }),
  );
  const token: CliTokenManager.PersistedToken = {
    accessToken: "control-access-token",
    refreshToken: "control-refresh-token",
    expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
  };
  const cloudCliTokenManager: CliTokenManager.CloudCliTokenManager["Service"] = {
    get: Effect.die("unused"),
    getExisting: Effect.succeed(Option.some(token)),
    hasCredential: Effect.succeed(true),
    store: () => Effect.die("unused"),
    clear: Effect.die("unused"),
  };
  return { requests, httpClient, cloudCliTokenManager };
}

const runWithService = <A>(
  test: (
    service: ReturnType<typeof makeSandboxDeploymentService>,
  ) => Effect.Effect<A, SandboxDeploymentServiceError>,
  options?: Parameters<typeof makeSandboxDeploymentService>[1],
  overrides: Partial<
    Pick<
      SandboxDeploymentServiceDependencies,
      "cloudCliTokenManager" | "githubAccess" | "httpClient" | "repository"
    >
  > = {},
  repositoryTransform: (
    repository: SandboxDeploymentRepositoryShape,
  ) => SandboxDeploymentRepositoryShape = (repository) => repository,
) =>
  Effect.gen(function* () {
    const baseRepository = yield* SandboxDeploymentRepository;
    const dependencies = {
      crypto: yield* Crypto.Crypto,
      repository: repositoryTransform(baseRepository),
      githubAccess: {
        resolve: () => Effect.succeed(source),
        checkoutCredential: {
          withToken: (use) => use(new Uint8Array()),
        },
      } satisfies Pick<SandboxGitHubAccessShape, "resolve" | "checkoutCredential">,
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
      ...overrides,
    };
    const service = makeSandboxDeploymentService(dependencies, {
      bootstrapManifestFor: testBootstrapManifest,
      ...options,
      schedule: options?.schedule ?? ((effect) => effect),
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
  it.effect("decodes a bootstrap pairing JSON body whose expiresAt is an ISO string", () =>
    Effect.gen(function* () {
      const decoded = yield* decodeTargetPairing({
        id: "link-1",
        credential: "one-use-token",
        expiresAt: "2026-09-02T16:19:29.000Z",
      });
      expect(decoded.credential).toBe("one-use-token");
      expect(decoded.expiresAt).toBe("2026-09-02T16:19:29.000Z");
    }),
  );

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
              image: { kind: "custom", digest: profile.imageDigest },
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

  it.effect("recovers an allocated create with the persisted SHA without resolving again", () => {
    let resolveCalls = 0;
    let identifyCalls = 0;
    const resolvedShas: string[] = [];
    const driver = makeDriver({
      identify: (input) => {
        identifyCalls += 1;
        resolvedShas.push(input.intent.source.resolvedCommitSha);
        return identifyCalls === 1
          ? Effect.die("simulated crash after allocation")
          : Effect.succeed({
              environmentId: "sandbox-env",
              endpoint: "http://127.0.0.1:3774",
              workspaceRoot: "/workspace",
              resource: input.resource,
            });
      },
    });

    return runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-allocated-recovery"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            image: { kind: "custom", digest: profile.imageDigest },
            enabled: true,
            profileId,
          });
          const accepted = yield* service.create(
            "desktop-bootstrap",
            createInput("allocated-recovery-create"),
          );
          expect((yield* service.getOperation(accepted.operationId)).status).toBe("Running");
          expect((yield* service.list()).deployments[0]?.deployment.state).toBe("Allocated");

          yield* service.recover();

          expect((yield* service.getOperation(accepted.operationId)).status).toBe("Succeeded");
          expect((yield* service.list()).deployments[0]?.deployment.state).toBe("Identified");
          expect(resolveCalls).toBe(1);
          expect(identifyCalls).toBe(2);
          expect(resolvedShas).toEqual([source.resolvedCommitSha, source.resolvedCommitSha]);
        }),
      {
        driverFor: () => driver,
        schedule: (effect) => effect.pipe(Effect.catchCause(() => Effect.void)),
      },
      {
        githubAccess: {
          resolve: () => {
            resolveCalls += 1;
            return Effect.succeed(source);
          },
          checkoutCredential: {
            withToken: (use) => use(new Uint8Array()),
          },
        },
      },
    );
  });

  it.effect("resolves managed images and records ready progress", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          const accepted = yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("managed-profile-request"),
            name: "Managed Docker",
            driverKind: "docker",
            image: { kind: "managed", channel: "stable", version: "0.0.42" },
            enabled: true,
            profileId,
          });
          const receipt = yield* service.getOperation(accepted.operationId);
          const listed = yield* service.list();
          const saved = listed.profiles[0]?.profile;
          expect(receipt.progress).toEqual({ stage: "ready" });
          expect(saved?.imageDigest).toBe("vcr.vercel.com/team/image@sha256:" + "e".repeat(64));
        }),
      {
        driverFor: () => makeDriver(),
        managedImageRegistry: {
          repository: "vcr.vercel.com/team/image",
          readManifest: () =>
            Effect.succeed({
              digest: "sha256:" + "e".repeat(64),
              manifests: [
                {
                  digest: "sha256:" + "f".repeat(64),
                  platform: { os: "linux", architecture: "amd64" },
                },
                {
                  digest: "sha256:" + "0".repeat(64),
                  platform: { os: "linux", architecture: "arm64" },
                },
              ],
            }),
        },
      },
    ),
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
            image: { kind: "custom", digest: profile.imageDigest },
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
            image: { kind: "custom", digest: profile.imageDigest },
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
            image: { kind: "custom", digest: profile.imageDigest },
            enabled: true,
            profileId,
          });
          const accepted = yield* service.create("desktop-bootstrap", createInput("request-3"));
          const created = yield* service.getOperation(accepted.operationId);
          const deploymentId = created.deploymentId;
          if (deploymentId === undefined) throw new Error("Expected a deployment id.");
          const first = yield* service.mintHandoff(deploymentId);
          const second = yield* service.mintHandoff(deploymentId);
          if (first.attachment !== "direct" || second.attachment !== "direct") {
            throw new Error("Expected direct handoffs.");
          }
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
            image: { kind: "custom", digest: profile.imageDigest },
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

  it.effect("stops and starts the same deployment idempotently", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-lifecycle-request"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            image: { kind: "custom", digest: profile.imageDigest },
            enabled: true,
            profileId,
          });
          const created = yield* service.create(
            "desktop-bootstrap",
            createInput("lifecycle-create"),
          );
          const createdReceipt = yield* service.getOperation(created.operationId);
          if (createdReceipt.deploymentId === undefined) {
            throw new Error("Expected a deployment id.");
          }
          const deploymentId = createdReceipt.deploymentId;
          const before = yield* service.list();
          const deployment = before.deployments[0]?.deployment;
          if (deployment?.state !== "Identified") {
            throw new Error("Expected an identified deployment.");
          }

          const stopInput = {
            requestId: SandboxRequestId.make("lifecycle-stop"),
            deploymentId,
            expectedRevision: deployment.revision,
          };
          const stop = yield* service.stop("desktop-bootstrap", stopInput);
          const stopRetry = yield* service.stop("desktop-bootstrap", stopInput);
          expect(stopRetry).toEqual(stop);
          expect((yield* service.getOperation(stop.operationId)).result).toEqual({
            kind: "stopped",
            deploymentId,
          });
          expect((yield* service.list()).deployments[0]?.observation?.state).toBe("Stopped");

          const startInput = {
            requestId: SandboxRequestId.make("lifecycle-start"),
            deploymentId,
            expectedRevision: deployment.revision,
            attachment: "direct" as const,
          };
          const start = yield* service.start("desktop-bootstrap", startInput);
          const startRetry = yield* service.start("desktop-bootstrap", startInput);
          expect(startRetry).toEqual(start);
          const started = yield* service.getOperation(start.operationId);
          expect(started.result).toEqual({
            kind: "started",
            deploymentId,
            environmentId: "sandbox-env",
            endpoint: "http://127.0.0.1:3774",
          });
          expect((yield* service.mintHandoff(deploymentId)).attachment).toBe("direct");
          expect((yield* service.list()).deployments[0]?.observation?.state).toBe("Running");

          const stale = yield* Effect.result(
            service.start("desktop-bootstrap", {
              ...startInput,
              requestId: SandboxRequestId.make("lifecycle-start-stale"),
              expectedRevision: deployment.revision,
            }),
          );
          expect(stale._tag).toBe("Failure");
          if (stale._tag === "Failure") expect(stale.failure.kind).toBe("conflict");
        }),
      {
        driverFor: (() => {
          let running = true;
          const power: SandboxProviderPowerCapability = {
            inspect: () =>
              Effect.succeed({
                state: running ? ("Running" as const) : ("Stopped" as const),
                observedAt: "2026-08-30T00:00:04.000Z",
              }),
            stop: () => {
              running = false;
              return Effect.succeed<ProviderObservation>({
                state: "Stopped",
                observedAt: "2026-08-30T00:00:05.000Z",
              });
            },
            start: (input) => {
              running = true;
              return Effect.succeed({
                environmentId: "sandbox-env",
                endpoint: "http://127.0.0.1:3774",
                connectorOrigin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
                resource: input.resource,
              });
            },
          };
          const driver = makeDriver({ power });
          return () => driver;
        })(),
        issuePairingCredential: () =>
          Effect.succeed({
            credential: "lifecycle-token",
            expiresAt: "2026-08-30T00:05:00.000Z",
          }),
      },
    ),
  );

  it.effect("replays a started deployment after a crash before revision persistence", () => {
    let currentTime = "2026-08-30T00:00:01.000Z";
    let running = true;
    let failNextObservationSave = false;
    const power: SandboxProviderPowerCapability = {
      inspect: () =>
        Effect.succeed({
          state: running ? ("Running" as const) : ("Stopped" as const),
          observedAt: currentTime,
        }),
      stop: () => {
        running = false;
        return Effect.succeed<ProviderObservation>({
          state: "Stopped",
          observedAt: currentTime,
        });
      },
      start: (input) => {
        running = true;
        return Effect.succeed({
          environmentId: "sandbox-env",
          endpoint: "http://127.0.0.1:3775",
          connectorOrigin: { localHttpHost: "127.0.0.1", localHttpPort: 3773 },
          resource: { ...input.resource, hostPort: 3775 },
        });
      },
    };

    return runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-crash-recovery"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            image: { kind: "custom", digest: profile.imageDigest },
            enabled: true,
            profileId,
          });
          const created = yield* service.create(
            "desktop-bootstrap",
            createInput("crash-recovery-create"),
          );
          const createdReceipt = yield* service.getOperation(created.operationId);
          if (createdReceipt.deploymentId === undefined) throw new Error("Expected deployment id.");
          const deploymentId = createdReceipt.deploymentId;
          const before = yield* service.list();
          const identified = before.deployments[0]?.deployment;
          if (identified?.state !== "Identified")
            throw new Error("Expected identified deployment.");
          const stopped = yield* service.stop("desktop-bootstrap", {
            requestId: SandboxRequestId.make("crash-recovery-stop"),
            deploymentId,
            expectedRevision: identified.revision,
          });
          const stoppedReceipt = yield* service.getOperation(stopped.operationId);
          expect(stoppedReceipt.status).toBe("Succeeded");
          const stoppedDeployment = (yield* service.list()).deployments[0]?.deployment;
          if (stoppedDeployment?.state !== "Identified") {
            throw new Error("Expected identified stopped deployment.");
          }

          failNextObservationSave = true;
          const start = yield* service.start("desktop-bootstrap", {
            requestId: SandboxRequestId.make("crash-recovery-start"),
            deploymentId,
            expectedRevision: stoppedDeployment.revision,
            attachment: "direct",
          });
          const progress = yield* service.getOperation(start.operationId);
          expect(progress.status).toBe("Running");
          expect(progress.result).toMatchObject({
            kind: "started",
            endpoint: "http://127.0.0.1:3775",
          });

          failNextObservationSave = false;
          yield* service.recover();

          const recovered = yield* service.getOperation(start.operationId);
          const finalDeployment = (yield* service.list()).deployments[0]?.deployment;
          return { recovered, finalDeployment };
        }),
      {
        driverFor: () => makeDriver({ power }),
        now: () => currentTime,
        schedule: (effect) => effect.pipe(Effect.catchCause(() => Effect.void)),
      },
      {},
      (repository) => ({
        ...repository,
        saveObservation: (deploymentId, observation, expectedRevision) => {
          if (failNextObservationSave) {
            failNextObservationSave = false;
            return Effect.die("simulated process crash");
          }
          return repository.saveObservation(deploymentId, observation, expectedRevision);
        },
      }),
    ).pipe(
      Effect.tap(({ recovered, finalDeployment }) =>
        Effect.sync(() => {
          expect(recovered.status).toBe("Succeeded");
          expect(finalDeployment).toMatchObject({
            state: "Identified",
            endpoint: "http://127.0.0.1:3775",
            revision: 4,
          });
        }),
      ),
    );
  });

  it.effect("compensates a relay link when its response is malformed", () => {
    const fixture = makeRelayFixture({ malformedLink: true });
    return runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-malformed-relay"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            image: { kind: "custom", digest: profile.imageDigest },
            enabled: true,
            profileId,
          });
          const accepted = yield* service.create(
            "desktop-bootstrap",
            createInput("malformed-relay-create"),
          );
          const created = yield* service.getOperation(accepted.operationId);
          if (created.deploymentId === undefined) throw new Error("Expected deployment id.");
          const result = yield* Effect.result(service.mintHandoff(created.deploymentId, "relay"));
          expect(result._tag).toBe("Failure");
          expect(fixture.requests.at(-1)?.url).toBe(
            "https://relay.example.test/v1/client/environment-links/sandbox-env",
          );
          expect(fixture.requests.map((request) => request.url)).toContain(
            "http://127.0.0.1:3774/api/connect/unlink",
          );
          expect((yield* service.list()).deployments[0]?.deployment).not.toMatchObject({
            attachment: "relay",
          });
          const cleanup = yield* service.delete("desktop-bootstrap", {
            requestId: SandboxRequestId.make("malformed-relay-delete"),
            deploymentId: created.deploymentId,
            expectedRevision: 3,
          });
          expect((yield* service.getOperation(cleanup.operationId)).status).toBe("Succeeded");
          expect(
            fixture.requests.filter((request) =>
              request.url.endsWith("/environment-links/sandbox-env"),
            ),
          ).toHaveLength(2);
        }),
      {
        relayUrl: "https://relay.example.test",
        driverFor: () => makeDriver(),
        issuePairingCredential: () =>
          Effect.succeed({
            credential: "relay-bootstrap-credential",
            expiresAt: "2026-08-30T00:05:00.000Z",
          }),
      },
      fixture,
    );
  });

  it.effect("uses current Connect relay linking and unlinks it after deletion", () => {
    const requests: Array<{ readonly url: string; readonly body: string }> = [];
    const httpClient = HttpClient.make((request) =>
      Effect.sync(() => {
        const body =
          request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "";
        requests.push({ url: request.url, body });
        const responseBody = request.url.endsWith("/environment-link-challenges")
          ? {
              challenge: "challenge-1",
              expiresAt: "2026-08-30T00:05:00.000Z",
            }
          : request.url.endsWith("/oauth/token")
            ? {
                access_token: "sandbox-access-token",
                issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
                token_type: "Bearer",
                expires_in: 300,
                scope: "relay:read relay:write",
              }
            : request.url.endsWith("/api/connect/link-proof")
              ? "signed-link-proof"
              : request.url.endsWith("/environment-links")
                ? {
                    ok: true,
                    cloudUserId: "cloud-user-1",
                    environmentId: "sandbox-env",
                    endpoint: {
                      httpBaseUrl: "https://sandbox.example.test",
                      wsBaseUrl: "wss://sandbox.example.test",
                      providerKind: "cloudflare_tunnel",
                    },
                    endpointRuntime: null,
                    relayIssuer: "https://relay.example.test",
                    environmentCredential: "environment-credential",
                    cloudMintPublicKey: "public-key",
                  }
                : { ok: true };
        return HttpClientResponse.fromWeb(request, Response.json(responseBody));
      }),
    );
    const token: CliTokenManager.PersistedToken = {
      accessToken: "control-access-token",
      refreshToken: "control-refresh-token",
      expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
    };
    const cloudCliTokenManager: CliTokenManager.CloudCliTokenManager["Service"] = {
      get: Effect.die("unused"),
      getExisting: Effect.succeed(Option.some(token)),
      hasCredential: Effect.succeed(true),
      store: () => Effect.die("unused"),
      clear: Effect.die("unused"),
    };

    return runWithService(
      (service) =>
        Effect.gen(function* () {
          yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("profile-relay-request"),
            name: profile.name,
            driverKind: "docker",
            socketPath: profile.socketPath,
            image: { kind: "custom", digest: profile.imageDigest },
            enabled: true,
            profileId,
          });
          const accepted = yield* service.create("desktop-bootstrap", createInput("relay-create"));
          const created = yield* service.getOperation(accepted.operationId);
          if (created.deploymentId === undefined) throw new Error("Expected a deployment id.");

          const handoff = yield* service.mintHandoff(created.deploymentId, "relay");
          expect(handoff).toMatchObject({
            attachment: "relay",
            relayEnvironmentId: "sandbox-env",
            label: "Issue 159",
          });
          expect(requests.map((request) => request.url)).toEqual([
            "https://relay.example.test/v1/client/environment-link-challenges",
            "http://[::1]:3774/oauth/token",
            "http://[::1]:3774/api/connect/link-proof",
            "https://relay.example.test/v1/client/environment-links",
            "http://[::1]:3774/api/connect/relay-config",
          ]);
          expect(requests[1]?.body).toContain("scope=relay%3Aread+relay%3Awrite");
          expect(requests[2]?.body).toContain('"httpBaseUrl":"http://[2001:db8::10]:3774"');
          expect(requests[2]?.body).toContain('"localHttpHost":"127.0.0.1"');
          expect(requests[2]?.body).toContain('"localHttpPort":3773');
          expect((yield* service.list()).deployments[0]?.deployment).toMatchObject({
            state: "Identified",
            attachment: "relay",
            revision: 4,
          });

          const deleted = yield* service.delete("desktop-bootstrap", {
            requestId: SandboxRequestId.make("relay-delete"),
            deploymentId: created.deploymentId,
            expectedRevision: 4,
          });
          const deleteReceipt = yield* service.getOperation(deleted.operationId);
          expect(deleteReceipt.result).toEqual({
            kind: "deleted",
            deploymentId: created.deploymentId,
            environmentId: "sandbox-env",
          });
          expect(requests.at(-1)?.url).toBe(
            "https://relay.example.test/v1/client/environment-links/sandbox-env",
          );
        }),
      {
        relayUrl: "https://relay.example.test",
        driverFor: () =>
          makeDriver({
            identify: (input) =>
              Effect.succeed({
                environmentId: "sandbox-env",
                endpoint: "http://[2001:db8::10]:3774",
                workspaceRoot: "/workspace",
                resource: input.resource,
              }),
          }),
        issuePairingCredential: () =>
          Effect.succeed({
            credential: "relay-bootstrap-credential",
            expiresAt: "2026-08-30T00:05:00.000Z",
          }),
      },
      { cloudCliTokenManager, httpClient },
    );
  });

  it.effect(
    "refuses a relay delete before destroying the container when Connect is unauthorized",
    () => {
      const fixture = makeRelayFixture();
      let token: Option.Option<CliTokenManager.PersistedToken> = Option.some({
        accessToken: "control-access-token",
        refreshToken: "control-refresh-token",
        expiresAtEpochMs: Number.MAX_SAFE_INTEGER,
      });
      const cloudCliTokenManager: CliTokenManager.CloudCliTokenManager["Service"] = {
        get: Effect.die("unused"),
        getExisting: Effect.sync(() => token),
        hasCredential: Effect.succeed(true),
        store: () => Effect.die("unused"),
        clear: Effect.die("unused"),
      };
      let deleteCalls = 0;
      return runWithService(
        (service) =>
          Effect.gen(function* () {
            yield* service.upsertProfile("desktop-bootstrap", {
              requestId: SandboxRequestId.make("profile-relay-unauthorized-delete"),
              name: profile.name,
              driverKind: "docker",
              socketPath: profile.socketPath,
              image: { kind: "custom", digest: profile.imageDigest },
              enabled: true,
              profileId,
            });
            const accepted = yield* service.create(
              "desktop-bootstrap",
              createInput("relay-unauthorized-delete-create"),
            );
            const created = yield* service.getOperation(accepted.operationId);
            if (created.deploymentId === undefined) throw new Error("Expected a deployment id.");
            yield* service.mintHandoff(created.deploymentId, "relay");
            token = Option.none();
            const deleted = yield* service.delete("desktop-bootstrap", {
              requestId: SandboxRequestId.make("relay-unauthorized-delete"),
              deploymentId: created.deploymentId,
              expectedRevision: 4,
            });
            const receipt = yield* service.getOperation(deleted.operationId);
            expect(receipt.status).toBe("Failed");
            expect(receipt.error).toContain("Authorize Kata Code Connect");
            expect(deleteCalls).toBe(0);
            expect((yield* service.list()).deployments[0]?.deployment).toMatchObject({
              state: "Identified",
              attachment: "relay",
            });
          }),
        {
          relayUrl: "https://relay.example.test",
          driverFor: () =>
            makeDriver({
              delete: () => {
                deleteCalls += 1;
                return Effect.succeed<ProviderObservation>({
                  state: "Gone",
                  observedAt: "2026-08-30T00:00:05.000Z",
                });
              },
            }),
          issuePairingCredential: () =>
            Effect.succeed({
              credential: "relay-bootstrap-credential",
              expiresAt: "2026-08-30T00:05:00.000Z",
            }),
        },
        { cloudCliTokenManager, httpClient: fixture.httpClient },
      );
    },
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
            image: { kind: "custom", digest: profile.imageDigest },
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

  it.effect("attaches host availability diagnostics to the Docker provider", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          const listed = yield* service.list();
          const docker = listed.providers.find((provider) => provider.driverKind === "docker");
          expect(docker?.availabilityDiagnostic).toBe(
            "Managed image for version 0.0.42 was not found.",
          );
        }),
      {
        driverFor: () => makeDriver(),
        hostAvailability: () => Effect.succeed("Managed image for version 0.0.42 was not found."),
      },
    ),
  );

  it.effect("lists when the OCI registry client is missing from context", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          const listed = yield* service.list();
          const docker = listed.providers.find((provider) => provider.driverKind === "docker");
          expect(docker?.driverKind).toBe("docker");
          expect(docker?.availabilityDiagnostic).toBeTruthy();
        }),
      {
        driverFor: () => makeDriver(),
        hostAvailability: () =>
          probeSandboxHostAvailability({
            driver: makeDriver(),
            registry: makeOciRegistry({ repository: "ghcr.io/gannonh/kata-sandbox" }),
            serverVersion: "0.0.42",
          }),
      },
    ),
  );

  it.effect("persists a profile before image validation fails", () =>
    runWithService(
      (service) =>
        Effect.gen(function* () {
          const accepted = yield* service.upsertProfile("desktop-bootstrap", {
            requestId: SandboxRequestId.make("failed-profile-request"),
            name: "Unavailable Docker",
            driverKind: "docker",
            image: { kind: "custom", digest: imageDigest },
            enabled: true,
            profileId,
          });
          const receipt = yield* service.getOperation(accepted.operationId);
          const listed = yield* service.list();
          expect(receipt.status).toBe("Failed");
          expect(receipt.progress).toEqual({
            stage: "failed",
            lastStage: "validating-image",
            diagnostic: "image pull failed",
          });
          expect(listed.profiles[0]?.kind).toBe("unavailable");
          expect(listed.profiles[0]?.profile.imageDigest).toBe(imageDigest);
        }),
      {
        driverFor: () =>
          makeDriver({
            validateProfile: () =>
              Effect.fail(
                new SandboxDriverError({
                  reason: "image-unavailable",
                  message: "image pull failed",
                }),
              ),
          }),
      },
    ),
  );
});
