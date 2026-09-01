// @effect-diagnostics nodeBuiltinImport:off - the guarded test reads an auth fixture and generates isolated credentials and deployment IDs.
// @effect-diagnostics preferSchemaOverJson:off - the test reads private Docker Engine wire responses.
import * as NodeBuffer from "node:buffer";
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import { ModelSelection, ProviderInstanceId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Data from "effect/Data";
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
import {
  type DockerEngine,
  makeDockerEngine,
  makeDockerSandboxDriver,
} from "@kata-sh/code-kata-sandbox-docker";

const enabled = process.env.KATACODE_DOCKER_E2E === "1";
const image = process.env.KATACODE_SANDBOX_IMAGE_DIGEST;
const socketPath = process.env.KATACODE_DOCKER_SOCKET ?? "/var/run/docker.sock";
const lifecycleFixture =
  process.env.KATACODE_DOCKER_E2E_PRIVATE_REPOSITORY === "1" &&
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

interface GitHubTokenFixture {
  readonly stdout: Buffer;
  readonly stderr: Buffer;
  readonly token: Uint8Array;
}

class DockerSandboxE2EError extends Data.TaggedError("DockerSandboxE2EError")<{
  readonly message: string;
}> {}

function trimAsciiWhitespace(bytes: Buffer): Uint8Array {
  let start = 0;
  let end = bytes.length;
  while (start < end && bytes[start]! <= 0x20) start += 1;
  while (end > start && bytes[end - 1]! <= 0x20) end -= 1;
  return bytes.subarray(start, end);
}

function acquireGitHubToken(): Effect.Effect<GitHubTokenFixture, DockerSandboxE2EError> {
  return Effect.try({
    try: () => {
      const result = NodeChildProcess.spawnSync(
        "gh",
        ["auth", "token", "--hostname", "github.com"],
        { encoding: "buffer", maxBuffer: 64 * 1024 },
      );
      const token = trimAsciiWhitespace(result.stdout);
      if (result.status !== 0 || token.byteLength === 0) {
        result.stdout.fill(0);
        result.stderr.fill(0);
        throw new Error();
      }
      return { stdout: result.stdout, stderr: result.stderr, token };
    },
    catch: () =>
      new DockerSandboxE2EError({
        message: "GitHub CLI authentication is required for this test.",
      }),
  });
}

function withGitHubToken<A, E, R>(
  use: (token: Uint8Array) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DockerSandboxE2EError, R> {
  return Effect.acquireUseRelease(
    acquireGitHubToken(),
    ({ token }) => use(token),
    ({ stdout, stderr }) =>
      Effect.sync(() => {
        stdout.fill(0);
        stderr.fill(0);
      }),
  );
}

function dockerExecCheck(
  engine: DockerEngine,
  containerId: string,
  command: string,
): Effect.Effect<void, DockerSandboxE2EError> {
  return Effect.gen(function* () {
    const created = yield* engine
      .request({
        path: "/containers/" + encodeURIComponent(containerId) + "/exec",
        method: "POST",
        body: JSON.stringify({
          Cmd: ["sh", "-lc", command],
          WorkingDir: "/workspace",
          AttachStdout: true,
          AttachStderr: true,
        }),
      })
      .pipe(
        Effect.mapError(
          () => new DockerSandboxE2EError({ message: "Docker exec creation failed." }),
        ),
      );
    if (created.status < 200 || created.status >= 300) {
      return yield* new DockerSandboxE2EError({ message: "Docker exec creation failed." });
    }
    const execId = yield* Effect.try({
      try: () => {
        const value: unknown = JSON.parse(created.body);
        if (value === null || typeof value !== "object") throw new Error();
        const id = Reflect.get(value, "Id");
        if (typeof id !== "string") throw new Error();
        return id;
      },
      catch: () =>
        new DockerSandboxE2EError({
          message: "Docker exec creation returned an invalid response.",
        }),
    });
    const started = yield* engine
      .requestBuffer({
        path: "/exec/" + encodeURIComponent(execId) + "/start",
        method: "POST",
        body: JSON.stringify({ Detach: false, Tty: false }),
        hijacked: true,
      })
      .pipe(Effect.mapError(() => new DockerSandboxE2EError({ message: "Docker exec failed." })));
    started.body.fill(0);
    const inspected = yield* engine
      .request({ path: "/exec/" + encodeURIComponent(execId) + "/json" })
      .pipe(
        Effect.mapError(
          () => new DockerSandboxE2EError({ message: "Docker exec inspection failed." }),
        ),
      );
    const exitCode = yield* Effect.try({
      try: () => {
        const value: unknown = JSON.parse(inspected.body);
        if (value === null || typeof value !== "object") throw new Error();
        const code = Reflect.get(value, "ExitCode");
        if (typeof code !== "number") throw new Error();
        return code;
      },
      catch: () =>
        new DockerSandboxE2EError({
          message: "Docker exec inspection returned an invalid response.",
        }),
    });
    if (exitCode !== 0) {
      return yield* new DockerSandboxE2EError({ message: "Docker assertion failed." });
    }
  });
}

function assertInspectHasNoToken(body: string, token: Uint8Array): void {
  const bytes = NodeBuffer.Buffer.from(body, "utf8");
  const needle = NodeBuffer.Buffer.from(token);
  try {
    if (bytes.includes(needle)) throw new Error("Docker inspect exposed the GitHub credential.");
  } finally {
    bytes.fill(0);
    needle.fill(0);
  }
}

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
  "Docker sandbox private repository driver-bound E2E",
  () => {
    it.live("checks out an exact private commit without retaining its credential", () => {
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
      const engine = makeDockerEngine(socketPath);
      const expectedOrigin = `https://github.com/${repository}.git`;
      const checkoutAssertion =
        'test "$(git -C /workspace rev-parse HEAD)" = ' +
        JSON.stringify(commitSha) +
        ' && test "$(git -C /workspace config --local --get remote.origin.url)" = ' +
        JSON.stringify(expectedOrigin) +
        ' && test -z "$(git -C /workspace config --local --get-all credential.helper)"' +
        " && test -z \"$(git -C /workspace config --local --get-regexp '^http\\..*\\.extraheader$')\"" +
        " && test -z \"$(git -C /workspace config --local --get-regexp '^url\\..*\\.insteadof$')\"" +
        " && test ! -e /run/kata-credentials/github-token" +
        " && test ! -e /run/kata-credentials/git-askpass";

      return withGitHubToken((token) => {
        const driver = makeDockerSandboxDriver({
          engine,
          checkoutCredential: { withToken: (use) => use(token) },
          readinessProbe: () =>
            Effect.succeed({ environmentId: "docker-e2e", serverVersion: serverVersion }),
        });
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

              yield* dockerExecCheck(engine, resource.containerId, checkoutAssertion);
              const inspected = yield* engine
                .request({
                  path: "/containers/" + encodeURIComponent(resource.containerId) + "/json",
                })
                .pipe(
                  Effect.mapError(
                    () => new DockerSandboxE2EError({ message: "Docker inspect failed." }),
                  ),
                );
              if (inspected.status !== 200) {
                return yield* new DockerSandboxE2EError({ message: "Docker inspect failed." });
              }
              assertInspectHasNoToken(inspected.body, token);

              const observation = yield* driver.observe({
                profile,
                resource: identified.resource,
              });
              expect(observation.state).toBe("Running");
            }),
          (resource) =>
            Effect.gen(function* () {
              const deleted = yield* driver.delete({ profile, resource });
              expect(deleted.state).toBe("Gone");
              const absent = yield* engine
                .request({
                  path: "/containers/" + encodeURIComponent(resource.containerId) + "/json",
                })
                .pipe(
                  Effect.mapError(
                    () =>
                      new DockerSandboxE2EError({
                        message: "Docker cleanup inspection failed.",
                      }),
                  ),
                );
              expect(absent.status).toBe(404);
            }).pipe(Effect.orDie),
        );
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            codexAuthJson.fill(0);
          }),
        ),
      );
    });
  },
);
