/**
 * Thin injectable wrapper around `@vercel/sandbox` so unit tests use a fake
 * with no network and no billable `Sandbox.create` calls.
 *
 * The wrapper interface is stable; the live implementation adapts to the
 * installed SDK's exact parameter names. Verified against `@vercel/sandbox`
 * v2.4.0 types:
 *   - `Sandbox.create({ runtime?, image?, source?, ports?, timeout?, resources?, env?, ...Credentials })`
 *     — `source: { type: "snapshot", snapshotId }` boots from a snapshot;
 *       `runtime`/`image` are mutually exclusive with a snapshot source.
 *   - `Sandbox.get({ name, resume?, ...Credentials })` — sandboxes are
 *     addressed by `name` (not an id). `resume: true` reattaches to a lapsed
 *     sandbox via its auto-snapshot.
 *   - `sb.runCommand(cmd, args?, opts?)` returns `CommandFinished` with
 *     `.exitCode` and `.stdout()`/`.stderr()` async accessors. `runCommand`
 *     with a params object supports `detached`, `sudo`, `cwd`, `env`.
 *   - `sb.domain(port)` returns a public HTTPS URL.
 *   - `sb.writeFiles([{ path, content, mode? }])`.
 *   - `sb.extendTimeout(deltaMs)` is additive; remaining lifetime is not readable.
 *   - `sb.snapshot({ expiration? })` STOPS the sandbox and returns a `Snapshot`
 *     with `.snapshotId` and `.status` (`"created"` = usable).
 *   - `sb.delete()` / `sb.stop()`.
 *   - `Snapshot.get({ snapshotId, ...Credentials })` throws on not-found; the
 *     wrapper returns `null` so callers can treat not-found as a non-error.
 *
 * @module sdk
 */
import { Sandbox, Snapshot, type APIError } from "@vercel/sandbox";

/** Vercel auth trio (matches `@vercel/sandbox` `Credentials`). */
export interface VercelAuthParams {
  readonly token: string;
  readonly teamId: string;
  readonly projectId: string;
}

/** Native Git source for `Sandbox.create`. Authenticated clones pass
 *  `username`/`password` (GitHub uses `x-access-token` + token). */
export interface VercelGitSource {
  readonly type: "git";
  readonly url: string;
  readonly username?: string;
  readonly password?: string;
  readonly depth?: number;
  readonly revision?: string;
}

/** A live or fake Vercel sandbox instance, addressed by `sandboxId` (the SDK `name`). */
export interface VercelSandboxInstance {
  /** The SDK sandbox `name` used to re-fetch the instance. */
  readonly sandboxId: string;
  domain(port: number): string;
  /** Session-level status (readable without resuming; see `Sandbox.get({ resume: false })`). */
  readonly status: string;
  /** Whether the sandbox persists its filesystem between sessions. */
  readonly persistent: boolean;
  runCommand(opts: {
    readonly cmd: string;
    readonly args?: ReadonlyArray<string>;
    readonly sudo?: boolean;
    readonly detached?: boolean;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
  }): Promise<{ readonly exitCode: number; stdout(): Promise<string>; stderr(): Promise<string> }>;
  writeFiles(
    files: ReadonlyArray<{
      readonly path: string;
      readonly content: Buffer;
      readonly mode?: number;
    }>,
  ): Promise<void>;
  extendTimeout(deltaMs: number): Promise<void>;
  snapshot(opts?: { readonly expiration?: number }): Promise<{ readonly snapshotId: string }>;
  stop(): Promise<void>;
  delete(): Promise<void>;
  /** Update sandbox config (persistence, keepLastSnapshots, …). */
  update(params: {
    readonly persistent?: boolean;
    readonly keepLastSnapshots?: { readonly count: number; readonly expiration?: number } | null;
  }): Promise<void>;
}

/** Injectable SDK surface the driver uses. */
export interface VercelSdk {
  create(
    params: VercelAuthParams & {
      readonly name?: string;
      readonly runtime?: string;
      readonly image?: string;
      readonly source?: VercelGitSource;
      readonly resources?: { readonly vcpus: number };
      readonly ports: ReadonlyArray<number>;
      readonly timeout: number;
      readonly env: Record<string, string>;
      readonly persistent?: boolean;
      readonly keepLastSnapshots?: { readonly count: number; readonly expiration?: number };
    },
  ): Promise<VercelSandboxInstance>;
  get(
    params: VercelAuthParams & {
      readonly sandboxId: string;
      readonly resume?: boolean;
    },
  ): Promise<VercelSandboxInstance>;
  /** Cheapest authenticated probe — `Sandbox.list` pings the team/project. */
  listProjectsProbe(params: VercelAuthParams): Promise<void>;
  getSnapshot(
    params: VercelAuthParams & { readonly snapshotId: string },
  ): Promise<{ readonly status: string; delete(): Promise<void> } | null>;
}

/** Adapt a `@vercel/sandbox` `Sandbox` instance to the wrapper interface. */
function adaptSandbox(sb: Sandbox): VercelSandboxInstance {
  return {
    sandboxId: sb.name,
    domain: (port) => sb.domain(port),
    get status() {
      return sb.status;
    },
    get persistent() {
      return sb.persistent;
    },
    runCommand: async (opts) => {
      const result = await sb.runCommand({
        cmd: opts.cmd,
        ...(opts.args !== undefined ? { args: [...opts.args] } : {}),
        ...(opts.sudo !== undefined ? { sudo: opts.sudo } : {}),
        ...(opts.detached !== undefined ? { detached: opts.detached } : {}),
        ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
        ...(opts.env !== undefined ? { env: opts.env as Record<string, string> } : {}),
      });
      return {
        exitCode: result.exitCode ?? 0,
        stdout: () => result.stdout(),
        stderr: () => result.stderr(),
      };
    },
    writeFiles: (files) =>
      sb.writeFiles(
        files.map((f) => ({
          path: f.path,
          content: f.content,
          ...(f.mode !== undefined ? { mode: f.mode } : {}),
        })),
      ),
    extendTimeout: (deltaMs) => sb.extendTimeout(deltaMs),
    snapshot: async (opts) => {
      const snap = await sb.snapshot(
        opts !== undefined && opts.expiration !== undefined ? { expiration: opts.expiration } : {},
      );
      return { snapshotId: snap.snapshotId };
    },
    stop: () => sb.stop().then(() => undefined),
    delete: () => sb.delete(),
    update: (params) =>
      sb.update({
        ...(params.persistent !== undefined ? { persistent: params.persistent } : {}),
        ...(params.keepLastSnapshots !== undefined
          ? { keepLastSnapshots: params.keepLastSnapshots }
          : {}),
      }),
  };
}

/** True when an SDK error is a 404 / not-found response. */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const apiError = error as APIError<unknown>;
  if (apiError.response !== undefined && apiError.response.status === 404) return true;
  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  return /not_found|not found|snapshot_not_found/i.test(message);
}

/** True when an SDK error is an auth failure (401/403). */
function isAuthError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const apiError = error as APIError<unknown>;
  if (
    apiError.response !== undefined &&
    (apiError.response.status === 401 || apiError.response.status === 403)
  ) {
    return true;
  }
  const message =
    typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  return /unauthorized|forbidden|invalid token/i.test(message);
}

export { isNotFound, isAuthError };

/**
 * The live `@vercel/sandbox` wrapper. Create is billable and non-idempotent:
 * the driver never retries it.
 */
export const liveVercelSdk: VercelSdk = {
  create: async (params) => {
    // Build the SDK params object conditionally so the runtime/snapshot union
    // narrows correctly under `exactOptionalPropertyTypes`.
    const base = {
      token: params.token,
      teamId: params.teamId,
      projectId: params.projectId,
      ports: [...params.ports],
      timeout: params.timeout,
      env: params.env,
      ...(params.resources !== undefined ? { resources: params.resources } : {}),
      ...(params.name !== undefined ? { name: params.name } : {}),
      ...(params.persistent !== undefined ? { persistent: params.persistent } : {}),
      ...(params.keepLastSnapshots !== undefined
        ? { keepLastSnapshots: params.keepLastSnapshots }
        : {}),
    };
    // A Git source clones into /vercel/sandbox and still needs a runtime/image
    // to execute; only runtime and image are mutually exclusive.
    const withSource =
      params.source !== undefined
        ? {
            source: {
              type: "git" as const,
              url: params.source.url,
              ...(params.source.username !== undefined ? { username: params.source.username } : {}),
              ...(params.source.password !== undefined ? { password: params.source.password } : {}),
              ...(params.source.depth !== undefined ? { depth: params.source.depth } : {}),
              ...(params.source.revision !== undefined ? { revision: params.source.revision } : {}),
            },
          }
        : {};
    const sb =
      params.image !== undefined
        ? await Sandbox.create({ ...base, ...withSource, image: params.image })
        : await Sandbox.create({ ...base, ...withSource, runtime: params.runtime ?? "node24" });
    return adaptSandbox(sb);
  },
  get: async (params) => {
    const sb = await Sandbox.get({
      token: params.token,
      teamId: params.teamId,
      projectId: params.projectId,
      name: params.sandboxId,
      ...(params.resume !== undefined ? { resume: params.resume } : {}),
    });
    return adaptSandbox(sb);
  },
  listProjectsProbe: async (params) => {
    // `Sandbox.list` is the cheapest authenticated call that validates the
    // token/team/project trio without creating a billable sandbox.
    const result = await Sandbox.list({
      token: params.token,
      teamId: params.teamId,
      projectId: params.projectId,
      limit: 1,
    });
    // Drain the first page so the API call actually executes. Propagate
    // auth/network failures so `validate` can map them to `invalid-config`.
    await result.toArray();
  },
  getSnapshot: async (params) => {
    try {
      const snap = await Snapshot.get({
        snapshotId: params.snapshotId,
        token: params.token,
        teamId: params.teamId,
        projectId: params.projectId,
      });
      return { status: snap.status, delete: () => snap.delete() };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },
};
