// @effect-diagnostics globalDate:off - timestamps are injected through the driver clock option.
// @effect-diagnostics preferSchemaOverJson:off - Docker Engine request and response bodies are private wire data.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { PositiveInt, type ModelSelection } from "@kata-sh/code-contracts";
import {
  DEFAULT_SANDBOX_CONTAINER_PORT,
  DEFAULT_SANDBOX_KATA_HOME,
  DEFAULT_SANDBOX_WORKSPACE_ROOT,
  SandboxBootstrapManifest,
  SandboxContainerId,
  SandboxContainerName,
  SandboxProviderLabels,
  type DockerResourceHandle,
  type ProviderObservation,
  type SandboxDeploymentIntent,
  type SandboxProfile,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  SandboxDriverError,
  type SandboxIdentifiedFacts,
  type SandboxProviderDriver,
  type SandboxValidatedProfile,
} from "@kata-sh/code-kata-sandbox/driver";

import { type DockerEngine, DockerEngineError, makeDockerEngine } from "./engine.ts";

const DOCKER_KIND = "docker" as const;
const READY_PATH = "/.well-known/kata/environment";

interface DockerInspect {
  readonly Id: string;
  readonly Name: string;
  readonly State: { readonly Running: boolean };
  readonly Config: { readonly Labels: Record<string, string> | null };
  readonly NetworkSettings: {
    readonly Ports: Record<string, ReadonlyArray<{ readonly HostPort: string }> | null>;
  };
}

interface ReadinessResponse {
  readonly environmentId: string;
  readonly serverVersion: string;
}

export interface DockerSandboxDriverOptions {
  readonly engine?: DockerEngine;
  readonly socketPath?: string;
  readonly engineForSocketPath?: (socketPath: string) => DockerEngine;
  readonly now?: () => string;
  readonly readinessProbe?: (
    endpoint: string,
    manifest: SandboxBootstrapManifest,
  ) => Effect.Effect<ReadinessResponse, SandboxDriverError>;
}

export function dockerContainerName(deploymentId: string): string {
  return "kata-sandbox-" + deploymentId.replace(/[^a-zA-Z0-9_.-]/g, "-");
}

export function dockerOwnershipLabels(intent: SandboxDeploymentIntent): Record<string, string> {
  return {
    [SandboxProviderLabels.controlEnvironmentId]: intent.controlEnvironmentId,
    [SandboxProviderLabels.deploymentId]: intent.deploymentId,
    [SandboxProviderLabels.profileId]: intent.profileId,
    [SandboxProviderLabels.profileRevision]: String(intent.profileRevision),
    [SandboxProviderLabels.schemaVersion]: "v1",
    "com.katacode.sandbox.display-label": intent.label,
  };
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

const decodeInspect = Schema.decodeUnknownSync(
  Schema.Struct({
    Id: Schema.String,
    Name: Schema.String,
    State: Schema.Struct({ Running: Schema.Boolean }),
    Config: Schema.Struct({
      Labels: Schema.Union([Schema.Record(Schema.String, Schema.String), Schema.Null]),
    }),
    NetworkSettings: Schema.Struct({
      Ports: Schema.Record(
        Schema.String,
        Schema.Union([Schema.Array(Schema.Struct({ HostPort: Schema.String })), Schema.Null]),
      ),
    }),
  }),
);

const decodeCreate = Schema.decodeUnknownSync(Schema.Struct({ Id: Schema.String }));
const decodeExecCreate = Schema.decodeUnknownSync(Schema.Struct({ Id: Schema.String }));
const decodeExecInspect = Schema.decodeUnknownSync(
  Schema.Struct({ ExitCode: Schema.Union([Schema.Int, Schema.Null]) }),
);
const decodeDockerVersion = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ ApiVersion: Schema.String })),
);

function decodeReadiness(value: unknown): ReadinessResponse {
  if (value === null || typeof value !== "object") {
    throw new Error("Kata readiness response was not an object.");
  }
  const environmentId = Reflect.get(value, "environmentId");
  const serverVersion = Reflect.get(value, "serverVersion");
  if (typeof environmentId !== "string" || typeof serverVersion !== "string") {
    throw new Error("Kata readiness response did not contain environmentId and serverVersion.");
  }
  return { environmentId, serverVersion };
}

function asDriverError(cause: unknown, reason: SandboxDriverError["reason"]): SandboxDriverError {
  return new SandboxDriverError({
    reason,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

function engineFailure(
  error: DockerEngineError,
  reason: SandboxDriverError["reason"],
): SandboxDriverError {
  return new SandboxDriverError({ reason, message: error.message, cause: error });
}

function isSuccess(status: number): boolean {
  return status >= 200 && status < 300;
}

function inspectByName(
  engine: DockerEngine,
  name: string,
  reason: SandboxDriverError["reason"],
): Effect.Effect<DockerInspect | undefined, SandboxDriverError> {
  return engine.request({ path: "/containers/" + encodeURIComponent(name) + "/json" }).pipe(
    Effect.mapError((error) => engineFailure(error, reason)),
    Effect.flatMap((response) => {
      if (response.status === 404) return Effect.void.pipe(Effect.as(undefined));
      if (!isSuccess(response.status)) {
        return Effect.fail(
          new SandboxDriverError({
            reason,
            message:
              "Docker inspect returned " + response.status + ": " + response.body.slice(0, 200),
          }),
        );
      }
      return Effect.try({
        try: () => decodeInspect(parseJson(response.body)),
        catch: (cause) => asDriverError(cause, reason),
      });
    }),
  );
}

function labelsMatch(inspect: DockerInspect, intent: SandboxDeploymentIntent): boolean {
  const labels = inspect.Config.Labels;
  const expected = dockerOwnershipLabels(intent);
  return (
    labels !== null &&
    labels[SandboxProviderLabels.controlEnvironmentId] ===
      expected[SandboxProviderLabels.controlEnvironmentId] &&
    labels[SandboxProviderLabels.deploymentId] === expected[SandboxProviderLabels.deploymentId] &&
    labels[SandboxProviderLabels.profileId] === expected[SandboxProviderLabels.profileId] &&
    labels[SandboxProviderLabels.profileRevision] ===
      expected[SandboxProviderLabels.profileRevision] &&
    labels[SandboxProviderLabels.schemaVersion] === expected[SandboxProviderLabels.schemaVersion]
  );
}

function hostPort(inspect: DockerInspect): number | undefined {
  const binding = inspect.NetworkSettings.Ports[DEFAULT_SANDBOX_CONTAINER_PORT + "/tcp"];
  const port = binding?.[0]?.HostPort;
  if (port === undefined) return undefined;
  const parsed = Number(port);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function makeHandle(
  inspect: DockerInspect,
  intent: SandboxDeploymentIntent,
): Effect.Effect<DockerResourceHandle, SandboxDriverError> {
  const port = hostPort(inspect);
  const name = inspect.Name.startsWith("/") ? inspect.Name.slice(1) : inspect.Name;
  return Effect.succeed({
    containerId: SandboxContainerId.make(inspect.Id),
    containerName: SandboxContainerName.make(name),
    ...(port === undefined ? {} : { hostPort: PositiveInt.make(port) }),
    containerPort: PositiveInt.make(DEFAULT_SANDBOX_CONTAINER_PORT),
    ownership: {
      controlEnvironmentId: intent.controlEnvironmentId,
      deploymentId: intent.deploymentId,
      profileId: intent.profileId,
      profileRevision: intent.profileRevision,
      schemaVersion: "v1",
    },
  });
}

function validateAllocationInput(input: {
  readonly profile: SandboxProfile;
  readonly intent: SandboxDeploymentIntent;
  readonly manifest: SandboxBootstrapManifest;
}): Effect.Effect<void, SandboxDriverError> {
  if (
    input.intent.profileSnapshot.profileId !== input.profile.profileId ||
    input.intent.profileSnapshot.revision !== input.profile.revision ||
    input.intent.profileSnapshot.imageDigest !== input.profile.imageDigest ||
    input.manifest.imageDigest !== input.profile.imageDigest
  ) {
    return Effect.fail(
      new SandboxDriverError({
        reason: "invalid-profile",
        message: "Sandbox profile and bootstrap manifest do not match the deployment intent.",
      }),
    );
  }
  return Effect.void;
}

function createBody(input: {
  readonly profile: SandboxProfile;
  readonly intent: SandboxDeploymentIntent;
  readonly bootstrapToken?: string;
}): string {
  const env = [
    "HOME=/home/katacode",
    "KATACODE_HOME=" + DEFAULT_SANDBOX_KATA_HOME,
    "KATACODE_SANDBOX_IMAGE_DIGEST=" + input.profile.imageDigest,
    "KATACODE_SANDBOX_MANIFEST=" + JSON.stringify(input.intent.bootstrapManifest),
  ];
  if (input.bootstrapToken !== undefined) {
    env.push("KATACODE_SANDBOX_BOOTSTRAP_TOKEN=" + input.bootstrapToken);
  }

  return JSON.stringify({
    Image: input.profile.imageDigest,
    Cmd: [
      "katacode",
      "serve",
      "--host",
      "0.0.0.0",
      "--port",
      String(DEFAULT_SANDBOX_CONTAINER_PORT),
    ],
    Env: env,
    WorkingDir: DEFAULT_SANDBOX_WORKSPACE_ROOT,
    ExposedPorts: { [DEFAULT_SANDBOX_CONTAINER_PORT + "/tcp"]: {} },
    Labels: dockerOwnershipLabels(input.intent),
    HostConfig: {
      PortBindings: {
        [DEFAULT_SANDBOX_CONTAINER_PORT + "/tcp"]: [{ HostIp: "127.0.0.1", HostPort: "" }],
      },
      AutoRemove: false,
    },
  });
}

function writeOctal(buffer: Buffer, offset: number, length: number, value: number): void {
  const encoded = value.toString(8).padStart(length - 1, "0");
  buffer.write(encoded + "\0", offset, length, "ascii");
}

function buildTarArchive(
  files: ReadonlyArray<{ readonly name: string; readonly data: Uint8Array; readonly mode: number }>,
): Uint8Array {
  const chunks: Buffer[] = [];
  for (const file of files) {
    const data = Buffer.from(file.data);
    const header = Buffer.alloc(512);
    header.write(file.name, 0, "ascii");
    writeOctal(header, 100, 8, file.mode);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, data.length);
    writeOctal(header, 136, 12, 0);
    header.write("        ", 148, 8, "ascii");
    header.write("0", 156, "ascii");
    header.write("ustar\0", 257, "ascii");
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, "0"), 148, 6, "ascii");
    header.write("\0 ", 154, "ascii");
    chunks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function buildAuthArchive(authJson: Uint8Array): Uint8Array {
  return buildTarArchive([{ name: "auth.json", data: authJson, mode: 0o600 }]);
}

export function buildProviderSettingsArchive(modelSelection: ModelSelection): Uint8Array {
  const settings = JSON.stringify({
    providerInstances: {
      [modelSelection.instanceId]: {
        driver: "codex",
        config: {},
      },
    },
    textGenerationModelSelection: modelSelection,
  });
  return buildTarArchive([
    { name: "settings.json", data: Buffer.from(settings, "utf8"), mode: 0o600 },
  ]);
}

function demultiplex(buffer: Uint8Array): {
  readonly stdout: string;
  readonly stderr: string;
} {
  const bytes = Buffer.from(buffer);
  let offset = 0;
  let stdout = "";
  let stderr = "";
  while (offset + 8 <= bytes.length) {
    const stream = bytes[offset];
    const size = bytes.readUInt32BE(offset + 4);
    offset += 8;
    if (offset + size > bytes.length) break;
    const text = bytes.subarray(offset, offset + size).toString("utf8");
    if (stream === 1) stdout += text;
    if (stream === 2) stderr += text;
    offset += size;
  }
  return { stdout, stderr };
}

function exec(
  engine: DockerEngine,
  resource: DockerResourceHandle,
  command: string,
  cwd: string,
  reason: SandboxDriverError["reason"],
): Effect.Effect<
  { readonly exitCode: number; readonly stdout: string; readonly stderr: string },
  SandboxDriverError
> {
  return Effect.gen(function* () {
    const created = yield* engine
      .request({
        path: "/containers/" + resource.containerId + "/exec",
        method: "POST",
        body: JSON.stringify({
          Cmd: ["sh", "-lc", command],
          WorkingDir: cwd,
          AttachStdout: true,
          AttachStderr: true,
        }),
      })
      .pipe(Effect.mapError((error) => engineFailure(error, reason)));
    if (!isSuccess(created.status)) {
      return yield* new SandboxDriverError({
        reason,
        message:
          "Docker exec create returned " + created.status + ": " + created.body.slice(0, 200),
      });
    }
    const execId = yield* Effect.try({
      try: () => decodeExecCreate(parseJson(created.body)),
      catch: (cause) => asDriverError(cause, reason),
    });
    const started = yield* engine
      .requestBuffer({
        path: "/exec/" + execId.Id + "/start",
        method: "POST",
        body: JSON.stringify({ Detach: false, Tty: false }),
        hijacked: true,
      })
      .pipe(Effect.mapError((error) => engineFailure(error, reason)));
    const output = demultiplex(started.body);
    const inspected = yield* engine
      .request({ path: "/exec/" + execId.Id + "/json" })
      .pipe(Effect.mapError((error) => engineFailure(error, reason)));
    if (!isSuccess(inspected.status)) {
      return yield* new SandboxDriverError({
        reason,
        message:
          "Docker exec inspect returned " + inspected.status + ": " + inspected.body.slice(0, 200),
      });
    }
    const exit = yield* Effect.try({
      try: () => decodeExecInspect(parseJson(inspected.body)),
      catch: (cause) => asDriverError(cause, reason),
    });
    return {
      exitCode: exit.ExitCode ?? 1,
      stdout: output.stdout,
      stderr: output.stderr,
    };
  });
}

function defaultReadinessProbe(
  endpoint: string,
  manifest: SandboxBootstrapManifest,
): Effect.Effect<ReadinessResponse, SandboxDriverError> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    return yield* Effect.gen(function* () {
      const response = yield* client.execute(HttpClientRequest.get(endpoint + READY_PATH));
      if (!isSuccess(response.status)) {
        return yield* new SandboxDriverError({
          reason: "setup-failed",
          message: "Kata readiness returned " + response.status + ".",
        });
      }
      const body = yield* response.json;
      const readiness = yield* Effect.try({
        try: () => decodeReadiness(body),
        catch: (cause) => asDriverError(cause, "setup-failed"),
      });
      if (readiness.serverVersion !== manifest.serverVersion) {
        return yield* new SandboxDriverError({
          reason: "setup-failed",
          message:
            "sandbox server version " +
            readiness.serverVersion +
            " does not match " +
            manifest.serverVersion,
        });
      }
      return readiness;
    }).pipe(Effect.timeout("30 seconds"));
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof SandboxDriverError ? cause : asDriverError(cause, "setup-failed"),
    ),
    Effect.provide(FetchHttpClient.layer),
  );
}

function validateProfile(
  engine: DockerEngine,
  profile: SandboxProfile,
): Effect.Effect<SandboxValidatedProfile, SandboxDriverError> {
  return Effect.gen(function* () {
    const ping = yield* engine
      .request({ path: "/_ping" })
      .pipe(Effect.mapError((error) => engineFailure(error, "daemon-unavailable")));
    if (!isSuccess(ping.status)) {
      return yield* new SandboxDriverError({
        reason: "daemon-unavailable",
        message: "Docker daemon returned " + ping.status + ".",
      });
    }
    const image = yield* engine
      .request({ path: "/images/" + encodeURIComponent(profile.imageDigest) + "/json" })
      .pipe(Effect.mapError((error) => engineFailure(error, "image-unavailable")));
    if (image.status === 404) {
      return yield* new SandboxDriverError({
        reason: "image-unavailable",
        message: "Docker image " + profile.imageDigest + " is not present locally.",
      });
    }
    if (!isSuccess(image.status)) {
      return yield* new SandboxDriverError({
        reason: "image-unavailable",
        message: "Docker image inspection returned " + image.status + ".",
      });
    }
    const version = yield* engine
      .request({ path: "/version" })
      .pipe(Effect.mapError((error) => engineFailure(error, "daemon-unavailable")));
    if (!isSuccess(version.status)) {
      return yield* new SandboxDriverError({
        reason: "daemon-unavailable",
        message: "Docker version returned " + version.status + ".",
      });
    }
    const parsed = yield* decodeDockerVersion(version.body).pipe(
      Effect.mapError((cause) => asDriverError(cause, "daemon-unavailable")),
    );
    return { daemonVersion: parsed.ApiVersion, imageDigest: profile.imageDigest };
  });
}

function runningObservation(at: string): ProviderObservation {
  return { state: "Running", observedAt: at };
}

function goneObservation(at: string): ProviderObservation {
  return { state: "Gone", observedAt: at };
}

function unknownObservation(at: string, cause: unknown): ProviderObservation {
  return {
    state: "Unknown",
    observedAt: at,
    diagnostic: cause instanceof Error ? cause.message : String(cause),
  };
}

function removeOwnedContainer(
  engine: DockerEngine,
  containerId: string,
  intent: SandboxDeploymentIntent,
): Effect.Effect<void, never> {
  return inspectByName(engine, containerId, "allocation-failed").pipe(
    Effect.flatMap((inspect) => {
      if (inspect === undefined || !labelsMatch(inspect, intent)) return Effect.void;
      return engine
        .request({
          path: "/containers/" + encodeURIComponent(containerId) + "?force=true",
          method: "DELETE",
        })
        .pipe(Effect.asVoid);
    }),
    Effect.catch(() => Effect.void),
  );
}

export function makeDockerSandboxDriver(
  options: DockerSandboxDriverOptions = {},
): SandboxProviderDriver {
  const engineFor = (socketPath: string): DockerEngine =>
    options.engine ??
    options.engineForSocketPath?.(socketPath) ??
    makeDockerEngine(options.socketPath ?? socketPath);
  const now = options.now ?? (() => new Date().toISOString());
  const readinessProbe = options.readinessProbe ?? defaultReadinessProbe;

  return {
    kind: DOCKER_KIND,
    validateProfile: (profile) => validateProfile(engineFor(profile.socketPath), profile),
    allocate: (input) =>
      Effect.gen(function* () {
        yield* validateAllocationInput(input);
        const engine = engineFor(input.profile.socketPath);
        const name = dockerContainerName(input.intent.deploymentId);
        const existing = yield* inspectByName(engine, name, "allocation-failed");
        if (existing !== undefined) {
          if (!labelsMatch(existing, input.intent)) {
            return yield* new SandboxDriverError({
              reason: "allocation-failed",
              message: "Docker container " + name + " exists with foreign ownership labels.",
            });
          }
          return yield* makeHandle(existing, input.intent);
        }
        const created = yield* engine
          .request({
            path: "/containers/create?name=" + encodeURIComponent(name),
            method: "POST",
            body: createBody(input),
          })
          .pipe(Effect.mapError((error) => engineFailure(error, "allocation-failed")));
        if (created.status === 409) {
          const adopted = yield* inspectByName(engine, name, "allocation-failed");
          if (adopted !== undefined && labelsMatch(adopted, input.intent)) {
            return yield* makeHandle(adopted, input.intent);
          }
        }
        if (!isSuccess(created.status)) {
          return yield* new SandboxDriverError({
            reason: "allocation-failed",
            message:
              "Docker container create returned " +
              created.status +
              ": " +
              created.body.slice(0, 200),
          });
        }
        const createdId = (() => {
          try {
            const value: unknown = JSON.parse(created.body);
            return value !== null &&
              typeof value === "object" &&
              typeof Reflect.get(value, "Id") === "string"
              ? Reflect.get(value, "Id")
              : undefined;
          } catch {
            return undefined;
          }
        })();
        const allocated = Effect.gen(function* () {
          const response = yield* Effect.try({
            try: () => decodeCreate(parseJson(created.body)),
            catch: (cause) => asDriverError(cause, "allocation-failed"),
          });
          const inspected = yield* inspectByName(engine, response.Id, "allocation-failed");
          if (inspected === undefined) {
            return yield* new SandboxDriverError({
              reason: "allocation-failed",
              message: "Docker container disappeared immediately after creation.",
            });
          }
          return yield* makeHandle(inspected, input.intent);
        });
        return yield* allocated.pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Cleaning up an unpersisted sandbox allocation", {
              deploymentId: input.intent.deploymentId,
              reason: cause.message,
            }).pipe(
              Effect.andThen(
                createdId === undefined
                  ? Effect.void
                  : removeOwnedContainer(engine, createdId, input.intent),
              ),
            ),
          ),
        );
      }),
    identify: (input) =>
      Effect.gen(function* () {
        yield* validateAllocationInput(input);
        const engine = engineFor(input.profile.socketPath);
        const archive = buildAuthArchive(input.codexAuthJson);
        const copied = yield* engine
          .request({
            path:
              "/containers/" +
              input.resource.containerId +
              "/archive?path=" +
              encodeURIComponent("/home/katacode/.codex"),
            method: "PUT",
            bodyBytes: archive,
          })
          .pipe(Effect.mapError((error) => engineFailure(error, "setup-failed")));
        if (!isSuccess(copied.status)) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Docker auth seed returned " + copied.status + ".",
          });
        }
        if (input.modelSelection !== undefined) {
          const settingsCopied = yield* engine
            .request({
              path:
                "/containers/" +
                input.resource.containerId +
                "/archive?path=" +
                encodeURIComponent(DEFAULT_SANDBOX_KATA_HOME),
              method: "PUT",
              bodyBytes: buildProviderSettingsArchive(input.modelSelection),
            })
            .pipe(Effect.mapError((error) => engineFailure(error, "setup-failed")));
          if (!isSuccess(settingsCopied.status)) {
            return yield* new SandboxDriverError({
              reason: "setup-failed",
              message: "Docker provider settings seed returned " + settingsCopied.status + ".",
            });
          }
        }
        const inspected = yield* inspectByName(engine, input.resource.containerId, "setup-failed");
        if (inspected === undefined) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Sandbox container disappeared before start.",
          });
        }
        if (!labelsMatch(inspected, input.intent)) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Sandbox ownership labels changed before start.",
          });
        }
        if (!inspected.State.Running) {
          const started = yield* engine
            .request({
              path: "/containers/" + input.resource.containerId + "/start",
              method: "POST",
            })
            .pipe(Effect.mapError((error) => engineFailure(error, "setup-failed")));
          if (!isSuccess(started.status) && started.status !== 304) {
            return yield* new SandboxDriverError({
              reason: "setup-failed",
              message: "Docker start returned " + started.status + ".",
            });
          }
        }
        const running = yield* inspectByName(engine, input.resource.containerId, "setup-failed");
        if (running === undefined) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Sandbox container disappeared after start.",
          });
        }
        if (!labelsMatch(running, input.intent)) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Sandbox ownership labels changed after start.",
          });
        }
        const port = hostPort(running);
        if (port === undefined) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Docker did not publish the sandbox port after start.",
          });
        }
        const clone = yield* exec(
          engine,
          input.resource,
          "set -eu\n" +
            "mkdir -p " +
            shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
            "\n" +
            "git -C " +
            shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
            " init\n" +
            "git -C " +
            shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
            " remote remove origin 2>/dev/null || true\n" +
            "git -C " +
            shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
            " remote add origin " +
            shellQuote("https://github.com/" + input.intent.source.repository + ".git") +
            "\n" +
            "git -C " +
            shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
            " fetch --depth=1 origin " +
            shellQuote(input.intent.source.resolvedCommitSha) +
            "\n" +
            "git -C " +
            shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
            " checkout --detach FETCH_HEAD\n" +
            'test "$(git -C ' +
            shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
            ' rev-parse HEAD)" = ' +
            shellQuote(input.intent.source.resolvedCommitSha),
          "/",
          "setup-failed",
        );
        if (clone.exitCode !== 0) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Git checkout failed: " + clone.stderr.slice(0, 200),
          });
        }
        const endpoint = "http://127.0.0.1:" + port;
        const readiness = yield* readinessProbe(endpoint, input.manifest);
        return {
          environmentId: readiness.environmentId,
          endpoint,
          workspaceRoot: DEFAULT_SANDBOX_WORKSPACE_ROOT,
          resource: {
            ...input.resource,
            hostPort: PositiveInt.make(port),
          },
        } satisfies SandboxIdentifiedFacts;
      }),
    observe: (input): Effect.Effect<ProviderObservation, SandboxDriverError> => {
      const engine = engineFor(input.profile.socketPath);
      const resource = input.resource;
      return inspectByName(engine, resource.containerId, "observation-failed").pipe(
        Effect.map((inspect): ProviderObservation => {
          if (inspect === undefined) return goneObservation(now());
          const labels = inspect.Config.Labels;
          const owned =
            labels !== null &&
            labels[SandboxProviderLabels.controlEnvironmentId] ===
              resource.ownership.controlEnvironmentId &&
            labels[SandboxProviderLabels.deploymentId] === resource.ownership.deploymentId &&
            labels[SandboxProviderLabels.profileId] === resource.ownership.profileId &&
            labels[SandboxProviderLabels.profileRevision] ===
              String(resource.ownership.profileRevision) &&
            labels[SandboxProviderLabels.schemaVersion] === resource.ownership.schemaVersion;
          if (!owned) {
            return unknownObservation(now(), "Docker resource ownership could not be verified.");
          }
          if (!inspect.State.Running) {
            return unknownObservation(now(), "Docker sandbox container is stopped.");
          }
          return runningObservation(now());
        }),
        Effect.catch((cause) => Effect.succeed(unknownObservation(now(), cause))),
      );
    },
    delete: (input): Effect.Effect<ProviderObservation, SandboxDriverError> => {
      const engine = engineFor(input.profile.socketPath);
      const resource = input.resource;
      return inspectByName(engine, resource.containerId, "deletion-failed").pipe(
        Effect.flatMap((inspect) => {
          if (inspect === undefined) return Effect.succeed(goneObservation(now()));
          const labels = inspect.Config.Labels;
          const owned =
            labels !== null &&
            labels[SandboxProviderLabels.controlEnvironmentId] ===
              resource.ownership.controlEnvironmentId &&
            labels[SandboxProviderLabels.deploymentId] === resource.ownership.deploymentId &&
            labels[SandboxProviderLabels.profileId] === resource.ownership.profileId &&
            labels[SandboxProviderLabels.profileRevision] ===
              String(resource.ownership.profileRevision) &&
            labels[SandboxProviderLabels.schemaVersion] === resource.ownership.schemaVersion;
          if (!owned) {
            return Effect.succeed(
              unknownObservation(
                now(),
                "Docker delete refused because ownership could not be verified.",
              ),
            );
          }
          return engine
            .request({
              path: "/containers/" + resource.containerId + "?force=true",
              method: "DELETE",
            })
            .pipe(
              Effect.flatMap((response) => {
                if (response.status === 404) return Effect.succeed(goneObservation(now()));
                if (!isSuccess(response.status)) {
                  return Effect.succeed(
                    unknownObservation(now(), "Docker delete returned " + response.status + "."),
                  );
                }
                return inspectByName(engine, resource.containerId, "deletion-failed").pipe(
                  Effect.flatMap((after) =>
                    after === undefined
                      ? Effect.succeed(goneObservation(now()))
                      : Effect.succeed(
                          unknownObservation(
                            now(),
                            "Docker delete succeeded but the owned container is still present.",
                          ),
                        ),
                  ),
                );
              }),
              Effect.mapError((error) =>
                error instanceof DockerEngineError
                  ? engineFailure(error, "deletion-failed")
                  : error,
              ),
            );
        }),
        Effect.catch((cause) => Effect.succeed(unknownObservation(now(), cause))),
      );
    },
  };
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export { DOCKER_KIND, DEFAULT_SANDBOX_CONTAINER_PORT, DEFAULT_SANDBOX_KATA_HOME, shellQuote };
