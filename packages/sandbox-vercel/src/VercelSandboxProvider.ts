// @effect-diagnostics nodeBuiltinImport:off - the driver uses node:crypto for random temp paths and node:buffer for tar seeding; no node:http.
// @effect-diagnostics globalFetchInEffect:off - raw public-healthz readiness probes against the sandbox domain; the driver is not an Effect HttpClient consumer.
// @effect-diagnostics globalDateInEffect:off - deadline arithmetic is host-side (keepalive owns it); the driver only reads Date for temp-path uniqueness.
/**
 * `VercelSandboxProvider` — the first cloud sandbox driver, implementing the
 * frozen `SandboxProvider` SPI against Vercel Sandbox (Firecracker microVMs)
 * via `@vercel/sandbox`.
 *
 * Provision creates a sandbox from a configured runtime or snapshot, runs the
 * bootstrap script (runtime only; snapshots already have the CLIs), launches
 * `katacode serve` detached, and polls the public `/healthz` until ready.
 * Reachability returns the public `https://<sandbox.domain(port)>` URL.
 * Lifecycle: `renewTimeout` forwards to `sb.extendTimeout`, `snapshot` stops
 * the VM (caller treats the session as lapsed), `resume` reattaches via
 * `Sandbox.get({ resume: true })` and restarts serve, `copyInto` writes a tar
 * and extracts it, `dispose` deletes the sandbox.
 *
 * Handle state is plain serializable data (no live SDK object); every method
 * re-fetches the instance with `sdk.get` when it needs one.
 *
 * Limitation: `snapshot.deleteSnapshot`/`snapshotExists` take no handle, so
 * per-instance auth is unavailable. V1 captures the auth from the most recent
 * successful `validate`/`provision` in the provider closure and fails with
 * `invalid-config` ("validate the target first") when absent. Documented in
 * the plan; a future auth-resolver SPI removes this limitation.
 *
 * @module VercelSandboxProvider
 */
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import {
  type SandboxCopyIntoCapability,
  type SandboxExecResult,
  type SandboxHandle,
  type SandboxProvisionRequest,
  type SandboxReachability,
  type SandboxResumeCapability,
  type SandboxRenewTimeoutCapability,
  type SandboxSnapshotCapability,
  type SandboxProvider,
  type SandboxProviderConfigDecoder,
  SandboxProviderError,
} from "@kata-sh/code-sandbox/driver";
import type { SandboxProviderDescriptor } from "@kata-sh/code-sandbox/descriptor";

import { DEFAULT_VERCEL_CONFIG, VercelSandboxConfig, VERCEL_AUTH_ENV_VARS } from "./config.ts";
import type { VercelAuthParams, VercelSdk } from "./sdk.ts";
import { isAuthError, isNotFound, liveVercelSdk } from "./sdk.ts";
import { buildBootstrapScript, buildServeCommand, SANDBOX_HOME } from "./bootstrap.ts";

export const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");

// Hoist compiled schema function to module scope (kata-code/no-inline-schema-compile).
const decodeVercelSandboxConfig = Schema.decodeUnknownSync(VercelSandboxConfig);

/** Decoded config the registry feeds the driver. */
export const vercelConfigDecoder: SandboxProviderConfigDecoder<VercelSandboxConfig> = (input) =>
  decodeVercelSandboxConfig(input);

/** Vercel max session lifetime on Pro/Enterprise (Hobby is 45m). */
const VERCEL_MAX_LIFETIME_MS = 86_400_000;
/** Healthz probe interval and budget. */
const HEALTHZ_INTERVAL_MS = 500;
const HEALTHZ_MAX_ATTEMPTS = 240; // 120s
const HEALTHZ_PROBE_TIMEOUT_MS = 3000;

/** The env vars the Kata server always needs, mirrored from the Docker driver. */
const KATA_SERVER_ENV: ReadonlyArray<readonly [string, string]> = [
  ["KATACODE_HOST", "0.0.0.0"],
  ["KATACODE_MODE", "desktop"],
  ["KATACODE_NO_BROWSER", "true"],
];

export interface VercelSandboxHandleState {
  readonly sandboxId: string;
  readonly port: number;
  /** `sandbox.domain(port)` captured at provision for reachability without a re-fetch. */
  readonly domainBase: string;
  readonly timeoutMs: number;
  readonly auth: VercelAuthParams;
  /** Snapshot id the sandbox was booted from, when `sourceType === "snapshot"`. */
  readonly bootedFromSnapshotId?: string;
}

// ── Error mapping ─────────────────────────────────────────────────────

function mapSdkError(
  context: string,
  error: unknown,
  fallback: SandboxProviderError["reason"] = "unknown",
): SandboxProviderError {
  const message = error instanceof Error ? error.message : String(error);
  if (isAuthError(error)) {
    return new SandboxProviderError({
      reason: "invalid-config",
      message: `${context}: Vercel rejected the token/team/project (${message}).`,
    });
  }
  if (isNotFound(error)) {
    return new SandboxProviderError({
      reason: "invalid-config",
      message: `${context}: not found (${message}).`,
    });
  }
  return new SandboxProviderError({ reason: fallback, message: `${context}: ${message}` });
}

/** Wrap a promise from the SDK so its error channel is `SandboxProviderError`. */
function trySdk<A>(
  context: string,
  run: () => Promise<A>,
  fallback: SandboxProviderError["reason"] = "unknown",
): Effect.Effect<A, SandboxProviderError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => mapSdkError(context, cause, fallback),
  });
}

// ── Config resolution ─────────────────────────────────────────────────

function resolveAuth(config: VercelSandboxConfig): VercelAuthParams | undefined {
  return config.auth;
}

/** Env passed into `Sandbox.create` — excludes the auth trio and adds KATA_* server env. */
function buildCreateEnv(req: SandboxProvisionRequest): Record<string, string> {
  const env: Record<string, string> = {};
  const excluded = new Set<string>(VERCEL_AUTH_ENV_VARS);
  for (const [k, v] of req.env ?? []) {
    if (excluded.has(k)) continue;
    env[k] = v;
  }
  for (const [k, v] of KATA_SERVER_ENV) env[k] = v;
  return env;
}

/** Env inlined at `katacode serve` launch — excludes the auth trio, adds KATA_* server env. */
function buildServeEnv(req: {
  readonly env?: ReadonlyArray<readonly [string, string]>;
}): ReadonlyArray<readonly [string, string]> {
  const excluded = new Set<string>(VERCEL_AUTH_ENV_VARS);
  const env: Array<readonly [string, string]> = [];
  for (const [k, v] of req.env ?? []) {
    if (excluded.has(k)) continue;
    env.push([k, v]);
  }
  for (const [k, v] of KATA_SERVER_ENV) env.push([k, v]);
  return env;
}

// ── Healthz polling ───────────────────────────────────────────────────

/** Optional override for the public-healthz probe (tests inject a synchronous 200). */
export interface VercelSandboxProviderOptions {
  readonly healthzProbe?: (httpBaseUrl: string) => Effect.Effect<boolean, SandboxProviderError>;
}

/** Default public-healthz probe against `sandbox.domain(port)`. */
function defaultHealthzProbe(httpBaseUrl: string): Effect.Effect<boolean, SandboxProviderError> {
  const healthUrl = `${httpBaseUrl}/healthz`;
  return Effect.tryPromise({
    try: () => fetch(healthUrl, { signal: AbortSignal.timeout(HEALTHZ_PROBE_TIMEOUT_MS) }),
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
  httpBaseUrl: string,
  probe: (url: string) => Effect.Effect<boolean, SandboxProviderError>,
): Effect.Effect<void, SandboxProviderError> {
  return Effect.gen(function* () {
    for (let i = 0; i < HEALTHZ_MAX_ATTEMPTS; i++) {
      const ok = yield* probe(httpBaseUrl);
      if (ok) return;
      yield* Effect.sleep(`${HEALTHZ_INTERVAL_MS} millis`);
    }
    return yield* new SandboxProviderError({
      reason: "timeout",
      message: `sandbox never became ready on ${httpBaseUrl}`,
    });
  });
}

// ── Provider factory ──────────────────────────────────────────────────

/**
 * Build a Vercel sandbox provider bound to an SDK. The provider captures the
 * auth from the most recent successful `validate`/`provision` so the
 * handle-less `snapshot.deleteSnapshot`/`snapshotExists` methods can reach the
 * Vercel API. See the module header for the documented limitation.
 */
export function makeVercelSandboxProvider(
  sdk: VercelSdk,
  options: VercelSandboxProviderOptions = {},
): SandboxProvider {
  const healthzProbe = options.healthzProbe ?? defaultHealthzProbe;
  const waitForReadyFor = (httpBaseUrl: string) => waitForReady(httpBaseUrl, healthzProbe);
  // Last-used auth captured at validate/provision time. Mutated by those
  // methods only; read by handle-less snapshot methods.
  let lastAuth: VercelAuthParams | undefined;

  const requireLastAuth = (): Effect.Effect<VercelAuthParams, SandboxProviderError> =>
    lastAuth !== undefined
      ? Effect.succeed(lastAuth)
      : Effect.fail(
          new SandboxProviderError({
            reason: "invalid-config",
            message: "Validate the Vercel deployment target before managing snapshots.",
          }),
        );

  const snapshot: SandboxSnapshotCapability = {
    /**
     * Capture a snapshot. **This stops the sandbox VM** (Vercel snapshots stop
     * the source session); the caller treats the session as lapsed and uses
     * `resume` to continue, or boots a new sandbox from the snapshot id.
     */
    createSnapshot: (handle, options) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        const sb = yield* trySdk(
          "snapshot.createSnapshot",
          () => sdk.get({ sandboxId: state.sandboxId, ...state.auth }),
          "unknown",
        );
        const snap = yield* trySdk(
          "snapshot.createSnapshot",
          () => sb.snapshot({ expiration: 0 }),
          "unknown",
        );
        return { snapshotId: snap.snapshotId };
      }),
    deleteSnapshot: (snapshotId) =>
      Effect.gen(function* () {
        const auth = yield* requireLastAuth();
        const snap = yield* trySdk(
          "snapshot.deleteSnapshot",
          () => sdk.getSnapshot({ snapshotId, ...auth }),
          "unknown",
        );
        if (snap === null) return; // already gone — succeed
        yield* trySdk("snapshot.deleteSnapshot", () => snap.delete(), "unknown");
      }),
    snapshotExists: (snapshotId) =>
      Effect.gen(function* () {
        const auth = yield* requireLastAuth();
        const snap = yield* trySdk(
          "snapshotExists",
          () => sdk.getSnapshot({ snapshotId, ...auth }),
          "unknown",
        );
        return snap !== null && snap.status === "created";
      }),
  };

  const renewTimeout: SandboxRenewTimeoutCapability = {
    renewTimeout: (handle, extendMs) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        const sb = yield* trySdk(
          "renewTimeout",
          () => sdk.get({ sandboxId: state.sandboxId, ...state.auth }),
          "unknown",
        );
        yield* trySdk("renewTimeout", () => sb.extendTimeout(extendMs), "unknown");
      }),
  };

  const copyInto: SandboxCopyIntoCapability = {
    copyInto: (handle, archive, destPath) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        const sb = yield* trySdk(
          "copyInto",
          () => sdk.get({ sandboxId: state.sandboxId, ...state.auth }),
          "unknown",
        );
        // @effect-diagnostics-next-line effect(globalDateInEffect):off - random temp path; no Effect Clock in the driver.
        const tmpPath = `/tmp/kata-seed-${Date.now().toString(36)}-${NodeCrypto.randomBytes(4).toString("hex")}.tar`;
        yield* trySdk(
          "copyInto.writeFiles",
          () => sb.writeFiles([{ path: tmpPath, content: Buffer.from(archive) }]),
          "provision-failed",
        );
        const extract = yield* provider.exec(
          handle,
          `mkdir -p '${destPath}' && tar -xf '${tmpPath}' -C '${destPath}' && rm -f '${tmpPath}'`,
        );
        if (extract.exitCode !== 0) {
          return yield* new SandboxProviderError({
            reason: "provision-failed",
            message: `copyInto: extract failed (exit ${extract.exitCode}): ${extract.stderr}`,
          });
        }
      }),
  };

  const resume: SandboxResumeCapability = {
    resume: (handle, req) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        const sb = yield* trySdk(
          "resume",
          () => sdk.get({ sandboxId: state.sandboxId, resume: true, ...state.auth }),
          "provision-failed",
        ).pipe(
          Effect.mapError((error: SandboxProviderError) =>
            isNotFound(error.cause ?? error)
              ? new SandboxProviderError({
                  reason: "provision-failed",
                  message: "Sandbox is gone; recreate from its snapshot or start a new session.",
                  cause: error,
                })
              : error,
          ),
        );
        // Relaunch serve detached with the new env.
        const serveCmd = buildServeCommand({ port: state.port, env: buildServeEnv(req) });
        yield* trySdk(
          "resume.serve",
          () => sb.runCommand({ cmd: "sh", args: ["-c", serveCmd], detached: true }),
          "exec-failed",
        );
        yield* waitForReadyFor(`https://${new URL(sb.domain(state.port)).host}`);
        return handle;
      }),
  };

  const provider: SandboxProvider = {
    kind: VERCEL_KIND,

    validate: (config) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.try({
          try: () => decodeVercelSandboxConfig(config),
          catch: (e) =>
            new SandboxProviderError({
              reason: "invalid-config",
              message: e instanceof Error ? e.message : String(e),
            }),
        });
        const auth = resolveAuth(decoded);
        if (auth === undefined) {
          return yield* new SandboxProviderError({
            reason: "invalid-config",
            message:
              "Set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID as sensitive environment variables on this deployment target.",
          });
        }
        // Probe credentials with the cheapest authenticated call.
        yield* trySdk("validate", () => sdk.listProjectsProbe(auth), "invalid-config");
        // Snapshot source: require a usable snapshot.
        if (decoded.sourceType === "snapshot") {
          if (decoded.snapshotId === undefined) {
            return yield* new SandboxProviderError({
              reason: "invalid-config",
              message: "Boot source is snapshot but no snapshot id is configured.",
            });
          }
          const snap = yield* trySdk(
            "validate.snapshot",
            () => sdk.getSnapshot({ snapshotId: decoded.snapshotId as string, ...auth }),
            "invalid-config",
          );
          if (snap === null || snap.status !== "created") {
            return yield* new SandboxProviderError({
              reason: "invalid-config",
              message: `Snapshot ${decoded.snapshotId as string} is missing or not usable (status=${snap?.status ?? "gone"}).`,
            });
          }
        }
        lastAuth = auth;
      }),

    provision: (req) =>
      Effect.gen(function* () {
        const decoded = yield* Effect.try({
          try: () => decodeVercelSandboxConfig(req.config),
          catch: (e) =>
            new SandboxProviderError({
              reason: "invalid-config",
              message: e instanceof Error ? e.message : String(e),
            }),
        });
        const auth = resolveAuth(decoded);
        if (auth === undefined) {
          return yield* new SandboxProviderError({
            reason: "invalid-config",
            message:
              "Set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID as sensitive environment variables on this deployment target.",
          });
        }
        const createEnv = buildCreateEnv(req);
        // NEVER retry create — it is billable and non-idempotent.
        const sb = yield* trySdk(
          "provision.create",
          () =>
            sdk.create({
              ...auth,
              ...(decoded.sourceType === "snapshot" && decoded.snapshotId !== undefined
                ? { source: { type: "snapshot", snapshotId: decoded.snapshotId as string } }
                : { runtime: decoded.runtime }),
              ...(decoded.vcpus !== undefined ? { resources: { vcpus: decoded.vcpus } } : {}),
              ports: [decoded.port],
              timeout: decoded.timeoutMs,
              env: createEnv,
            }),
          "provision-failed",
        );
        // Capture the domain now so reachability does not require a re-fetch.
        const domainBase = sb.domain(decoded.port);

        // Runtime boot: install CLIs. Snapshot boot: skip (snapshot has them).
        if (decoded.sourceType === "runtime") {
          const bootstrap = yield* trySdk(
            "provision.bootstrap",
            () => sb.runCommand({ cmd: "sh", args: ["-c", buildBootstrapScript()] }),
            "provision-failed",
          );
          if (bootstrap.exitCode !== 0) {
            const stderr = yield* Effect.promise(() => bootstrap.stderr()).pipe(
              Effect.orElseSucceed(() => ""),
            );
            // Best-effort cleanup after a bootstrap failure.
            yield* trySdk("provision.bootstrap.cleanup", () => sb.delete(), "dispose-failed").pipe(
              Effect.ignore,
            );
            return yield* new SandboxProviderError({
              reason: "provision-failed",
              message: `bootstrap failed (exit ${bootstrap.exitCode}): ${stderr.slice(-512)}`,
            });
          }
        }

        // Launch serve detached with the filtered env.
        const serveCmd = buildServeCommand({ port: decoded.port, env: buildServeEnv(req) });
        yield* trySdk(
          "provision.serve",
          () => sb.runCommand({ cmd: "sh", args: ["-c", serveCmd], detached: true }),
          "exec-failed",
        );

        // Poll the public healthz endpoint.
        yield* waitForReadyFor(`https://${new URL(domainBase).host}`).pipe(
          Effect.catch((error: SandboxProviderError) =>
            trySdk("provision.healthz.cleanup", () => sb.delete(), "dispose-failed").pipe(
              Effect.ignore,
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );

        lastAuth = auth;
        const state: VercelSandboxHandleState = {
          sandboxId: sb.sandboxId,
          port: decoded.port,
          domainBase,
          timeoutMs: decoded.timeoutMs,
          auth,
          ...(decoded.sourceType === "snapshot" && decoded.snapshotId !== undefined
            ? { bootedFromSnapshotId: decoded.snapshotId as string }
            : {}),
        };
        return {
          driverKind: VERCEL_KIND,
          instanceId: req.instanceId,
          handle: state,
        } satisfies SandboxHandle;
      }),

    exec: (handle, command, opts) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        const sb = yield* trySdk(
          "exec",
          () => sdk.get({ sandboxId: state.sandboxId, ...state.auth }),
          "exec-failed",
        );
        const wrapped = `export HOME=${SANDBOX_HOME}; ${opts?.cwd !== undefined ? `cd '${opts.cwd}'; ` : ""}${command}`;
        const result = yield* trySdk(
          "exec",
          () => sb.runCommand({ cmd: "sh", args: ["-c", wrapped] }),
          "exec-failed",
        );
        const stdout = yield* Effect.promise(() => result.stdout()).pipe(
          Effect.orElseSucceed(() => ""),
        );
        const stderr = yield* Effect.promise(() => result.stderr()).pipe(
          Effect.orElseSucceed(() => ""),
        );
        return { exitCode: result.exitCode, stdout, stderr } satisfies SandboxExecResult;
      }),

    reachability: (handle, port) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        // Use the stored domain when the port matches; re-fetch otherwise.
        const domainBase =
          port === state.port
            ? state.domainBase
            : yield* trySdk(
                "reachability",
                () => sdk.get({ sandboxId: state.sandboxId, ...state.auth }),
                "unreachable",
              ).pipe(Effect.map((sb) => sb.domain(port)));
        const host = new URL(domainBase).host;
        return {
          reachabilityKind: SandboxReachabilityKind.make("public"),
          httpBaseUrl: `https://${host}`,
          wsBaseUrl: `wss://${host}`,
        } satisfies SandboxReachability;
      }),

    dispose: (handle) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        yield* trySdk(
          "dispose",
          () => sdk.get({ sandboxId: state.sandboxId, ...state.auth }),
          "dispose-failed",
        ).pipe(
          Effect.flatMap((sb) => trySdk("dispose", () => sb.delete(), "dispose-failed")),
          Effect.catch((error: SandboxProviderError) =>
            // Tolerate already-deleted (404) as success; surface other errors.
            isNotFound(error.cause ?? error) ? Effect.void : Effect.fail(error),
          ),
        );
      }),

    describe: () =>
      Effect.succeed({
        kind: VERCEL_KIND,
        reachabilityKind: SandboxReachabilityKind.make("public"),
        maxLifetimeMs: VERCEL_MAX_LIFETIME_MS,
        supportsSnapshot: true,
        supportsRenewTimeout: true,
        supportsCopyInto: true,
        supportsResume: true,
      } satisfies SandboxProviderDescriptor),

    snapshot,
    renewTimeout,
    copyInto,
    resume,
  };

  return provider;
}

/**
 * The live Vercel sandbox provider, bound to `liveVercelSdk`. Registered with
 * the `SandboxProviderRegistry` by the server layer.
 */
export const VercelSandboxProvider: SandboxProvider = makeVercelSandboxProvider(liveVercelSdk);
