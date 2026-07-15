// @effect-diagnostics nodeBuiltinImport:off - raw Docker Engine HTTP API over the
// Unix socket via Node built-ins; no dockerode npm dependency (AC-1.7 spike).
// @effect-diagnostics globalFetchInEffect:off - raw loopback readiness probes; the driver is not an Effect HttpClient consumer.
// @effect-diagnostics globalDateInEffect:off - unique container naming; no Effect Clock in the driver.
// @effect-diagnostics preferSchemaOverJson:off - ad-hoc Docker Engine JSON bodies/responses, not typed codecs.
/**
 * `DockerSandboxProvider` — the local container driver implementing the frozen
 * `SandboxProvider` SPI against a Docker/OrbStack runtime over the raw Engine
 * HTTP API (no `dockerode`; AC-1.7 spike confirmed viability).
 *
 * Provision boots the configured `command` inside `image`, publishes the
 * in-container `port` to an ephemeral host port (`HostPort: 0`), waits for HTTP
 * readiness, and returns a handle. `reachability()` returns a loopback
 * `http://localhost:<host-port>`. The Kata WebSocket auth token
 * (`KATACODE_DESKTOP_BOOTSTRAP_TOKEN`) is passed as an env var, mirroring the
 * desktop `DesktopBackendBootstrap` model so the in-container `katacode serve`
 * is a Kata server like any other.
 *
 * @module DockerSandboxProvider
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import {
  type SandboxCopyIntoCapability,
  type SandboxExecResult,
  type SandboxHandle,
  type SandboxLifecycleCapability,
  type SandboxLifecycleStatus,
  SandboxProviderError,
  type SandboxProvisionRequest,
  type SandboxReachability,
  type SandboxProvider,
  type SandboxProviderConfigDecoder,
} from "@kata-sh/code-sandbox/driver";
import type { SandboxProviderDescriptor } from "@kata-sh/code-sandbox/descriptor";

import {
  dockerRequest,
  dockerRequestBuffer,
  type DockerResponse,
  type DockerBufferResponse,
  DockerEngineError,
} from "./dockerEngine.ts";
import { DockerSandboxConfig, DEFAULT_DOCKER_CONFIG } from "./config.ts";

export const DOCKER_KIND = SandboxProviderDriverKind.make("docker");

// Hoist compiled schema functions to module scope (kata-code/no-inline-schema-compile).
const decodeDockerSandboxConfig = Schema.decodeUnknownSync(DockerSandboxConfig);

/** Decoded config the registry feeds the driver. */
export const dockerConfigDecoder: SandboxProviderConfigDecoder<DockerSandboxConfig> = (input) =>
  decodeDockerSandboxConfig(input);

export interface DockerSandboxHandleState {
  readonly containerId: string;
  readonly containerName: string;
  readonly hostPort: number;
  readonly containerPort: number;
}

/** Deterministic container name for an instance (slug-safe; stable across restarts). */
export function dockerContainerName(instanceId: string): string {
  return `kata-sandbox-${instanceId}`;
}

/** Shape of the Docker Engine `GET /containers/{id}/json` response fields the
 *  driver reads (State + port bindings + labels). */
interface DockerContainerInspect {
  readonly Id: string;
  readonly Name: string;
  readonly State: {
    readonly Status: string;
    readonly ExitCode: number;
    readonly Error: string;
    readonly Running: boolean;
  };
  readonly Config: { readonly Labels: Record<string, string> | null };
  readonly NetworkSettings: {
    readonly Ports: Record<string, ReadonlyArray<{ readonly HostPort: string }> | undefined>;
  };
}

const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const HEALTHZ_PATH = "/healthz";

/**
 * Demultiplex a raw Docker Engine exec-start stream into `stdout`/`stderr`.
 * The hijacked stream is a sequence of frames: an 8-byte header (1 byte stream
 * type — 1=stdout, 2=stderr — 3 bytes padding, 4-byte big-endian payload
 * length) followed by that many payload bytes. Stops at the last complete
 * frame so a truncated tail is ignored defensively rather than crashing.
 */
function demultiplexExecStream(buffer: Buffer): {
  readonly stdout: string;
  readonly stderr: string;
} {
  let stdout = "";
  let stderr = "";
  let i = 0;
  while (i + 8 <= buffer.length) {
    const streamType = buffer[i];
    // bytes 1..3 are padding
    const payloadLength = buffer.readUInt32BE(i + 4);
    i += 8;
    if (i + payloadLength > buffer.length) break; // truncated final frame
    const chunk = buffer.subarray(i, i + payloadLength);
    i += payloadLength;
    if (streamType === 1) stdout += chunk.toString("utf8");
    else if (streamType === 2) stderr += chunk.toString("utf8");
  }
  return { stdout, stderr };
}

/** Wrap a raw binary engine request so its error channel is `SandboxProviderError`. */
function engineBuffer(
  path: string,
  init: {
    method?: string;
    body?: string;
    bodyBytes?: Uint8Array;
    contentType?: string;
    hijacked?: boolean;
  } = {},
  reason: SandboxProviderError["reason"] = "provision-failed",
  msg: string,
): Effect.Effect<DockerBufferResponse, SandboxProviderError> {
  return dockerRequestBuffer(path, init).pipe(
    Effect.mapError(
      (e: DockerEngineError) =>
        new SandboxProviderError({ reason, message: `${msg}: ${e.message}` }),
    ),
  );
}

/** Wrap a raw engine request so its error channel is `SandboxProviderError`. */
function engine(
  path: string,
  init: { method?: string; body?: string } = {},
  reason: SandboxProviderError["reason"] = "provision-failed",
  msg: string,
): Effect.Effect<DockerResponse, SandboxProviderError> {
  return dockerRequest(path, init).pipe(
    Effect.mapError(
      (e: DockerEngineError) =>
        new SandboxProviderError({ reason, message: `${msg}: ${e.message}` }),
    ),
  );
}

/** Best-effort forced removal of a container after a post-start provisioning
 * failure. `AutoRemove` only reaps the container when its process exits, so a
 * misconfigured long-running command would otherwise leak. Failures are logged
 * and swallowed so the original provisioning error reaches the caller. */
function bestEffortDispose(containerId: string): Effect.Effect<void, never> {
  return dockerRequest(`/containers/${containerId}?force=true`, { method: "DELETE" }).pipe(
    Effect.catch((cause: DockerEngineError) =>
      Effect.logWarning("Best-effort dispose after provisioning failure failed", {
        containerId,
        cause: cause.message,
      }),
    ),
    Effect.asVoid,
  );
}

/**
 * Resolve the docker runtime config (port, command, extraEnv) from the
 * decoded payload the registry already validated. `image` is intentionally
 * not resolved here: the SPI contract makes `req.image` the authoritative
 * base image (the service layer supplies it; a future Phase may supply an
 * image built from `.kata/environment.json`). Fails loudly on malformed
 * config rather than silently substituting defaults (AGENTS.md fail-loud).
 */
function resolveConfig(raw: unknown): DockerSandboxConfig {
  if (raw === undefined || raw === null) return { ...DEFAULT_DOCKER_CONFIG };
  return { ...DEFAULT_DOCKER_CONFIG, ...decodeDockerSandboxConfig(raw) };
}

function buildContainerEnv(
  config: DockerSandboxConfig,
  req: SandboxProvisionRequest,
): Array<{ readonly name: string; readonly value: string }> {
  const env: Array<{ readonly name: string; readonly value: string }> = [
    { name: "KATACODE_PORT", value: String(config.port) },
    { name: "KATACODE_HOST", value: "0.0.0.0" },
    { name: "KATACODE_MODE", value: "desktop" },
    { name: "KATACODE_NO_BROWSER", value: "true" },
  ];
  for (const [k, v] of req.env ?? []) env.push({ name: k, value: v });
  for (const e of config.extraEnv ?? []) env.push({ name: e.name, value: e.value });
  return env;
}

/** Inspect a container by name. Returns `null` on 404 (gone); surfaces other
 *  errors as `SandboxProviderError`. The response is the full Engine inspect
 *  JSON (`DockerContainerInspect`-shaped). */
function inspectContainer(
  name: string,
  reason: SandboxProviderError["reason"],
  msg: string,
): Effect.Effect<DockerContainerInspect | null, SandboxProviderError> {
  return Effect.gen(function* () {
    const res = yield* dockerRequest(`/containers/${encodeURIComponent(name)}/json`).pipe(
      Effect.mapError(
        (e: DockerEngineError) =>
          new SandboxProviderError({ reason, message: `${msg}: ${e.message}` }),
      ),
    );
    if (res.status === 404) return null;
    if (res.status >= 400) {
      return yield* new SandboxProviderError({
        reason,
        message: `${msg}: inspect ${res.status}: ${res.body.slice(0, 200)}`,
      });
    }
    return parseJson(res.body) as DockerContainerInspect;
  });
}

/** Read the published host port for a container port from an inspect response. */
function readHostPort(info: DockerContainerInspect, containerPort: number): number {
  const binding = info.NetworkSettings.Ports[`${containerPort}/tcp`]?.[0];
  const hostPort = Number(binding?.HostPort);
  return Number.isFinite(hostPort) ? hostPort : 0;
}

/** Build a handle from an inspect response (re-reads the host port so a
 *  re-adopted or started container reports its current binding). */
function handleFromInspect(
  info: DockerContainerInspect,
  instanceId: string,
  containerPort: number,
): SandboxHandle {
  return {
    driverKind: DOCKER_KIND,
    instanceId,
    handle: {
      containerId: info.Id,
      containerName: info.Name.startsWith("/") ? info.Name.slice(1) : info.Name,
      hostPort: readHostPort(info, containerPort),
      containerPort,
    } satisfies DockerSandboxHandleState,
  };
}

/** Verify an inspected container is one we own (carries our instance label).
 *  Fails loud on a name collision with a foreign container lacking the label. */
function assertOwnedContainer(
  info: DockerContainerInspect,
  instanceId: string,
): Effect.Effect<void, SandboxProviderError> {
  const label = info.Config.Labels?.["kata.sandbox.instance"];
  if (label !== instanceId) {
    return Effect.fail(
      new SandboxProviderError({
        reason: "provision-failed",
        message: `Container name is already in use by a container not owned by this sandbox instance (label mismatch: expected ${instanceId}, found ${label ?? "absent"}).`,
      }),
    );
  }
  return Effect.void;
}

export interface DockerSandboxProviderOptions {
  /** Optional override for the loopback healthz probe (tests inject a synchronous 200). */
  readonly healthzProbe?: (hostPort: number) => Effect.Effect<boolean, SandboxProviderError>;
}

/** Default loopback healthz probe against `http://127.0.0.1:<port>/healthz`. */
function defaultHealthzProbe(hostPort: number): Effect.Effect<boolean, SandboxProviderError> {
  const healthUrl = `http://127.0.0.1:${hostPort}${HEALTHZ_PATH}`;
  return Effect.tryPromise({
    try: () => fetch(healthUrl, { signal: AbortSignal.timeout(3000) }),
    catch: () =>
      new SandboxProviderError({ reason: "unreachable", message: "healthz fetch failed" }),
  }).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.succeed(false),
      onSuccess: (res) => Effect.succeed(res.status === 200),
    }),
  );
}

function waitForReady(
  hostPort: number,
  probe: (port: number) => Effect.Effect<boolean, SandboxProviderError>,
): Effect.Effect<void, SandboxProviderError> {
  return Effect.gen(function* () {
    // The real `katacode serve` image runs migrations + startup before
    // answering, so allow up to 60s (240 × 250ms) rather than the 15s that
    // sufficed for the lightweight node http stub.
    for (let i = 0; i < 240; i++) {
      const ok = yield* probe(hostPort);
      if (ok) return;
      yield* Effect.sleep("250 millis");
    }
    return yield* new SandboxProviderError({
      reason: "timeout",
      message: `container never became ready on ${hostPort}`,
    });
  });
}

export function isTransientRecursiveChownRace(result: {
  readonly exitCode: number;
  readonly stderr: string;
}): boolean {
  const errors = result.stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    result.exitCode !== 0 &&
    errors.length > 0 &&
    errors.every((line) => line.includes("No such file or directory"))
  );
}

export function makeDockerSandboxProvider(
  options: DockerSandboxProviderOptions = {},
): SandboxProvider {
  const healthzProbe = options.healthzProbe ?? defaultHealthzProbe;
  const waitForReadyFor = (hostPort: number) => waitForReady(hostPort, healthzProbe);
  const provider: SandboxProvider = {
    kind: DOCKER_KIND,

    /**
     * Phase 2 seeding capability: upload a host-built tar archive into a running
     * container at `destPath`. The destination is created first (`mkdir -p` via
     * exec) because `PUT /containers/{id}/archive` fails on a missing path.
     * Implemented via the Docker Engine `PUT /containers/{id}/archive` endpoint
     * with a binary tar body (`Content-Type: application/x-tar`).
     */
    copyInto: {
      copyInto: (handle, archive, destPath) =>
        Effect.gen(function* () {
          const state = handle.handle as DockerSandboxHandleState;
          // Ensure the destination directory exists before uploading; the
          // `archive` PUT does not create intermediate directories.
          const mkdir = yield* provider.exec(handle, `mkdir -p ${destPath}`);
          if (mkdir.exitCode !== 0) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: `copyInto: mkdir -p ${destPath} failed (exit ${mkdir.exitCode}): ${mkdir.stderr}`,
            });
          }
          const put = yield* dockerRequest(
            `/containers/${state.containerId}/archive?path=${encodeURIComponent(destPath)}`,
            { method: "PUT", bodyBytes: archive, contentType: "application/x-tar" },
          ).pipe(
            Effect.mapError(
              (e: DockerEngineError) =>
                new SandboxProviderError({
                  reason: "provision-failed",
                  message: `copyInto: ${e.message}`,
                }),
            ),
          );
          // Docker returns 204 (No Content) on a successful archive upload.
          if (put.status >= 300) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: `copyInto: archive upload ${put.status}: ${put.body.slice(0, 200)}`,
            });
          }
          // Ensure all extracted files and intermediate directories are
          // katacode-owned — Docker creates parent dirs as root when directory
          // entries are absent from the tar (see ustarWriter).
          const chownCommand = `chown -R 100:101 '${destPath}'`;
          let chown = yield* provider.exec(handle, chownCommand, { user: "root" });
          // Credential tools create and remove lock files while the server is
          // running. Retry the same ownership pass once when a lock disappears
          // during recursive traversal; every surviving file is revisited.
          if (isTransientRecursiveChownRace(chown)) {
            chown = yield* provider.exec(handle, chownCommand, { user: "root" });
          }
          if (chown.exitCode !== 0) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: `copyInto: chown ${destPath} failed (exit ${chown.exitCode}): ${chown.stderr}`,
            });
          }
        }),
    } satisfies SandboxCopyIntoCapability,

    /**
     * Durable lifecycle capability: stop/start/status a named container without
     * destroying it. The container filesystem persists across stop/start by
     * Docker semantics. `stop` uses a 10s grace period; `start` re-runs the
     * healthz wait against the published loopback port. The published host port
     * can change only on create, not on stop/start, so the endpoint stays stable
     * for a container's lifetime; `start` re-reads it from inspect anyway.
     */
    lifecycle: {
      stop: (handle) =>
        Effect.gen(function* () {
          const state = handle.handle as DockerSandboxHandleState;
          const res = yield* engine(
            `/containers/${state.containerId}/stop?t=10`,
            { method: "POST" },
            "provision-failed",
            "stop failed",
          );
          // 304 = already stopped; 404 = gone (treat as idempotent success per
          // the SPI contract: stop on a gone sandbox is a no-op).
          if (res.status >= 300 && res.status !== 304 && res.status !== 404) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: `stop failed: ${res.status} ${res.body.slice(0, 200)}`,
            });
          }
        }),

      start: (handle) =>
        Effect.gen(function* () {
          const state = handle.handle as DockerSandboxHandleState;
          const res = yield* engine(
            `/containers/${state.containerId}/start`,
            { method: "POST" },
            "provision-failed",
            "start failed",
          );
          // 304 = already running (idempotent success); re-verify healthz.
          if (res.status >= 300 && res.status !== 304) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: `start failed: ${res.status} ${res.body.slice(0, 200)}`,
            });
          }
          const info = yield* inspectContainer(
            state.containerName,
            "provision-failed",
            "start re-inspect",
          );
          if (info === null) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: "Sandbox container is gone; create a new sandbox to re-seed the workspace.",
            });
          }
          const hostPort = readHostPort(info, state.containerPort);
          if (hostPort === 0) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: "no published host port after start",
            });
          }
          yield* waitForReadyFor(hostPort);
          return handleFromInspect(info, handle.instanceId, state.containerPort);
        }),

      status: (handle): Effect.Effect<SandboxLifecycleStatus, SandboxProviderError> =>
        Effect.gen(function* () {
          const state = handle.handle as DockerSandboxHandleState;
          const info = yield* inspectContainer(state.containerName, "unreachable", "status");
          if (info === null) return "gone";
          return info.State.Running ? "running" : "stopped";
        }),

      discover: (
        req,
      ): Effect.Effect<
        { readonly handle: SandboxHandle; readonly status: SandboxLifecycleStatus } | null,
        SandboxProviderError
      > =>
        Effect.gen(function* () {
          // List containers by the instance label so both the new deterministic
          // name and any legacy timestamped containers are discovered.
          const filters = encodeURIComponent(
            JSON.stringify({ label: [`kata.sandbox.instance=${req.instanceId}`] }),
          );
          const res = yield* dockerRequest(`/containers/json?all=true&filters=${filters}`).pipe(
            Effect.mapError(
              (e: DockerEngineError) =>
                new SandboxProviderError({
                  reason: "unreachable",
                  message: `discover: ${e.message}`,
                }),
            ),
          );
          if (res.status >= 400) {
            return yield* new SandboxProviderError({
              reason: "unreachable",
              message: `discover: list ${res.status}: ${res.body.slice(0, 200)}`,
            });
          }
          const list = parseJson(res.body) as ReadonlyArray<{
            readonly Id: string;
            readonly Names: ReadonlyArray<string>;
            readonly State: string;
            readonly Created: number;
            readonly Ports?: ReadonlyArray<{
              readonly PrivatePort: number;
              readonly PublicPort?: number;
            }>;
          }>;
          if (list.length === 0) return null;
          // Most recent first.
          const found = [...list].sort((a, b) => (b.Created ?? 0) - (a.Created ?? 0))[0];
          if (found === undefined) return null;
          const containerName = found.Names[0]?.startsWith("/")
            ? found.Names[0].slice(1)
            : (found.Names[0] ?? dockerContainerName(req.instanceId));
          // Inspect to read the authoritative state + port binding.
          const info = yield* inspectContainer(containerName, "unreachable", "discover");
          if (info === null) return null;
          const resolved = resolveConfig(req.config);
          const status: SandboxLifecycleStatus = info.State.Running ? "running" : "stopped";
          return {
            handle: handleFromInspect(info, req.instanceId, resolved.port),
            status,
          };
        }),
    } satisfies SandboxLifecycleCapability,

    validate: (config) =>
      Effect.gen(function* () {
        const resolved = resolveConfig(config);
        // `validate` has no provisioning `req.image` to draw from; the registry
        // guarantees `config` is already decoded, so `resolved.image` is the
        // configured image (or the default when the envelope omits one).
        const image = resolved.image;
        const ping = yield* engine("/_ping", {}, "unreachable", "Docker daemon unreachable");
        if (ping.status !== 200) {
          return yield* new SandboxProviderError({
            reason: "unreachable",
            message: `Docker _ping returned ${ping.status}`,
          });
        }
        const img = yield* engine(
          `/images/${encodeURIComponent(image)}/json`,
          {},
          "unreachable",
          "image inspect",
        );
        if (img.status === 404) {
          const pull = yield* engine(
            `/images/create?fromImage=${encodeURIComponent(image)}`,
            { method: "POST" },
            "unreachable",
            "image pull",
          );
          if (pull.status >= 300) {
            return yield* new SandboxProviderError({
              reason: "unreachable",
              message: `image pull ${pull.status}: ${pull.body.slice(0, 200)}`,
            });
          }
        } else if (img.status >= 300) {
          return yield* new SandboxProviderError({
            reason: "unreachable",
            message: `image inspect ${img.status}: ${img.body.slice(0, 200)}`,
          });
        }
      }),

    provision: (req) =>
      Effect.gen(function* () {
        const resolved = resolveConfig(req.config);
        // The service layer supplies the authoritative base image (the SPI
        // contract for `SandboxProvisionRequest.image`); fall back to the
        // configured/default image only when the caller omits it (e.g. the
        // registry's own validate path does not pass one).
        const image = req.image ?? resolved.image;
        const containerPort = resolved.port;
        const name = dockerContainerName(req.instanceId);

        // Idempotent adopt: a container with this name may already exist from a
        // previous provision or a server restart. Running -> reuse it; stopped ->
        // start it; missing -> create+start below. This makes provision safe to
        // retry and lets the session store reclaim a container after a restart.
        const existing = yield* inspectContainer(name, "provision-failed", "provision adopt");
        if (existing !== null) {
          yield* assertOwnedContainer(existing, req.instanceId);
          if (existing.State.Running) {
            // Already running: restart so the in-container server re-boots and
            // re-seeds its one-time bootstrap grant. A long-running adopted
            // container has already consumed its grant during a previous
            // registration, so adopting it without a restart makes the
            // follow-up Connect registration fail `invalid_credential`.
            // Provision only runs when no session record exists, so nothing is
            // using the container.
            const restartRes = yield* engine(
              `/containers/${existing.Id}/restart?t=10`,
              { method: "POST" },
              "provision-failed",
              "restart failed",
            );
            if (restartRes.status >= 300) {
              return yield* new SandboxProviderError({
                reason: "provision-failed",
                message: `restart failed: ${restartRes.status}`,
              });
            }
            const restartedInfo = yield* inspectContainer(
              name,
              "provision-failed",
              "provision restart re-inspect",
            );
            if (restartedInfo === null) {
              return yield* new SandboxProviderError({
                reason: "provision-failed",
                message: "container vanished after restart",
              });
            }
            yield* waitForReadyFor(readHostPort(restartedInfo, containerPort));
            return handleFromInspect(restartedInfo, req.instanceId, containerPort);
          }
          // Stopped: start it and re-read the port binding (the published host
          // port is stable for a container's lifetime but re-read defensively).
          const startRes = yield* engine(
            `/containers/${existing.Id}/start`,
            { method: "POST" },
            "provision-failed",
            "start failed",
          );
          if (startRes.status >= 300 && startRes.status !== 304) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: `start failed: ${startRes.status}`,
            });
          }
          const restarted = yield* inspectContainer(
            name,
            "provision-failed",
            "provision re-inspect",
          );
          if (restarted === null) {
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: "container vanished after start",
            });
          }
          const hostPort = readHostPort(restarted, containerPort);
          yield* waitForReadyFor(hostPort);
          return handleFromInspect(restarted, req.instanceId, containerPort);
        }

        // Missing: create + start a new named container.
        const containerPortSpec = `${containerPort}/tcp`;
        const env = buildContainerEnv(resolved, req);
        // @effect-diagnostics-next-line effect(preferSchemaOverJson):off - ad-hoc Docker Engine create body, not a typed codec.
        const createBody = JSON.stringify({
          Image: image,
          // Override any image ENTRYPOINT so `Cmd: ["sh", "-c", command]` runs the
          // shell command directly (the katacode image's entrypoint is
          // `node bin.mjs`; without this, `sh -c ...` would be appended to it).
          Entrypoint: [],
          Cmd: ["sh", "-c", resolved.command],
          Env: env.map((e) => `${e.name}=${e.value}`),
          // No AutoRemove: the durable lifecycle stops the container without
          // destroying it, so it must persist across stop/start. Dispose uses a
          // force delete. A fast-failing command exits and is detected below.
          HostConfig: {
            PortBindings: { [containerPortSpec]: [{ HostPort: "0" }] },
          },
          ExposedPorts: { [containerPortSpec]: {} },
          Labels: { "kata.sandbox": "true", "kata.sandbox.instance": req.instanceId },
        });
        const created = yield* engine(
          `/containers/create?name=${name}`,
          {
            method: "POST",
            body: createBody,
          },
          "provision-failed",
          "create failed",
        );
        if (created.status >= 300) {
          return yield* new SandboxProviderError({
            reason: "provision-failed",
            message: `create failed: ${created.status} ${created.body.slice(0, 200)}`,
          });
        }
        const containerId = (parseJson(created.body) as { Id: string }).Id;
        const startRes = yield* engine(
          `/containers/${containerId}/start`,
          { method: "POST" },
          "provision-failed",
          "start failed",
        );
        if (startRes.status >= 300 && startRes.status !== 304) {
          yield* bestEffortDispose(containerId);
          return yield* new SandboxProviderError({
            reason: "provision-failed",
            message: `start failed: ${startRes.status}`,
          });
        }
        const inspect = yield* engine(
          `/containers/${containerId}/json`,
          {},
          "provision-failed",
          "inspect",
        );
        if (inspect.status >= 400) {
          yield* bestEffortDispose(containerId);
          return yield* new SandboxProviderError({
            reason: "provision-failed",
            message: `container inspect ${inspect.status}: ${inspect.body.slice(0, 200)}`,
          });
        }
        const info = parseJson(inspect.body) as DockerContainerInspect;
        // A fast-failing command (e.g. missing binary) exits before we read the
        // port binding; surface the real exit code + logs instead of the
        // misleading "no published host port".
        if (info.State.Status === "exited") {
          const logs = yield* engine(
            `/containers/${containerId}/logs?stdout=true&stderr=true`,
            {},
            "provision-failed",
            "logs",
          );
          yield* bestEffortDispose(containerId);
          const tail = logs.body.slice(-512).trim();
          return yield* new SandboxProviderError({
            reason: "provision-failed",
            message: `container exited (code ${info.State.ExitCode})${tail ? `: ${tail}` : ""}`,
          });
        }
        const hostPort = readHostPort(info, containerPort);
        if (hostPort === 0) {
          yield* bestEffortDispose(containerId);
          return yield* new SandboxProviderError({
            reason: "provision-failed",
            message: "no published host port",
          });
        }
        yield* waitForReadyFor(hostPort).pipe(
          Effect.catch((error: SandboxProviderError) =>
            bestEffortDispose(containerId).pipe(Effect.andThen(Effect.fail(error))),
          ),
        );
        const state: DockerSandboxHandleState = {
          containerId,
          containerName: name,
          hostPort,
          containerPort,
        };
        return {
          driverKind: DOCKER_KIND,
          instanceId: req.instanceId,
          handle: state,
        } satisfies SandboxHandle;
      }),

    exec: (handle, command, opts) =>
      Effect.gen(function* () {
        const state = handle.handle as DockerSandboxHandleState;
        // @effect-diagnostics-next-line effect(preferSchemaOverJson):off - Docker Engine exec body, not a typed codec.
        const createExec = yield* engine(
          `/containers/${state.containerId}/exec`,
          {
            method: "POST",
            body: JSON.stringify({
              Cmd: ["sh", "-c", command],
              // Phase 2: honor `opts.cwd` so `install` runs in `/workspace`. The
              // spike verified the Engine API honors `WorkingDir` for exec.
              ...(opts?.cwd !== undefined ? { WorkingDir: opts.cwd } : {}),
              ...(opts?.user !== undefined ? { User: opts.user } : {}),
              AttachStdout: true,
              AttachStderr: true,
            }),
          },
          "exec-failed",
          "exec create",
        );
        if (createExec.status >= 300) {
          return yield* new SandboxProviderError({
            reason: "exec-failed",
            message: `exec create: ${createExec.status}`,
          });
        }
        const execId = (parseJson(createExec.body) as { Id: string }).Id;
        // @effect-diagnostics-next-line effect(preferSchemaOverJson):off - Docker Engine exec start body.
        // Read the start response as a raw buffer so the multiplexed stream can
        // be demultiplexed into clean stdout/stderr (Phase 2 demux fix). The
        // previous implementation returned the raw framed bytes as `stdout` and
        // always-empty `stderr`.
        const startRes = yield* engineBuffer(
          `/exec/${execId}/start`,
          {
            method: "POST",
            body: JSON.stringify({ Detach: false, Tty: false }),
            hijacked: true,
          },
          "exec-failed",
          "exec start",
        );
        if (startRes.status >= 300) {
          return yield* new SandboxProviderError({
            reason: "exec-failed",
            message: `exec start: ${startRes.status}`,
          });
        }
        const { stdout, stderr } = demultiplexExecStream(startRes.body);
        const exitRes = yield* engine(`/exec/${execId}/json`, {}, "exec-failed", "exec inspect");
        if (exitRes.status >= 300) {
          return yield* new SandboxProviderError({
            reason: "exec-failed",
            message: `exec inspect: ${exitRes.status} ${exitRes.body.slice(0, 200)}`,
          });
        }
        const exitCode = Number((parseJson(exitRes.body) as { ExitCode?: number }).ExitCode ?? 0);
        return { exitCode, stdout, stderr } satisfies SandboxExecResult;
      }),

    reachability: (handle) => {
      const state = handle.handle as DockerSandboxHandleState;
      return Effect.succeed({
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        httpBaseUrl: `http://localhost:${state.hostPort}`,
        wsBaseUrl: `ws://localhost:${state.hostPort}`,
      } satisfies SandboxReachability);
    },

    dispose: (handle) =>
      Effect.gen(function* () {
        const state = handle.handle as DockerSandboxHandleState;
        const res: DockerResponse | null = yield* Effect.matchEffect(
          dockerRequest(`/containers/${state.containerId}?force=true`, { method: "DELETE" }),
          {
            onFailure: (cause) =>
              // Log the daemon error so operators can see health issues; the
              // container is most likely already gone (AutoRemove), so dispose
              // still succeeds rather than surfacing a stale-not-found.
              Effect.logWarning("Docker dispose daemon error; container may be orphaned", {
                containerId: state.containerId,
                cause,
              }).pipe(Effect.as<DockerResponse | null>(null)),
            onSuccess: (r) => Effect.succeed<DockerResponse | null>(r),
          },
        );
        if (res === null) return;
        if (res.status >= 400 && res.status !== 404) {
          return yield* new SandboxProviderError({
            reason: "dispose-failed",
            message: `dispose ${res.status}: ${res.body.slice(0, 200)}`,
          });
        }
      }),

    describe: () =>
      Effect.succeed({
        kind: DOCKER_KIND,
        reachabilityKind: SandboxReachabilityKind.make("loopback"),
        supportsSnapshot: false,
        supportsRenewTimeout: false,
        supportsCopyInto: true,
        supportsLifecycle: true,
        baseImages: [DEFAULT_DOCKER_CONFIG.image],
      } satisfies SandboxProviderDescriptor),
  };
  return provider;
}

/**
 * The live Docker sandbox provider. Registered with the
 * `SandboxProviderRegistry` by the server layer.
 */
export const DockerSandboxProvider: SandboxProvider = makeDockerSandboxProvider();
