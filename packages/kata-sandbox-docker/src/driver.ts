// @effect-diagnostics globalDate:off - timestamps are injected through the driver clock option.
// @effect-diagnostics preferSchemaOverJson:off - Docker Engine request and response bodies are private wire data.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { EnvironmentId, PositiveInt, type ModelSelection } from "@kata-sh/code-contracts";
import {
  DEFAULT_SANDBOX_CONTAINER_PORT,
  DEFAULT_SANDBOX_KATA_HOME,
  DEFAULT_SANDBOX_WORKSPACE_ROOT,
  SandboxBootstrapManifest,
  SandboxContainerId,
  SandboxContainerName,
  SandboxProviderLabels,
  type SandboxProviderDescriptor,
  type DockerResourceHandle,
  type ProviderObservation,
  type SandboxDeploymentIntent,
  type SandboxOwnership,
  type SandboxProfile,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  SandboxDriverError,
  type SandboxGitHubCheckoutCredential,
  type SandboxIdentifiedFacts,
  type SandboxProviderDriver,
  type SandboxProviderResourceInput,
  type SandboxStartedFacts,
  type SandboxValidatedProfile,
  type SandboxValidationProgressReporter,
} from "@kata-sh/code-kata-sandbox/driver";

import { type DockerEngine, DockerEngineError, makeDockerEngine } from "./engine.ts";

const DOCKER_KIND = "docker" as const;
const DOCKER_DESCRIPTOR = {
  driverKind: DOCKER_KIND,
  category: "local-container",
  displayName: "Docker",
  profileForm: "docker",
} satisfies SandboxProviderDescriptor;
const IMAGE_PULL_TIMEOUT_MS = 5 * 60_000;
const READY_PATH = "/.well-known/kata/environment";
const DEFAULT_ENDPOINT_HOST = "127.0.0.1";
const CHECKOUT_READY_PATH = "/tmp/kata-sandbox-checkout-ready";
const CREDENTIAL_ROOT = "/run/kata-credentials";
const GITHUB_TOKEN_PATH = CREDENTIAL_ROOT + "/github-token";
const GIT_ASKPASS_PATH = CREDENTIAL_ROOT + "/git-askpass";

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
  readonly endpointHost?: string;
  readonly now?: () => string;
  readonly checkoutCredential?: SandboxGitHubCheckoutCredential;
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
const decodeEnvironmentId = Schema.decodeUnknownSync(EnvironmentId);

function decodeReadiness(value: unknown): ReadinessResponse {
  if (value === null || typeof value !== "object") {
    throw new Error("Kata readiness response was not an object.");
  }
  const environmentId = Reflect.get(value, "environmentId");
  const serverVersion = Reflect.get(value, "serverVersion");
  if (typeof environmentId !== "string" || typeof serverVersion !== "string") {
    throw new Error("Kata readiness response did not contain environmentId and serverVersion.");
  }
  return {
    environmentId: decodeEnvironmentId(environmentId),
    serverVersion,
  };
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

function isLoopbackHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function hostIpForEndpoint(host: string): string {
  if (isLoopbackHost(host)) return "127.0.0.1";
  return host.includes(":") ? "::" : "0.0.0.0";
}

function endpointUrl(host: string, port: number): string {
  const normalized = host.trim().replace(/^\[(.*)\]$/, "$1");
  const formatted = normalized.includes(":") ? `[${normalized}]` : normalized;
  return `http://${formatted}:${port}`;
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

function ownershipMatches(inspect: DockerInspect, ownership: SandboxOwnership): boolean {
  const labels = inspect.Config.Labels;
  return (
    labels !== null &&
    labels[SandboxProviderLabels.controlEnvironmentId] === ownership.controlEnvironmentId &&
    labels[SandboxProviderLabels.deploymentId] === ownership.deploymentId &&
    labels[SandboxProviderLabels.profileId] === ownership.profileId &&
    labels[SandboxProviderLabels.profileRevision] === String(ownership.profileRevision) &&
    labels[SandboxProviderLabels.schemaVersion] === ownership.schemaVersion
  );
}

function labelsMatch(inspect: DockerInspect, intent: SandboxDeploymentIntent): boolean {
  return ownershipMatches(inspect, {
    controlEnvironmentId: intent.controlEnvironmentId,
    deploymentId: intent.deploymentId,
    profileId: intent.profileId,
    profileRevision: intent.profileRevision,
    schemaVersion: "v1",
  });
}

function containerNameMatches(inspect: DockerInspect, expectedName: string): boolean {
  const name = inspect.Name.startsWith("/") ? inspect.Name.slice(1) : inspect.Name;
  return name === expectedName;
}

function allocatedIdentityMatches(
  inspect: DockerInspect,
  intent: SandboxDeploymentIntent,
): boolean {
  return (
    containerNameMatches(inspect, dockerContainerName(intent.deploymentId)) &&
    labelsMatch(inspect, intent)
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
  readonly endpointHost: string;
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
      "sh",
      "-c",
      "while [ ! -f " +
        shellQuote(CHECKOUT_READY_PATH) +
        " ]; do sleep 0.1; done\nexec katacode serve --host 0.0.0.0 --port " +
        String(DEFAULT_SANDBOX_CONTAINER_PORT),
    ],
    Env: env,
    WorkingDir: DEFAULT_SANDBOX_WORKSPACE_ROOT,
    ExposedPorts: { [DEFAULT_SANDBOX_CONTAINER_PORT + "/tcp"]: {} },
    Labels: dockerOwnershipLabels(input.intent),
    HostConfig: {
      Tmpfs: {
        [CREDENTIAL_ROOT]: "rw,exec,nosuid,nodev,size=65536,uid=1001,gid=1001,mode=0700",
      },
      PortBindings: {
        [DEFAULT_SANDBOX_CONTAINER_PORT + "/tcp"]: [
          { HostIp: hostIpForEndpoint(input.endpointHost), HostPort: "" },
        ],
      },
      AutoRemove: false,
    },
  });
}

export const SANDBOX_RUNTIME_UID = 1001;
export const SANDBOX_RUNTIME_GID = 1001;

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
    writeOctal(header, 108, 8, SANDBOX_RUNTIME_UID);
    writeOctal(header, 116, 8, SANDBOX_RUNTIME_GID);
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
  const archive = Buffer.concat(chunks);
  for (const chunk of chunks) chunk.fill(0);
  return archive;
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

const GIT_ASKPASS =
  "#!/bin/sh\n" +
  'case "$1" in\n' +
  "  Username*) printf '%s\\n' x-access-token ;;\n" +
  "  Password*) cat /run/kata-credentials/github-token ;;\n" +
  "  *) exit 1 ;;\n" +
  "esac\n";

function fixedSetupError(message: string): SandboxDriverError {
  return new SandboxDriverError({ reason: "setup-failed", message });
}

function checkoutFailure(exitCode: number): SandboxDriverError {
  const stage =
    exitCode === 41
      ? "workspace initialization"
      : exitCode === 42
        ? "remote configuration"
        : exitCode === 43
          ? "fetch"
          : exitCode === 44
            ? "detached checkout"
            : exitCode === 45
              ? "commit verification"
              : exitCode === 46
                ? "ready marker"
                : exitCode === 47
                  ? "credential file presence"
                  : exitCode === 48
                    ? "credential file content"
                    : exitCode === 49
                      ? "credential file access"
                      : exitCode === 50
                        ? "askpass validation"
                        : "checkout command";
  return fixedSetupError(`Authenticated Git ${stage} failed.`);
}

const CREDENTIAL_CLEANUP_COMMAND =
  "rm -f " + shellQuote(GITHUB_TOKEN_PATH) + " " + shellQuote(GIT_ASKPASS_PATH);

function cleanupCheckoutCredential(
  engine: DockerEngine,
  resource: DockerResourceHandle,
): Effect.Effect<void, SandboxDriverError> {
  return exec(engine, resource, CREDENTIAL_CLEANUP_COMMAND, "/", "setup-failed").pipe(
    Effect.mapError(() => fixedSetupError("Sandbox credential cleanup failed.")),
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.void
        : Effect.fail(fixedSetupError("Sandbox credential cleanup failed.")),
    ),
  );
}

function checkoutIsReady(
  engine: DockerEngine,
  resource: DockerResourceHandle,
  resolvedCommitSha: string,
): Effect.Effect<boolean, SandboxDriverError> {
  return exec(
    engine,
    resource,
    "test -f " +
      shellQuote(CHECKOUT_READY_PATH) +
      ' && test "$(git -C ' +
      shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT) +
      ' rev-parse HEAD 2>/dev/null)" = ' +
      shellQuote(resolvedCommitSha),
    "/",
    "setup-failed",
  ).pipe(
    Effect.map((result) => result.exitCode === 0),
    Effect.mapError(() => fixedSetupError("Sandbox checkout readiness check failed.")),
  );
}

function authenticatedCheckoutCommand(intent: SandboxDeploymentIntent): string {
  const workspace = shellQuote(DEFAULT_SANDBOX_WORKSPACE_ROOT);
  return (
    "set -eu\n" +
    "cleanup() { " +
    CREDENTIAL_CLEANUP_COMMAND +
    "; }\n" +
    "trap cleanup EXIT HUP INT TERM\n" +
    "export GIT_ASKPASS=" +
    shellQuote(GIT_ASKPASS_PATH) +
    "\n" +
    "export GIT_TERMINAL_PROMPT=0\n" +
    "export GIT_CONFIG_GLOBAL=/dev/null\n" +
    "export GIT_CONFIG_NOSYSTEM=1\n" +
    "test -e " +
    shellQuote(GITHUB_TOKEN_PATH) +
    " || exit 47\n" +
    "test -s " +
    shellQuote(GITHUB_TOKEN_PATH) +
    " || exit 48\n" +
    "test -r " +
    shellQuote(GITHUB_TOKEN_PATH) +
    " || exit 49\n" +
    "test -x " +
    shellQuote(GIT_ASKPASS_PATH) +
    " || exit 50\n" +
    'test "$(' +
    shellQuote(GIT_ASKPASS_PATH) +
    " 'Username for github.com')\" = x-access-token || exit 50\n" +
    "mkdir -p " +
    workspace +
    " || exit 41" +
    "\n" +
    "git -C " +
    workspace +
    " init || exit 41\n" +
    "git -C " +
    workspace +
    " remote remove origin 2>/dev/null || true\n" +
    "git -C " +
    workspace +
    " remote add origin " +
    shellQuote("https://github.com/" + intent.source.repository + ".git") +
    " || exit 42" +
    "\n" +
    "git -C " +
    workspace +
    " fetch --depth=1 origin " +
    shellQuote(intent.source.resolvedCommitSha) +
    " || exit 43" +
    "\n" +
    "git -C " +
    workspace +
    " checkout --detach FETCH_HEAD || exit 44\n" +
    'test "$(git -C ' +
    workspace +
    ' rev-parse HEAD)" = ' +
    shellQuote(intent.source.resolvedCommitSha) +
    " || exit 45"
  );
}

function authenticatedCheckout(
  engine: DockerEngine,
  resource: DockerResourceHandle,
  intent: SandboxDeploymentIntent,
  credential: SandboxGitHubCheckoutCredential,
): Effect.Effect<void, SandboxDriverError> {
  const bestEffortCleanup = cleanupCheckoutCredential(engine, resource).pipe(
    Effect.catch(() => Effect.void),
  );
  return credential
    .withToken((token) => {
      return Effect.gen(function* () {
        const askpass = yield* exec(
          engine,
          resource,
          "umask 077; printf '%s' " +
            shellQuote(Buffer.from(GIT_ASKPASS, "utf8").toString("base64")) +
            " | base64 -d > " +
            shellQuote(GIT_ASKPASS_PATH) +
            "; chmod 700 " +
            shellQuote(GIT_ASKPASS_PATH),
          "/",
          "setup-failed",
        ).pipe(Effect.mapError(() => fixedSetupError("Authenticated Git checkout failed.")));
        if (askpass.exitCode !== 0) {
          return yield* fixedSetupError("Authenticated Git checkout failed.");
        }
        const tokenWrite = yield* execWithStdin(
          engine,
          resource,
          "umask 077; cat > " +
            shellQuote(GITHUB_TOKEN_PATH) +
            "; chmod 600 " +
            shellQuote(GITHUB_TOKEN_PATH),
          token,
          "/",
          "setup-failed",
        ).pipe(Effect.mapError(() => fixedSetupError("Authenticated Git checkout failed.")));
        if (tokenWrite.exitCode !== 0) {
          return yield* fixedSetupError("Authenticated Git checkout failed.");
        }
        const result = yield* exec(
          engine,
          resource,
          authenticatedCheckoutCommand(intent),
          "/",
          "setup-failed",
        ).pipe(Effect.mapError(() => fixedSetupError("Authenticated Git checkout failed.")));
        if (result.exitCode !== 0) {
          return yield* checkoutFailure(result.exitCode);
        }
        yield* cleanupCheckoutCredential(engine, resource).pipe(
          Effect.mapError(() => fixedSetupError("Authenticated Git checkout failed.")),
        );
        const ready = yield* exec(
          engine,
          resource,
          "touch " + shellQuote(CHECKOUT_READY_PATH) + " || exit 46",
          "/",
          "setup-failed",
        ).pipe(Effect.mapError(() => fixedSetupError("Authenticated Git checkout failed.")));
        if (ready.exitCode !== 0) {
          return yield* checkoutFailure(ready.exitCode);
        }
      });
    })
    .pipe(Effect.ensuring(bestEffortCleanup));
}

function execWithStdin(
  engine: DockerEngine,
  resource: DockerResourceHandle,
  command: string,
  stdin: Uint8Array,
  cwd: string,
  reason: SandboxDriverError["reason"],
): Effect.Effect<{ readonly exitCode: number }, SandboxDriverError> {
  return Effect.gen(function* () {
    const created = yield* engine
      .request({
        path: "/containers/" + resource.containerId + "/exec",
        method: "POST",
        body: JSON.stringify({
          Cmd: ["sh", "-lc", command],
          WorkingDir: cwd,
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
        }),
      })
      .pipe(Effect.mapError((error) => engineFailure(error, reason)));
    if (!isSuccess(created.status)) {
      return yield* fixedSetupError("Authenticated Git checkout failed.");
    }
    const execId = yield* Effect.try({
      try: () => decodeExecCreate(parseJson(created.body)),
      catch: () => fixedSetupError("Authenticated Git checkout failed."),
    });
    const started = yield* engine
      .requestStdin(
        {
          path: "/exec/" + execId.Id + "/start",
          method: "POST",
          body: JSON.stringify({ Detach: false, Tty: false }),
        },
        stdin,
      )
      .pipe(Effect.mapError(() => fixedSetupError("Authenticated Git checkout failed.")));
    const startedStatus = started.status;
    started.body.fill(0);
    if (startedStatus !== 101 && !isSuccess(startedStatus)) {
      return yield* fixedSetupError("Authenticated Git checkout failed.");
    }
    const inspected = yield* engine
      .request({ path: "/exec/" + execId.Id + "/json" })
      .pipe(Effect.mapError(() => fixedSetupError("Authenticated Git checkout failed.")));
    if (!isSuccess(inspected.status)) {
      return yield* fixedSetupError("Authenticated Git checkout failed.");
    }
    const exit = yield* Effect.try({
      try: () => decodeExecInspect(parseJson(inspected.body)),
      catch: () => fixedSetupError("Authenticated Git checkout failed."),
    });
    return { exitCode: exit.ExitCode ?? 1 };
  });
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
      const response = yield* client
        .execute(HttpClientRequest.get(endpoint + READY_PATH))
        .pipe(
          Effect.retry(
            Schedule.spaced("250 millis").pipe(Schedule.upTo({ duration: "30 seconds" })),
          ),
        );
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

type DockerPullMessage = {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly error?: unknown;
  readonly errorDetail?: { readonly message?: unknown };
  readonly progressDetail?: { readonly current?: unknown; readonly total?: unknown };
};

function dockerPullError(message: DockerPullMessage): string | undefined {
  if (typeof message.error === "string" && message.error.length > 0) return message.error;
  const detail = message.errorDetail?.message;
  return typeof detail === "string" && detail.length > 0 ? detail : undefined;
}

function parseDockerPullMessage(line: string): DockerPullMessage | undefined {
  try {
    const message = JSON.parse(line) as unknown;
    return message !== null && typeof message === "object"
      ? (message as DockerPullMessage)
      : undefined;
  } catch {
    return undefined;
  }
}

function validateProfile(
  engine: DockerEngine,
  profile: SandboxProfile,
  reportProgress?: SandboxValidationProgressReporter,
  options: { readonly pullIfMissing?: boolean } = {},
): Effect.Effect<SandboxValidatedProfile, SandboxDriverError> {
  const report = (progress: Parameters<SandboxValidationProgressReporter>[0]) =>
    reportProgress === undefined ? Effect.void : reportProgress(progress);
  const localImageId = /^sha256:[0-9a-f]{64}$/.test(profile.imageDigest);
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
    let image = yield* engine
      .request({ path: "/images/" + encodeURIComponent(profile.imageDigest) + "/json" })
      .pipe(Effect.mapError((error) => engineFailure(error, "image-unavailable")));
    if (image.status === 404 && options.pullIfMissing !== false && !localImageId) {
      yield* report({
        stage: "pulling-image",
        downloadedBytes: 0,
        totalBytes: null,
        layersCompleted: 0,
        layersTotal: null,
      });
      const pulled = yield* engine
        .request({
          path: "/images/create?fromImage=" + encodeURIComponent(profile.imageDigest),
          method: "POST",
          timeoutMs: IMAGE_PULL_TIMEOUT_MS,
        })
        .pipe(Effect.mapError((error) => engineFailure(error, "image-unavailable")));
      if (!isSuccess(pulled.status)) {
        return yield* new SandboxDriverError({
          reason: "image-unavailable",
          message: "Docker image pull returned " + pulled.status + ".",
        });
      }
      const layerIds = new Set<string>();
      const completedLayerIds = new Set<string>();
      for (const line of pulled.body.split("\n")) {
        const message = parseDockerPullMessage(line);
        if (message === undefined) continue;
        const pullError = dockerPullError(message);
        if (pullError !== undefined) {
          return yield* new SandboxDriverError({
            reason: "image-unavailable",
            message: pullError,
          });
        }
        const layerId = typeof message.id === "string" ? message.id : undefined;
        if (layerId !== undefined) layerIds.add(layerId);
        if (
          layerId !== undefined &&
          typeof message.status === "string" &&
          /(?:pull complete|already exists|download complete)/iu.test(message.status)
        ) {
          completedLayerIds.add(layerId);
        }
        const current = message.progressDetail?.current;
        const total = message.progressDetail?.total;
        if (
          (current === undefined || (Number.isInteger(current) && (current as number) >= 0)) &&
          (total === undefined || (Number.isInteger(total) && (total as number) >= 0))
        ) {
          yield* report({
            stage: "pulling-image",
            downloadedBytes: typeof current === "number" ? current : 0,
            totalBytes: typeof total === "number" ? total : null,
            layersCompleted: completedLayerIds.size,
            layersTotal: layerIds.size || null,
          });
        }
      }
      image = yield* engine
        .request({ path: "/images/" + encodeURIComponent(profile.imageDigest) + "/json" })
        .pipe(Effect.mapError((error) => engineFailure(error, "image-unavailable")));
    }
    yield* report({ stage: "validating-image" });
    if (image.status === 404) {
      return yield* new SandboxDriverError({
        reason: "image-unavailable",
        message:
          "Docker image " +
          profile.imageDigest +
          (localImageId ? " is not present locally." : " is not present after pulling."),
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

function stoppedObservation(at: string): ProviderObservation {
  return { state: "Stopped", observedAt: at };
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

function resourceIdentityMatches(inspect: DockerInspect, resource: DockerResourceHandle): boolean {
  return (
    inspect.Id === resource.containerId &&
    containerNameMatches(inspect, resource.containerName) &&
    ownershipMatches(inspect, resource.ownership)
  );
}

function inspectStoredResource(
  engine: DockerEngine,
  resource: DockerResourceHandle,
  reason: SandboxDriverError["reason"],
): Effect.Effect<DockerInspect | undefined, SandboxDriverError> {
  return inspectByName(engine, resource.containerId, reason).pipe(
    Effect.flatMap((inspect) =>
      inspect !== undefined
        ? Effect.succeed(inspect)
        : inspectByName(engine, resource.containerName, reason),
    ),
  );
}

function removeOwnedContainer(
  engine: DockerEngine,
  containerId: string,
  intent: SandboxDeploymentIntent,
): Effect.Effect<void, never> {
  return inspectByName(engine, containerId, "allocation-failed").pipe(
    Effect.flatMap((inspect) => {
      if (
        inspect === undefined ||
        inspect.Id !== containerId ||
        !allocatedIdentityMatches(inspect, intent)
      )
        return Effect.void;
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
  const endpointHost = options.endpointHost ?? DEFAULT_ENDPOINT_HOST;

  const inspectPowerResource = (
    input: SandboxProviderResourceInput,
  ): Effect.Effect<DockerInspect | undefined, SandboxDriverError> =>
    inspectStoredResource(engineFor(input.profile.socketPath), input.resource, "lifecycle-failed");

  const powerObservation = (input: SandboxProviderResourceInput) =>
    inspectPowerResource(input).pipe(
      Effect.flatMap((inspect): Effect.Effect<ProviderObservation, SandboxDriverError> => {
        if (inspect === undefined) return Effect.succeed(goneObservation(now()));
        if (!resourceIdentityMatches(inspect, input.resource)) {
          return Effect.succeed(
            unknownObservation(now(), "Docker resource ownership could not be verified."),
          );
        }
        if (!inspect.State.Running) return Effect.succeed(stoppedObservation(now()));
        return Effect.succeed(runningObservation(now()));
      }),
      Effect.catch((cause) => Effect.succeed(unknownObservation(now(), cause))),
    );

  const startedFacts = (
    input: SandboxProviderResourceInput,
    inspect: DockerInspect,
  ): Effect.Effect<SandboxStartedFacts | ProviderObservation, SandboxDriverError> =>
    Effect.gen(function* () {
      const port = hostPort(inspect);
      if (port === undefined) {
        return yield* new SandboxDriverError({
          reason: "lifecycle-failed",
          message: "Docker did not publish the sandbox port after start.",
        });
      }
      const endpoint = endpointUrl(endpointHost, port);
      if (input.intent === undefined) return runningObservation(now());
      const readiness = yield* readinessProbe(endpoint, input.intent.bootstrapManifest).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDriverError({
              reason: "lifecycle-failed",
              message: cause.message,
              cause,
            }),
        ),
      );
      if (
        input.expectedEnvironmentId !== undefined &&
        readiness.environmentId !== input.expectedEnvironmentId
      ) {
        return yield* new SandboxDriverError({
          reason: "lifecycle-failed",
          message: "Sandbox readiness returned a different environment id.",
        });
      }
      return {
        environmentId: readiness.environmentId,
        endpoint,
        connectorOrigin: {
          localHttpHost: DEFAULT_ENDPOINT_HOST,
          localHttpPort: PositiveInt.make(DEFAULT_SANDBOX_CONTAINER_PORT),
        },
        resource: {
          ...input.resource,
          hostPort: PositiveInt.make(port),
        },
      } satisfies SandboxStartedFacts;
    });

  const stopPower = (input: SandboxProviderResourceInput) =>
    inspectPowerResource(input).pipe(
      Effect.flatMap((inspect) => {
        if (inspect === undefined) return Effect.succeed(goneObservation(now()));
        if (!resourceIdentityMatches(inspect, input.resource)) {
          return Effect.succeed(
            unknownObservation(now(), "Docker resource ownership could not be verified."),
          );
        }
        if (!inspect.State.Running) return Effect.succeed(stoppedObservation(now()));
        return engineFor(input.profile.socketPath)
          .request({
            path: "/containers/" + encodeURIComponent(input.resource.containerId) + "/stop",
            method: "POST",
          })
          .pipe(
            Effect.mapError((error) => engineFailure(error, "lifecycle-failed")),
            Effect.flatMap((response) => {
              if (!isSuccess(response.status) && response.status !== 304) {
                return Effect.fail(
                  new SandboxDriverError({
                    reason: "lifecycle-failed",
                    message: "Docker stop returned " + response.status + ".",
                  }),
                );
              }
              return powerObservation(input);
            }),
          );
      }),
      Effect.catch((cause) => Effect.succeed(unknownObservation(now(), cause))),
    );

  const startPower = (input: SandboxProviderResourceInput) =>
    inspectPowerResource(input).pipe(
      Effect.flatMap((inspect) => {
        if (inspect === undefined) return Effect.succeed(goneObservation(now()));
        if (!resourceIdentityMatches(inspect, input.resource)) {
          return Effect.succeed(
            unknownObservation(now(), "Docker resource ownership could not be verified."),
          );
        }
        const started = inspect.State.Running
          ? Effect.succeed(inspect)
          : engineFor(input.profile.socketPath)
              .request({
                path: "/containers/" + encodeURIComponent(input.resource.containerId) + "/start",
                method: "POST",
              })
              .pipe(
                Effect.mapError((error) => engineFailure(error, "lifecycle-failed")),
                Effect.flatMap((response) =>
                  !isSuccess(response.status) && response.status !== 304
                    ? Effect.fail(
                        new SandboxDriverError({
                          reason: "lifecycle-failed",
                          message: "Docker start returned " + response.status + ".",
                        }),
                      )
                    : inspectPowerResource(input).pipe(
                        Effect.flatMap((after) =>
                          after === undefined
                            ? Effect.fail(
                                new SandboxDriverError({
                                  reason: "lifecycle-failed",
                                  message: "Sandbox container disappeared after start.",
                                }),
                              )
                            : Effect.succeed(after),
                        ),
                      ),
                ),
              );
        return started.pipe(
          Effect.flatMap((after) => {
            if (!resourceIdentityMatches(after, input.resource)) {
              return Effect.succeed<ProviderObservation>(
                unknownObservation(now(), "Docker resource ownership changed after start."),
              );
            }
            if (!after.State.Running) return Effect.succeed(stoppedObservation(now()));
            return startedFacts(input, after);
          }),
        );
      }),
      Effect.catch((cause) => Effect.succeed(unknownObservation(now(), cause))),
    );

  return {
    kind: DOCKER_KIND,
    descriptor: DOCKER_DESCRIPTOR,
    validateProfile: (profile, reportProgress, validationOptions) =>
      validateProfile(engineFor(profile.socketPath), profile, reportProgress, validationOptions),
    allocate: (input) =>
      Effect.gen(function* () {
        yield* validateAllocationInput(input);
        const engine = engineFor(input.profile.socketPath);
        const name = dockerContainerName(input.intent.deploymentId);
        const existing = yield* inspectByName(engine, name, "allocation-failed");
        if (existing !== undefined) {
          if (!allocatedIdentityMatches(existing, input.intent)) {
            return yield* new SandboxDriverError({
              reason: "allocation-failed",
              message: "Docker container " + name + " exists with foreign ownership.",
            });
          }
          return yield* makeHandle(existing, input.intent);
        }
        const created = yield* engine
          .request({
            path: "/containers/create?name=" + encodeURIComponent(name),
            method: "POST",
            body: createBody({ ...input, endpointHost }),
          })
          .pipe(Effect.mapError((error) => engineFailure(error, "allocation-failed")));
        if (created.status === 409) {
          const adopted = yield* inspectByName(engine, name, "allocation-failed");
          if (adopted !== undefined && allocatedIdentityMatches(adopted, input.intent)) {
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
          if (!allocatedIdentityMatches(inspected, input.intent)) {
            return yield* new SandboxDriverError({
              reason: "allocation-failed",
              message: "Docker container ownership labels did not match after creation.",
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
        const existing = yield* inspectByName(engine, input.resource.containerId, "setup-failed");
        if (existing === undefined || !resourceIdentityMatches(existing, input.resource)) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Docker resource identity could not be verified before setup.",
          });
        }
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
        if (!resourceIdentityMatches(inspected, input.resource)) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Sandbox resource identity changed before start.",
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
        if (!resourceIdentityMatches(running, input.resource)) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Sandbox resource identity changed after start.",
          });
        }
        const port = hostPort(running);
        if (port === undefined) {
          return yield* new SandboxDriverError({
            reason: "setup-failed",
            message: "Docker did not publish the sandbox port after start.",
          });
        }
        yield* cleanupCheckoutCredential(engine, input.resource);
        const ready = yield* checkoutIsReady(
          engine,
          input.resource,
          input.intent.source.resolvedCommitSha,
        );
        if (!ready) {
          if (options.checkoutCredential === undefined) {
            return yield* fixedSetupError("Authenticated Git checkout is unavailable.");
          }
          yield* authenticatedCheckout(
            engine,
            input.resource,
            input.intent,
            options.checkoutCredential,
          );
        }
        const endpoint = endpointUrl(endpointHost, port);
        const readiness = yield* readinessProbe(endpoint, input.manifest);
        return {
          environmentId: readiness.environmentId,
          endpoint,
          connectorOrigin: {
            localHttpHost: DEFAULT_ENDPOINT_HOST,
            localHttpPort: PositiveInt.make(DEFAULT_SANDBOX_CONTAINER_PORT),
          },
          workspaceRoot: DEFAULT_SANDBOX_WORKSPACE_ROOT,
          resource: {
            ...input.resource,
            hostPort: PositiveInt.make(port),
          },
        } satisfies SandboxIdentifiedFacts;
      }),
    observe: (input): Effect.Effect<ProviderObservation, SandboxDriverError> =>
      powerObservation({ profile: input.profile, resource: input.resource }),
    delete: (input): Effect.Effect<ProviderObservation, SandboxDriverError> => {
      const engine = engineFor(input.profile.socketPath);
      const resource = input.resource;
      return inspectStoredResource(engine, resource, "deletion-failed").pipe(
        Effect.flatMap((inspect) => {
          if (inspect === undefined) return Effect.succeed(goneObservation(now()));
          const owned = resourceIdentityMatches(inspect, resource);
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
    power: {
      inspect: (input) => powerObservation(input),
      stop: (input) => stopPower(input),
      start: (input) => startPower(input),
    },
  };
}

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export { DOCKER_KIND, DEFAULT_SANDBOX_CONTAINER_PORT, DEFAULT_SANDBOX_KATA_HOME, shellQuote };
