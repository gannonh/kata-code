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
  type SandboxExecResult,
  type SandboxHandle,
  SandboxProviderError,
  type SandboxProvisionRequest,
  type SandboxReachability,
  type SandboxProvider,
  type SandboxProviderConfigDecoder,
} from "@kata-sh/code-sandbox/driver";
import type { SandboxProviderDescriptor } from "@kata-sh/code-sandbox/descriptor";

import { dockerRequest, type DockerResponse, DockerEngineError } from "./dockerEngine.ts";
import { DockerSandboxConfig, DEFAULT_DOCKER_CONFIG } from "./config.ts";

export const DOCKER_KIND = SandboxProviderDriverKind.make("docker");

// Hoist compiled schema functions to module scope (kata-code/no-inline-schema-compile).
const decodeDockerSandboxConfig = Schema.decodeUnknownSync(DockerSandboxConfig);

/** Decoded config the registry feeds the driver. */
export const dockerConfigDecoder: SandboxProviderConfigDecoder<DockerSandboxConfig> = (input) =>
  decodeDockerSandboxConfig(input);

export interface DockerSandboxHandleState {
  readonly containerId: string;
  readonly hostPort: number;
  readonly containerPort: number;
}

const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);
const HEALTHZ_PATH = "/healthz";

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

function waitForReady(hostPort: number): Effect.Effect<void, SandboxProviderError> {
  // Use 127.0.0.1 (not localhost) so the probe bypasses any localhost
  // proxy/IPv6 resolution quirks in the host process, and cap each probe at
  // 3s so a hung fetch cannot stall the whole readiness window.
  const healthUrl = `http://127.0.0.1:${hostPort}${HEALTHZ_PATH}`;
  const probe = Effect.tryPromise({
    try: () =>
      fetch(healthUrl, {
        signal: AbortSignal.timeout(3000),
      }),
    catch: () =>
      new SandboxProviderError({ reason: "unreachable", message: "healthz fetch failed" }),
  });
  return Effect.gen(function* () {
    // The real `katacode serve` image runs migrations + startup before
    // answering, so allow up to 60s (240 × 250ms) rather than the 15s that
    // sufficed for the lightweight node http stub.
    for (let i = 0; i < 240; i++) {
      const ok = yield* Effect.matchEffect(probe, {
        onFailure: () => Effect.succeed(false),
        onSuccess: (res) => Effect.succeed(res.status === 200),
      });
      if (ok) return;
      yield* Effect.sleep("250 millis");
    }
    return yield* new SandboxProviderError({
      reason: "timeout",
      message: `container never became ready on ${hostPort}`,
    });
  });
}

export const DockerSandboxProvider: SandboxProvider = {
  kind: DOCKER_KIND,

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
      const containerPort = `${resolved.port}/tcp`;
      // @effect-diagnostics-next-line effect(globalDateInEffect):off - unique container name; no Effect Clock in the driver.
      const name = `kata-sandbox-${req.instanceId}-${Date.now()}`;
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
        HostConfig: { PortBindings: { [containerPort]: [{ HostPort: "0" }] }, AutoRemove: true },
        ExposedPorts: { [containerPort]: {} },
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
      if (startRes.status >= 300) {
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
      const info = parseJson(inspect.body) as {
        State: {
          Status: string;
          ExitCode: number;
          Error: string;
        };
        NetworkSettings: {
          Ports: Record<string, ReadonlyArray<{ HostPort: string }> | undefined>;
        };
      };
      // A fast-failing command (e.g. missing binary) exits before we read the
      // port binding; surface the real exit code + logs instead of the
      // misleading "no published host port". AutoRemove may have already reaped
      // the container, in which case inspect returned 404 above.
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
      const binding = info.NetworkSettings.Ports[containerPort]?.[0];
      const hostPort = Number(binding?.HostPort);
      if (!Number.isFinite(hostPort) || hostPort === 0) {
        yield* bestEffortDispose(containerId);
        return yield* new SandboxProviderError({
          reason: "provision-failed",
          message: "no published host port",
        });
      }
      yield* waitForReady(hostPort).pipe(
        Effect.catch((error: SandboxProviderError) =>
          bestEffortDispose(containerId).pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
      const state: DockerSandboxHandleState = {
        containerId,
        hostPort,
        containerPort: resolved.port,
      };
      return {
        driverKind: DOCKER_KIND,
        instanceId: req.instanceId,
        handle: state,
      } satisfies SandboxHandle;
    }),

  exec: (handle, command) =>
    Effect.gen(function* () {
      const state = handle.handle as DockerSandboxHandleState;
      // @effect-diagnostics-next-line effect(preferSchemaOverJson):off - Docker Engine exec body, not a typed codec.
      const createExec = yield* engine(
        `/containers/${state.containerId}/exec`,
        {
          method: "POST",
          body: JSON.stringify({
            Cmd: ["sh", "-c", command],
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
      const startRes = yield* engine(
        `/exec/${execId}/start`,
        {
          method: "POST",
          body: JSON.stringify({ Detach: false, Tty: false }),
        },
        "exec-failed",
        "exec start",
      );
      if (startRes.status >= 300) {
        return yield* new SandboxProviderError({
          reason: "exec-failed",
          message: `exec start: ${startRes.status} ${startRes.body.slice(0, 200)}`,
        });
      }
      const exitRes = yield* engine(`/exec/${execId}/json`, {}, "exec-failed", "exec inspect");
      if (exitRes.status >= 300) {
        return yield* new SandboxProviderError({
          reason: "exec-failed",
          message: `exec inspect: ${exitRes.status} ${exitRes.body.slice(0, 200)}`,
        });
      }
      const exitCode = Number((parseJson(exitRes.body) as { ExitCode?: number }).ExitCode ?? 0);
      return { exitCode, stdout: startRes.body, stderr: "" } satisfies SandboxExecResult;
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
      baseImages: [DEFAULT_DOCKER_CONFIG.image],
    } satisfies SandboxProviderDescriptor),
};
