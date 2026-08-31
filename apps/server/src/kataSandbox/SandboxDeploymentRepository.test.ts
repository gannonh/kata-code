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

      const currentIntent = {
        ...intent,
        profileRevision: 2,
        profileSnapshot: updated,
      };
      const currentReceipt = { ...receipt, expectedRevision: 2 };

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
          ...currentIntent,
          deploymentId: SandboxDeploymentId.make("deployment-expected"),
        }),
      });
      expect(acceptedWithRevision.expectedRevision).toBe(2);

      const accepted = yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt: currentReceipt,
        deployment: requestDeployment(currentIntent),
      });
      const retried = yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt: {
          ...currentReceipt,
          operationId: SandboxOperationId.make("operation-2"),
        },
        deployment: requestDeployment({
          ...currentIntent,
          deploymentId: SandboxDeploymentId.make("deployment-2"),
        }),
      });

      expect(retried).toEqual(accepted);
      expect((yield* repository.getDeployment(deploymentId)).pipe(Option.getOrUndefined)).toEqual(
        requestDeployment(currentIntent),
      );
      expect(
        Option.isNone(yield* repository.getDeployment(SandboxDeploymentId.make("deployment-2"))),
      ).toBe(true);
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("claims each operation once until recover releases the claim", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveProfile(profile);
      yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt,
        deployment: requestDeployment(intent),
      });

      const first = yield* repository.claimOperation(
        receipt.operationId,
        "worker-1",
        "2026-08-30T00:00:00.000Z",
      );
      expect(Option.isSome(first)).toBe(true);
      expect(yield* repository.ownsOperation(receipt.operationId, "worker-1")).toBe(true);
      expect(yield* repository.ownsOperation(receipt.operationId, "worker-2")).toBe(false);

      const concurrent = yield* repository.claimOperation(
        receipt.operationId,
        "worker-2",
        "2026-08-30T00:00:11.000Z",
      );
      expect(Option.isNone(concurrent)).toBe(true);

      yield* repository.releaseInFlightClaims();
      expect(yield* repository.ownsOperation(receipt.operationId, "worker-1")).toBe(false);

      const recovered = yield* repository.claimOperation(
        receipt.operationId,
        "worker-2",
        "2026-08-30T00:00:11.000Z",
      );
      expect(Option.isSome(recovered)).toBe(true);
      if (Option.isSome(first)) {
        yield* repository.saveClaimedOperation({ ...first.value, status: "Succeeded" }, "worker-1");
      }
      expect(
        (yield* repository.getOperation(receipt.operationId)).pipe(Option.getOrUndefined)?.status,
      ).toBe("Running");
      if (Option.isSome(recovered)) {
        yield* repository.saveClaimedOperation(
          { ...recovered.value, status: "Succeeded" },
          "worker-2",
        );
      }
      expect(
        (yield* repository.getOperation(receipt.operationId)).pipe(Option.getOrUndefined)?.status,
      ).toBe("Succeeded");
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("allows only one concurrent recover takeover", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveProfile(profile);
      yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt,
        deployment: requestDeployment(intent),
      });
      yield* repository.claimOperation(receipt.operationId, "worker-1", "2026-08-30T00:00:00.000Z");
      yield* repository.releaseInFlightClaims();

      const claims = yield* Effect.all(
        [
          repository.claimOperation(receipt.operationId, "worker-2", "2026-08-30T00:00:41.000Z"),
          repository.claimOperation(receipt.operationId, "worker-3", "2026-08-30T00:00:41.000Z"),
        ],
        { concurrency: "unbounded" },
      );
      const winners = claims.filter(Option.isSome);
      expect(winners).toHaveLength(1);
      const winnerIndex = Option.isSome(claims[0]) ? 0 : 1;
      const winner = claims[winnerIndex];
      if (Option.isNone(winner)) throw new Error("Expected one recover takeover winner.");
      const winnerId = winnerIndex === 0 ? "worker-2" : "worker-3";
      yield* repository.saveClaimedOperation({ ...winner.value, status: "Succeeded" }, winnerId);
      expect(
        (yield* repository.getOperation(receipt.operationId)).pipe(Option.getOrUndefined)?.status,
      ).toBe("Succeeded");
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("orders equal-revision observations and rejects stale revisions", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveDeployment(requestDeployment(intent));
      yield* repository.saveObservation(deploymentId, {
        state: "Running",
        observedAt: "2026-08-30T00:00:02.000Z",
        environmentId: intent.controlEnvironmentId,
      });
      yield* repository.saveObservation(deploymentId, {
        state: "Stopped",
        observedAt: "2026-08-30T00:00:01.000Z",
      });
      expect(
        (yield* repository.getObservation(deploymentId)).pipe(Option.getOrUndefined),
      ).toMatchObject({ state: "Running", observedAt: "2026-08-30T00:00:02.000Z" });

      const allocated = {
        state: "Allocated" as const,
        revision: 2,
        intent,
        resource,
      };
      yield* repository.saveDeployment(allocated, 1);
      const stale = yield* Effect.flip(
        repository.saveObservation(
          deploymentId,
          { state: "Stopped", observedAt: "2026-08-30T00:00:03.000Z" },
          1,
        ),
      );
      expect(stale).toBeInstanceOf(SandboxRepositoryConflictError);
    }).pipe(
      Effect.provide(sandboxDeploymentRepositoryLayer.pipe(Layer.provide(SqlitePersistenceMemory))),
    ),
  );

  it.effect("rejects a second active operation for one deployment", () =>
    Effect.gen(function* () {
      const repository = yield* SandboxDeploymentRepository;
      yield* repository.saveProfile(profile);
      yield* repository.accept({
        actor: "desktop-bootstrap",
        receipt,
        deployment: requestDeployment(intent),
      });
      const second = yield* Effect.flip(
        repository.accept({
          actor: "mobile-bootstrap",
          receipt: {
            ...receipt,
            operationId: SandboxOperationId.make("operation-2"),
            requestId: SandboxRequestId.make("request-2"),
          },
        }),
      );
      expect(second).toBeInstanceOf(SandboxRepositoryConflictError);
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
