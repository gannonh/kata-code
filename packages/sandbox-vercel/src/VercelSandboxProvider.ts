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
 * `katacode serve` detached, and polls `/.well-known/kata/environment` until
 * the real server answers with JSON (SPA `/healthz` HTML 200 is not ready).
 * Reachability returns the public `https://<sandbox.domain(port)>` URL.
 * Lifecycle: `renewTimeout` forwards to `sb.extendTimeout`, `snapshot` stops
 * the VM (caller treats the session as lapsed), `copyInto` writes a tar
 * and extracts it, `dispose` deletes the sandbox. The durable `lifecycle`
 * capability (stop/start/status via v2 persistent sandboxes) is wired in
 * Phase 3; the former `resume` capability was removed from the SPI in favor
 * of `lifecycle.start`.
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

import { SandboxProviderDriverKind } from "@kata-sh/code-sandbox-contracts/instance";
import { SandboxReachabilityKind } from "@kata-sh/code-sandbox-contracts/reachability";
import {
  type SandboxCopyIntoCapability,
  type SandboxExecResult,
  type SandboxHandle,
  type SandboxLifecycleCapability,
  type SandboxLifecycleStatus,
  type SandboxProvisionRequest,
  type SandboxReachability,
  type SandboxRenewTimeoutCapability,
  type SandboxProvider,
  type SandboxProviderConfigDecoder,
  SandboxProviderError,
} from "@kata-sh/code-sandbox/driver";
import type { SandboxProviderDescriptor } from "@kata-sh/code-sandbox/descriptor";

import {
  VercelSandboxConfig,
  VERCEL_AUTH_ENV_VARS,
  VERCEL_SOURCE_TOKEN_ENV,
  GITHUB_TOKEN_GIT_USERNAME,
  decodeVercelSandboxConfig,
} from "./config.ts";
import type { VercelGitSource } from "./sdk.ts";
import type { VercelAuthParams, VercelSandboxInstance, VercelSdk } from "./sdk.ts";
import { isAuthError, isNotFound, liveVercelSdk } from "./sdk.ts";
import {
  buildBootstrapScript,
  buildKillServeCommand,
  buildServeCommand,
  SANDBOX_HOME,
  SERVE_LOG_PATH,
} from "./bootstrap.ts";

export const VERCEL_KIND = SandboxProviderDriverKind.make("vercel");

/** Vercel's native clone workspace (default session working directory). */
export const VERCEL_WORKSPACE = "/vercel/sandbox";

// Hoist compiled schema function to module scope (kata-code/no-inline-schema-compile).
// `decodeVercelSandboxConfig` (from config.ts) performs the legacy-key strip;
// the raw `Schema.decodeUnknownSync(VercelSandboxConfig)` is kept for tests
// that assert the underlying schema rejects malformed payloads.

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
  /** The SDK sandbox `name` (deterministic; the durable address for stop/start/status). */
  readonly sandboxId: string;
  readonly port: number;
  /** `sandbox.domain(port)` captured at provision for reachability without a re-fetch. */
  readonly domainBase: string;
  readonly timeoutMs: number;
  readonly auth: VercelAuthParams;
  /** Whether the sandbox persists its filesystem between sessions. */
  readonly persistent: boolean;
}

/** Vercel sandbox name prefix + rules. Names are lowercase alphanumeric +
 *  dashes, project-unique. The instance-derived slug is clamped to keep the
 *  whole name within the SDK's name rules. */
const SANDBOX_NAME_PREFIX = "kata-";
/** Native Git sources are cloned into this writable sandbox workspace. */
const VERCEL_GIT_WORKSPACE = "/vercel/sandbox";

/** Slugify a fragment for Vercel sandbox names (`[a-z0-9-]+`). */
function vercelNameSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Derive a deterministic Vercel sandbox name. Vercel names are project-unique,
 * so two Kata servers sharing one Vercel project must not collide on the same
 * instance id. Pass `nameNamespace` (typically the server environment id) to
 * scope the name.
 *
 * Slugification collapses `_` and `-` (and other non `[a-z0-9-]`) to `-`, so
 * distinct instance ids like `vercel_foo_bar` and `vercel_foo-bar` would
 * otherwise share a name. A short hash of the raw identity is appended so
 * those configs stay distinct. The result is clamped to 63 characters
 * (Vercel name limit), preserving the hash suffix.
 */
export function vercelSandboxName(instanceId: string, nameNamespace?: string): string {
  const slug = vercelNameSlug(instanceId);
  const ns = nameNamespace !== undefined ? vercelNameSlug(nameNamespace).slice(0, 24) : "";
  const identity = nameNamespace !== undefined ? `${nameNamespace}\0${instanceId}` : instanceId;
  const suffix = NodeCrypto.createHash("sha256").update(identity).digest("hex").slice(0, 8);
  const bodyRaw =
    ns.length > 0 ? `${SANDBOX_NAME_PREFIX}${ns}-${slug}` : `${SANDBOX_NAME_PREFIX}${slug}`;
  // Reserve `-` + 8-char hash within the 63-char Vercel limit.
  const body = bodyRaw.slice(0, 63 - 1 - suffix.length).replace(/-+$/g, "");
  return `${body}-${suffix}`;
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
      cause: error,
    });
  }
  if (isNotFound(error)) {
    return new SandboxProviderError({
      reason: "invalid-config",
      message: `${context}: not found (${message}).`,
      cause: error,
    });
  }
  return new SandboxProviderError({
    reason: fallback,
    message: `${context}: ${message}`,
    cause: error,
  });
}

/** Map a Vercel SDK session/sandbox status to the SPI lifecycle status.
 *
 * Spike result (recorded 2026-07-08, `@vercel/sandbox@2.4.0`):
 * `Sandbox.get({ name, resume: false })` returns a `SandboxAndSessionResponse`
 * whose `session` field is **required** (not nullable) and carries the last
 * session metadata, so `sandbox.status` is readable for a stopped sandbox
 * without resuming and does **not** throw. Not-found throws a 404, mapped to
 * `gone`. SDK statuses map as: running <- running, pending; stopped <-
 * stopped, stopping, snapshotting, aborted, failed. */
function mapVercelStatus(status: string): SandboxLifecycleStatus {
  switch (status) {
    case "running":
    case "pending":
      return "running";
    case "stopped":
    case "stopping":
    case "snapshotting":
    case "aborted":
    case "failed":
      return "stopped";
    default:
      return "stopped";
  }
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

/** Env names never passed into the sandbox (auth trio + transient source token). */
const EXCLUDED_SANDBOX_ENV = new Set<string>([...VERCEL_AUTH_ENV_VARS, VERCEL_SOURCE_TOKEN_ENV]);

/** Read the transient GitHub source token from a provision request's env. */
function readSourceToken(req: {
  readonly env?: ReadonlyArray<readonly [string, string]>;
}): string | undefined {
  for (const [k, v] of req.env ?? []) {
    if (k === VERCEL_SOURCE_TOKEN_ENV && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Build the native Git source payload from a configured source + token.
 * Returns `undefined` when either is missing — both are required so
 * `testConnection`'s disposable probe (which omits the transient token) stays
 * source-less even when the target has a configured repository/branch.
 */
function buildGitSource(
  config: VercelSandboxConfig,
  token: string | undefined,
): VercelGitSource | undefined {
  const source = config.source;
  if (source === undefined || token === undefined) return undefined;
  return {
    type: "git",
    url: `https://github.com/${source.repository}.git`,
    username: GITHUB_TOKEN_GIT_USERNAME,
    password: token,
    depth: 1,
    revision: source.branch,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Vercel's native Git revision can be a detached HEAD. Create the selected
 * local branch at that revision so Git worktree creation has a concrete base.
 * On lifecycle resume, preserve a user-selected branch and repair only a
 * detached checkout left by an older provision.
 */
function buildSourceBranchAttachCommand(branch: string, onlyWhenDetached: boolean): string {
  const checkout = `git checkout -B ${shellQuote(branch)} HEAD`;
  return onlyWhenDetached
    ? `if [ -z "$(git branch --show-current)" ]; then ${checkout}; fi`
    : checkout;
}

function attachSourceBranch(
  sandbox: VercelSandboxInstance,
  source: { readonly branch: string } | undefined,
  onlyWhenDetached: boolean,
): Effect.Effect<void, SandboxProviderError> {
  if (source === undefined) return Effect.void;
  return Effect.gen(function* () {
    const result = yield* trySdk(
      "source.branch",
      () =>
        sandbox.runCommand({
          cmd: "sh",
          args: ["-c", buildSourceBranchAttachCommand(source.branch, onlyWhenDetached)],
          cwd: VERCEL_GIT_WORKSPACE,
        }),
      "provision-failed",
    );
    if (result.exitCode === 0) return;
    const stderr = yield* Effect.promise(() => result.stderr()).pipe(
      Effect.orElseSucceed(() => ""),
    );
    return yield* new SandboxProviderError({
      reason: "provision-failed",
      message: `failed to attach the selected source branch (exit ${result.exitCode}): ${stderr.trim().slice(-512) || "git checkout failed"}`,
    });
  });
}

/** Env passed into `Sandbox.create` — excludes the auth trio + source token, adds KATA_* server env. */
function buildCreateEnv(req: SandboxProvisionRequest): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of req.env ?? []) {
    if (EXCLUDED_SANDBOX_ENV.has(k)) continue;
    env[k] = v;
  }
  for (const [k, v] of KATA_SERVER_ENV) env[k] = v;
  return env;
}

/** Env inlined at `katacode serve` launch — excludes the auth trio + source token, adds KATA_* server env. */
function buildServeEnv(req: {
  readonly env?: ReadonlyArray<readonly [string, string]>;
}): ReadonlyArray<readonly [string, string]> {
  const env: Array<readonly [string, string]> = [];
  for (const [k, v] of req.env ?? []) {
    if (EXCLUDED_SANDBOX_ENV.has(k)) continue;
    env.push([k, v]);
  }
  for (const [k, v] of KATA_SERVER_ENV) env.push([k, v]);
  return env;
}

// ── Healthz polling ───────────────────────────────────────────────────

/** Best-effort tail of the in-sandbox serve log. Never fails: diagnostics must
 *  not mask the original readiness error or block cleanup. */
function readServeLogTail(sb: VercelSandboxInstance): Effect.Effect<string, never> {
  return Effect.promise(async () => {
    try {
      const result = await sb.runCommand({
        cmd: "sh",
        args: ["-c", `tail -c 4096 '${SERVE_LOG_PATH}' 2>/dev/null || true`],
      });
      return (await result.stdout()).trim();
    } catch {
      return "";
    }
  });
}

/**
 * Re-fail a readiness error with the in-sandbox serve log tail attached. A
 * serve process that crashes after detached launch (e.g. a broken CLI publish)
 * is otherwise invisible: provision cleanup deletes the VM and the log with it.
 */
function failWithServeLogContext(
  sb: VercelSandboxInstance,
  error: SandboxProviderError,
): Effect.Effect<never, SandboxProviderError> {
  return Effect.flatMap(readServeLogTail(sb), (tail) =>
    Effect.fail(
      new SandboxProviderError({
        reason: error.reason,
        message:
          tail.length > 0
            ? `${error.message} — katacode serve log tail: ${tail.slice(-1500)}`
            : error.message,
        cause: error,
      }),
    ),
  );
}

/** Optional override for the public-healthz probe (tests inject a synchronous 200). */
export interface VercelSandboxProviderOptions {
  readonly healthzProbe?: (httpBaseUrl: string) => Effect.Effect<boolean, SandboxProviderError>;
  /** Test-only: shrink the readiness poll budget (defaults: 240 attempts, 500ms). */
  readonly healthzMaxAttempts?: number;
  readonly healthzIntervalMs?: number;
}

/**
 * Readiness probe against the public sandbox domain.
 *
 * Do **not** use `/healthz`: when `katacode serve` is up it falls through to the
 * SPA shell (HTTP 200 HTML), and when nothing listens Vercel returns
 * `SANDBOX_NOT_LISTENING`. Both made waitForReady lie or hang. The
 * well-known environment descriptor is JSON only when the real server is up.
 */
function defaultHealthzProbe(httpBaseUrl: string): Effect.Effect<boolean, SandboxProviderError> {
  const readyUrl = `${httpBaseUrl.replace(/\/$/, "")}/.well-known/kata/environment`;
  return Effect.tryPromise({
    try: async () => {
      const res = await fetch(readyUrl, {
        signal: AbortSignal.timeout(HEALTHZ_PROBE_TIMEOUT_MS),
        redirect: "manual",
      });
      if (res.status !== 200) return false;
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) return false;
      const body: unknown = await res.json();
      return (
        typeof body === "object" &&
        body !== null &&
        "environmentId" in body &&
        typeof (body as { environmentId: unknown }).environmentId === "string"
      );
    },
    catch: () =>
      new SandboxProviderError({ reason: "unreachable", message: "readiness fetch failed" }),
  }).pipe(
    Effect.matchEffect({
      onFailure: () => Effect.succeed(false),
      onSuccess: (ok) => Effect.succeed(ok),
    }),
  );
}

function waitForReady(
  httpBaseUrl: string,
  probe: (url: string) => Effect.Effect<boolean, SandboxProviderError>,
  budget: { readonly maxAttempts: number; readonly intervalMs: number },
): Effect.Effect<void, SandboxProviderError> {
  return Effect.gen(function* () {
    for (let i = 0; i < budget.maxAttempts; i++) {
      const ok = yield* probe(httpBaseUrl);
      if (ok) return;
      yield* Effect.sleep(`${budget.intervalMs} millis`);
    }
    return yield* new SandboxProviderError({
      reason: "timeout",
      message: `sandbox never became ready on ${httpBaseUrl}`,
    });
  });
}

// ── Provider factory ──────────────────────────────────────────────────

/**
 * Build a Vercel sandbox provider bound to an SDK. Unit tests inject a fake
 * SDK with no network; the live provider is bound to `liveVercelSdk`.
 */
export function makeVercelSandboxProvider(
  sdk: VercelSdk,
  options: VercelSandboxProviderOptions = {},
): SandboxProvider {
  const healthzProbe = options.healthzProbe ?? defaultHealthzProbe;
  const readinessBudget = {
    maxAttempts: options.healthzMaxAttempts ?? HEALTHZ_MAX_ATTEMPTS,
    intervalMs: options.healthzIntervalMs ?? HEALTHZ_INTERVAL_MS,
  };
  const waitForReadyFor = (httpBaseUrl: string) =>
    waitForReady(httpBaseUrl, healthzProbe, readinessBudget);

  const lifecycle: SandboxLifecycleCapability = {
    stop: (handle) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        const sb = yield* trySdk(
          "lifecycle.stop",
          () => sdk.get({ sandboxId: state.sandboxId, resume: false, ...state.auth }),
          "provision-failed",
        );
        yield* trySdk("lifecycle.stop", () => sb.stop(), "provision-failed");
        // stop on an already-stopped sandbox is idempotent success; the SDK
        // stop call is safe to re-issue.
      }),

    start: (handle, req) =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        // A non-persistent stopped sandbox cannot be resumed (its filesystem was
        // discarded); fail loud rather than silently recreating.
        if (!state.persistent) {
          return yield* new SandboxProviderError({
            reason: "provision-failed",
            message:
              "This sandbox was not persistent and cannot be started after stop. Delete it and create a new sandbox.",
          });
        }
        // Re-apply the current config's persistence setting so a toggle takes
        // effect at runtime (the next stop honors the new value).
        const decoded = yield* Effect.try({
          try: () => decodeVercelSandboxConfig(req.config),
          catch: (e) =>
            new SandboxProviderError({
              reason: "invalid-config",
              message: e instanceof Error ? e.message : String(e),
            }),
        });
        const persistent = decoded.persistent;
        const sb = yield* trySdk(
          "lifecycle.start",
          () => sdk.get({ sandboxId: state.sandboxId, resume: true, ...state.auth }),
          "provision-failed",
        ).pipe(
          Effect.mapError((error: SandboxProviderError) =>
            isNotFound(error.cause ?? error)
              ? new SandboxProviderError({
                  reason: "provision-failed",
                  message: "Sandbox is gone; create a new sandbox to re-seed the workspace.",
                  cause: error,
                })
              : error,
          ),
        );
        yield* attachSourceBranch(sb, decoded.source, true).pipe(
          Effect.catch((error: SandboxProviderError) =>
            trySdk(
              "lifecycle.start.source-branch.cleanup",
              () => sb.stop(),
              "provision-failed",
            ).pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
          ),
        );
        if (persistent !== state.persistent) {
          yield* trySdk(
            "lifecycle.start.update",
            () => sb.update({ persistent }),
            "provision-failed",
          );
        }
        // Kill (blocking) then relaunch detached. A single detached replace
        // race waitForReady against a dead port (SANDBOX_NOT_LISTENING) and can
        // orphan the relaunch. Kill must finish before we poll readiness.
        yield* trySdk(
          "lifecycle.start.kill-serve",
          () =>
            sb.runCommand({
              cmd: "sh",
              args: ["-c", buildKillServeCommand(state.port)],
            }),
          "exec-failed",
        );
        const serveCmd = buildServeCommand({ port: state.port, env: buildServeEnv(req) });
        yield* trySdk(
          "lifecycle.start.serve",
          () => sb.runCommand({ cmd: "sh", args: ["-c", serveCmd], detached: true }),
          "exec-failed",
        );
        yield* waitForReadyFor(`https://${new URL(sb.domain(state.port)).host}`).pipe(
          Effect.catch((error: SandboxProviderError) => failWithServeLogContext(sb, error)),
        );
        const domainBase = sb.domain(state.port);
        return {
          driverKind: VERCEL_KIND,
          instanceId: handle.instanceId,
          handle: {
            sandboxId: state.sandboxId,
            port: state.port,
            domainBase,
            timeoutMs: state.timeoutMs,
            auth: state.auth,
            persistent,
          } satisfies VercelSandboxHandleState,
        } satisfies SandboxHandle;
      }),

    status: (handle): Effect.Effect<SandboxLifecycleStatus, SandboxProviderError> =>
      Effect.gen(function* () {
        const state = handle.handle as VercelSandboxHandleState;
        // not-found -> `gone` (a status value, not an error) so the reconcile
        // pass evicts the record; other errors surface as provision-failed.
        const result = yield* trySdk(
          "lifecycle.status",
          () => sdk.get({ sandboxId: state.sandboxId, resume: false, ...state.auth }),
          "provision-failed",
        ).pipe(
          Effect.matchEffect({
            onFailure: (error: SandboxProviderError) =>
              isNotFound(error.cause ?? error)
                ? Effect.succeed<SandboxLifecycleStatus>("gone")
                : Effect.fail(error),
            onSuccess: (sb) => Effect.succeed<SandboxLifecycleStatus>(mapVercelStatus(sb.status)),
          }),
        );
        return result;
      }),

    discover: (
      req,
    ): Effect.Effect<
      { readonly handle: SandboxHandle; readonly status: SandboxLifecycleStatus } | null,
      SandboxProviderError
    > =>
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
          // No credentials to probe with — nothing to discover.
          return null;
        }
        const name = vercelSandboxName(req.instanceId, req.nameNamespace);
        const result = yield* trySdk(
          "lifecycle.discover",
          () => sdk.get({ sandboxId: name, resume: false, ...auth }),
          "provision-failed",
        ).pipe(
          Effect.matchEffect({
            onFailure: (error: SandboxProviderError) =>
              isNotFound(error.cause ?? error)
                ? Effect.succeed<{
                    readonly handle: SandboxHandle;
                    readonly status: SandboxLifecycleStatus;
                  } | null>(null)
                : Effect.fail(error),
            onSuccess: (sb) =>
              Effect.succeed<{
                readonly handle: SandboxHandle;
                readonly status: SandboxLifecycleStatus;
              } | null>({
                handle: {
                  driverKind: VERCEL_KIND,
                  instanceId: req.instanceId,
                  handle: {
                    sandboxId: name,
                    port: decoded.port,
                    domainBase: sb.domain(decoded.port),
                    timeoutMs: decoded.timeoutMs,
                    auth,
                    persistent: decoded.persistent,
                  } satisfies VercelSandboxHandleState,
                } satisfies SandboxHandle,
                status: mapVercelStatus(sb.status),
              }),
          }),
        );
        return result;
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
        const name = vercelSandboxName(req.instanceId, req.nameNamespace);
        const persistent = decoded.persistent;
        // Native Git source (when configured): clone the selected repo/branch
        // into /vercel/sandbox using the transient GitHub token supplied in the
        // provision env. The token is excluded from the sandbox env above.
        const source = buildGitSource(decoded, readSourceToken(req));
        // NEVER retry create — it is billable and non-idempotent.
        const sb = yield* trySdk(
          "provision.create",
          () =>
            sdk.create({
              ...auth,
              name,
              runtime: decoded.runtime,
              ...(source !== undefined ? { source } : {}),
              ...(decoded.vcpus !== undefined ? { resources: { vcpus: decoded.vcpus } } : {}),
              ports: [decoded.port],
              timeout: decoded.timeoutMs,
              env: createEnv,
              persistent,
              // Bound snapshot storage for persistent sandboxes so stop/start
              // keeps only the latest auto-snapshot.
              ...(persistent ? { keepLastSnapshots: { count: 1 } } : {}),
            }),
          "provision-failed",
        );
        // Capture the domain now so reachability does not require a re-fetch.
        const domainBase = sb.domain(decoded.port);

        // Only attach a local branch when create actually cloned a Git source.
        // testConnection's disposable probe omits the transient token, so create
        // is source-less even when the saved config has a repository/branch —
        // running git checkout there would fail with "not a git repository".
        yield* attachSourceBranch(
          sb,
          source !== undefined ? decoded.source : undefined,
          false,
        ).pipe(
          Effect.catch((error: SandboxProviderError) =>
            trySdk("provision.source-branch.cleanup", () => sb.delete(), "dispose-failed").pipe(
              Effect.ignore,
              Effect.andThen(Effect.fail(error)),
            ),
          ),
        );

        // Cold boot: install CLIs (the only boot path now; snapshot boot removed).
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
            failWithServeLogContext(sb, error).pipe(
              Effect.catch((enriched: SandboxProviderError) =>
                trySdk("provision.healthz.cleanup", () => sb.delete(), "dispose-failed").pipe(
                  Effect.ignore,
                  Effect.andThen(Effect.fail(enriched)),
                ),
              ),
            ),
          ),
        );

        const state: VercelSandboxHandleState = {
          sandboxId: name,
          port: decoded.port,
          domainBase,
          timeoutMs: decoded.timeoutMs,
          auth,
          persistent,
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
        // v2 delete removes the sandbox and all of its snapshots/sessions, so
        // no separate snapshot cleanup is needed. Resolve without resuming so
        // dispose works on a stopped sandbox.
        yield* trySdk(
          "dispose",
          () => sdk.get({ sandboxId: state.sandboxId, resume: false, ...state.auth }),
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
        supportsSnapshot: false,
        supportsRenewTimeout: true,
        supportsCopyInto: true,
        supportsLifecycle: true,
        supportsProjectSource: true,
      } satisfies SandboxProviderDescriptor),

    lifecycle,
    renewTimeout,
    copyInto,
    projectSource: {
      workspacePath: VERCEL_WORKSPACE,
      authSeedCwd: VERCEL_WORKSPACE,
      strategy: "native-clone",
      supportsDockerfileBuild: false,
      sourceTokenEnv: VERCEL_SOURCE_TOKEN_ENV,
    },
  };

  return provider;
}

/**
 * The live Vercel sandbox provider, bound to `liveVercelSdk`. Registered with
 * the `SandboxProviderRegistry` by the server layer.
 */
export const VercelSandboxProvider: SandboxProvider = makeVercelSandboxProvider(liveVercelSdk);
