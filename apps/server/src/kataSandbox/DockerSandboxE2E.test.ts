// @effect-diagnostics nodeBuiltinImport:off - the guarded test reads an auth fixture and generates isolated credentials and deployment IDs.
import * as NodeBuffer from "node:buffer";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import { ModelSelection, ProviderInstanceId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommitSha,
  GitHubRef,
  GitHubRepository,
  OciImageDigest,
  SandboxBootstrapManifest,
  SandboxDeploymentId,
  SandboxDeploymentIntent,
  SandboxProfile,
  SandboxProviderProfileId,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import { makeDockerSandboxDriver } from "@kata-sh/code-kata-sandbox-docker";

const enabled = process.env.KATACODE_DOCKER_E2E === "1";
const image = process.env.KATACODE_SANDBOX_IMAGE_DIGEST;
const socketPath = process.env.KATACODE_DOCKER_SOCKET ?? "/var/run/docker.sock";
const lifecycleFixture =
  process.env.KATACODE_DOCKER_E2E_REPOSITORY !== undefined &&
  process.env.KATACODE_DOCKER_E2E_REF !== undefined &&
  process.env.KATACODE_DOCKER_E2E_COMMIT_SHA !== undefined &&
  process.env.KATACODE_DOCKER_E2E_SERVER_VERSION !== undefined &&
  process.env.KATACODE_SANDBOX_SERVER_ARTIFACT_SHA256 !== undefined &&
  process.env.KATACODE_SANDBOX_CODEX_VERSION !== undefined &&
  process.env.KATACODE_SANDBOX_CODEX_ARTIFACT_SHA256 !== undefined;
const decodeSandboxProfile = Schema.decodeUnknownSync(SandboxProfile);
const decodeSandboxManifest = Schema.decodeUnknownSync(SandboxBootstrapManifest);
const decodeSandboxIntent = Schema.decodeUnknownSync(SandboxDeploymentIntent);

describe.runIf(enabled && image !== undefined)("Docker sandbox E2E", () => {
  it.effect("validates the configured immutable image against the local daemon", () => {
    // @effect-diagnostics-next-line globalDate:off
    const now = new Date().toISOString();
    const profile: SandboxProfile = {
      profileId: SandboxProviderProfileId.make("docker-e2e-profile"),
      name: "Docker E2E",
      driverKind: "docker",
      socketPath,
      imageDigest: OciImageDigest.make(image!),
      enabled: true,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };

    return Effect.gen(function* () {
      const result = yield* makeDockerSandboxDriver().validateProfile(profile);
      expect(result.imageDigest).toBe(profile.imageDigest);
      expect(result.daemonVersion).toBeTruthy();
    });
  });
});

describe.runIf(enabled && image !== undefined && lifecycleFixture)(
  "Docker sandbox lifecycle E2E",
  () => {
    it.effect("allocates, identifies, observes, and deletes one owned container", () => {
      // @effect-diagnostics-next-line globalDate:off
      const now = new Date().toISOString();
      const repository = GitHubRepository.make(process.env.KATACODE_DOCKER_E2E_REPOSITORY!);
      const ref = GitHubRef.make(process.env.KATACODE_DOCKER_E2E_REF!);
      const commitSha = CommitSha.make(process.env.KATACODE_DOCKER_E2E_COMMIT_SHA!);
      const serverVersion = process.env.KATACODE_DOCKER_E2E_SERVER_VERSION!;
      const profileId = SandboxProviderProfileId.make("docker-e2e-profile");
      const deploymentId = SandboxDeploymentId.make("docker-e2e-" + NodeCrypto.randomUUID());
      const providerInstanceId = ProviderInstanceId.make(
        process.env.KATACODE_DOCKER_E2E_PROVIDER_INSTANCE ?? "codex-e2e",
      );
      const profile = decodeSandboxProfile({
        profileId,
        name: "Docker E2E",
        driverKind: "docker",
        socketPath,
        imageDigest: OciImageDigest.make(image!),
        enabled: true,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      const manifest = decodeSandboxManifest({
        version: 1,
        imageDigest: profile.imageDigest,
        kataVersion: serverVersion,
        serverVersion,
        serverArtifactSha256: process.env.KATACODE_SANDBOX_SERVER_ARTIFACT_SHA256!,
        codexVersion: process.env.KATACODE_SANDBOX_CODEX_VERSION!,
        codexArtifactSha256: process.env.KATACODE_SANDBOX_CODEX_ARTIFACT_SHA256!,
      });
      const intent = decodeSandboxIntent({
        deploymentId,
        controlEnvironmentId: "docker-e2e-control",
        profileId,
        profileRevision: profile.revision,
        profileSnapshot: profile,
        providerInstanceId,
        label: "Docker E2E",
        source: { repository, ref, resolvedCommitSha: commitSha },
        bootstrapManifest: manifest,
        workspaceRoot: "/workspace",
        kataHome: "/var/lib/katacode",
        requestedAt: now,
      });
      const modelSelection: ModelSelection = {
        instanceId: providerInstanceId,
        model: process.env.KATACODE_DOCKER_E2E_MODEL ?? "gpt-5",
      };
      const authFile = process.env.KATACODE_DOCKER_E2E_AUTH_FILE;
      const codexAuthJson =
        authFile === undefined ? NodeBuffer.Buffer.from("{}") : NodeFS.readFileSync(authFile);
      const bootstrapToken = NodeCrypto.randomBytes(32).toString("base64url");
      const driver = makeDockerSandboxDriver();

      return Effect.acquireUseRelease(
        driver.allocate({
          profile,
          intent,
          manifest,
          codexAuthJson,
          modelSelection,
          bootstrapToken,
        }),
        (resource) =>
          Effect.gen(function* () {
            const identified = yield* driver.identify({
              profile,
              intent,
              manifest,
              codexAuthJson,
              modelSelection,
              bootstrapToken,
              resource,
            });
            expect(identified.resource.hostPort).toBeGreaterThan(0);
            expect(identified.workspaceRoot).toBe("/workspace");

            const observation = yield* driver.observe({
              profile,
              resource: identified.resource,
            });
            expect(observation.state).toBe("Running");
          }),
        (resource) =>
          driver.delete({ profile, resource }).pipe(
            Effect.tap((deleted) => Effect.sync(() => expect(deleted.state).toBe("Gone"))),
            Effect.asVoid,
          ),
      );
    });
  },
);
