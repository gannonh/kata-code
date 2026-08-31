import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
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
  SandboxDeploymentId,
  SandboxOperationId,
  SandboxOperationReceipt,
  SandboxProfile,
  SandboxProviderProfileId,
  SandboxRequestId,
  SandboxWorkspaceRoot,
  type SandboxDeploymentIntent,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  SandboxDeploymentRepository,
  SandboxRepositoryConflictError,
} from "./SandboxDeploymentRepository.ts";
import { layer as sandboxDeploymentRepositoryLayer } from "./SandboxDeploymentRepository.ts";
import { requestDeployment } from "@kata-sh/code-kata-sandbox/deployment";

const imageDigest = OciImageDigest.make("ghcr.io/kata-sh/sandbox@sha256:" + "a".repeat(64));
const profileId = SandboxProviderProfileId.make("profile-1");
const deploymentId = SandboxDeploymentId.make("deployment-1");
const requestId = SandboxRequestId.make("request-1");

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

const intent: SandboxDeploymentIntent = {
  deploymentId,
  controlEnvironmentId: EnvironmentId.make("control-env"),
  profileId,
  profileRevision: 1,
  profileSnapshot: profile,
  providerInstanceId: ProviderInstanceId.make("codex"),
  label: "Issue 159",
  source: {
    repository: GitHubRepository.make("gannonh/kata-code"),
    ref: GitHubRef.make("main"),
    resolvedCommitSha: CommitSha.make("b".repeat(40)),
  },
  bootstrapManifest: {
    version: 1,
    imageDigest,
    kataVersion: "0.0.42",
    serverVersion: "0.0.42",
    serverArtifactSha256: "c".repeat(64),
    codexVersion: "bundled",
    codexArtifactSha256: "d".repeat(64),
  },
  workspaceRoot: SandboxWorkspaceRoot.make("/workspace"),
  kataHome: SandboxWorkspaceRoot.make("/var/lib/katacode"),
  requestedAt: "2026-08-30T00:00:00.000Z",
};

const receipt: SandboxOperationReceipt = {
  operationId: SandboxOperationId.make("operation-1"),
  requestId,
  command: "create",
  payloadHash: "e".repeat(64),
  status: "Accepted",
  deploymentId,
  acceptedAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

const resource: DockerResourceHandle = {
  containerId: SandboxContainerId.make("container-1"),
  containerName: SandboxContainerName.make("kata-sandbox-deployment-1"),
  hostPort: 3774,
  containerPort: 3773,
  ownership: {
    controlEnvironmentId: intent.controlEnvironmentId,
    deploymentId,
    profileId,
    profileRevision: 1,
    schemaVersion: "v1",
  },
};

it.layer(NodeServices.layer)("SandboxDeploymentRepository.layer", (it) => {
  it.effect("round-trips profiles, deployments, and observations", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveProfile(profile);
      yield* repository.saveDeployment(requestDeployment(intent));
      yield* repository.saveObservation(deploymentId, {
        state: "Running",
        observedAt: "2026-08-30T00:00:01.000Z",
        environmentId: intent.controlEnvironmentId,
      });

      const storedProfile = yield* repository.getProfile(profileId);
      const storedDeployment = yield* repository.getDeployment(deploymentId);
      const storedObservation = yield* repository.getObservation(deploymentId);

      expect(Option.getOrUndefined(storedProfile)).toEqual(profile);
      expect(Option.getOrUndefined(storedDeployment)).toEqual(requestDeployment(intent));
      expect(Option.getOrUndefined(storedObservation)).toEqual({
        state: "Running",
        observedAt: "2026-08-30T00:00:01.000Z",
        environmentId: intent.controlEnvironmentId,
      });
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("enforces compare-and-swap revisions and request identity", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveProfile(profile);

      const updated = { ...profile, revision: 2, updatedAt: "2026-08-30T00:00:02.000Z" };
      yield* repository.saveProfile(updated, 1);
      const stale = yield* Effect.flip(repository.saveProfile({ ...updated, revision: 3 }, 1));
      expect(stale).toBeInstanceOf(SandboxRepositoryConflictError);

      const staleAcceptance = yield* Effect.flip(
        repository.accept({
          actor: "desktop-bootstrap",
          receipt: {
            ...receipt,
            operationId: SandboxOperationId.make("operation-stale"),
            requestId: SandboxRequestId.make("request-stale"),
            deploymentId: SandboxDeploymentId.make("deployment-stale"),
            expectedRevision: 0,
          },
          deployment: requestDeployment(intent),
        }),
      );
      expect(staleAcceptance).toBeInstanceOf(SandboxRepositoryConflictError);

      const acceptedWithRevision = yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt: {
          ...receipt,
          operationId: SandboxOperationId.make("operation-expected"),
          requestId: SandboxRequestId.make("request-expected"),
          deploymentId: SandboxDeploymentId.make("deployment-expected"),
          expectedRevision: 2,
        },
        deployment: requestDeployment({
          ...intent,
          deploymentId: SandboxDeploymentId.make("deployment-expected"),
        }),
      });
      expect(acceptedWithRevision.expectedRevision).toBe(2);

      const accepted = yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt,
        deployment: requestDeployment(intent),
      });
      const retried = yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt: { ...receipt, operationId: SandboxOperationId.make("operation-2") },
        deployment: requestDeployment({
          ...intent,
          deploymentId: SandboxDeploymentId.make("deployment-2"),
        }),
      });

      expect(retried).toEqual(accepted);
      expect((yield* repository.getDeployment(deploymentId)).pipe(Option.getOrUndefined)).toEqual(
        requestDeployment(intent),
      );
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("adopts an allocated deployment with its persisted resource", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveDeployment(requestDeployment(intent));
      const allocated = {
        state: "Allocated" as const,
        revision: 2,
        intent,
        resource,
      };
      yield* repository.saveDeployment(allocated, 1);
      const stored = yield* repository.getDeployment(deploymentId);
      expect(Option.getOrUndefined(stored)).toEqual(allocated);
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("treats a repeated profile delete as already complete", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveProfile({ ...profile, enabled: false });
      yield* repository.deleteProfile(profileId, 1);
      yield* repository.deleteProfile(profileId, 1);
      expect(Option.isNone(yield* repository.getProfile(profileId))).toBe(true);
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("retains the profile reference for active deployment states", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveProfile({ ...profile, enabled: false });
      yield* repository.saveDeployment(requestDeployment(intent));
      yield* repository.saveDeployment(
        {
          state: "Allocated",
          revision: 2,
          intent,
          resource,
        },
        1,
      );

      const deleted = yield* Effect.flip(repository.deleteProfile(profileId));
      expect(deleted).toBeInstanceOf(SandboxRepositoryConflictError);
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );
});
