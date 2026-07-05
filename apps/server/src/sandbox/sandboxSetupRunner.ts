/**
 * `sandboxSetupRunner` — Phase 2 setup execution after a sandbox is provisioned.
 *
 * Orchestrates, after `provision()` returns a ready handle:
 * 1. SEED the repo working tree into `/workspace` via the driver's `copyInto`
 *    capability (a bounded tar built host-side by `repoSeedArchive`).
 * 2. INJECT secrets — the caller passes already-materialized container env +
 *    the list of secret values to redact from captured output. (The actual
 *    provision-time env injection is the caller's responsibility; the runner
 *    only uses `secretValues` for redaction.)
 * 3. INSTALL — blocking `exec(handle, install, { cwd: '/workspace' })`, with
 *    every secret value redacted from the captured output before it leaves the
 *    runner. A non-zero exit raises an explicit `SetupFailed` error.
 * 4. START / TERMINALS — each launched DETACHED via `exec`
 *    (`setsid sh -c '<cmd>' > /tmp/kata-<name>.log 2>&1 &`) and recorded in a
 *    server-side `SetupProcessRecord { name, command }` (no pid; the frozen
 *    `exec` returns none). When the sets are empty, the runner records and
 *    reports the empty set and starts no process.
 *
 * `build`/`snapshot` are resolved by the caller but NOT executed here (Phase 2
 * parses them for forward-compat; execution is deferred).
 *
 * @module sandboxSetupRunner
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import {
  type SandboxHandle,
  type SandboxProvider,
  type SandboxProviderError,
} from "@kata-sh/code-sandbox/driver";
import type { ResolvedEnvironmentConfig } from "@kata-sh/code-sandbox";
import { redactSecrets } from "@kata-sh/code-sandbox/redactSecrets";

import { buildRepoSeedArchive, SeedArchiveError } from "./repoSeedArchive.ts";
import { buildCredentialSeedArchives } from "./credentialSeed.ts";

/** A detached setup process the runner launched (tracked for teardown). */
export interface SetupProcessRecord {
  readonly name: string;
  readonly command: string;
}

/**
 * A setup stage failed. Surfaced explicitly (no silent fallback): a malformed
 * seed, a non-zero `install` exit, or a detached-launch failure all raise this
 * rather than masking the error.
 */
export class SetupFailed extends Data.TaggedError("SetupFailed")<{
  readonly stage: "seed" | "install" | "start" | "terminals";
  readonly message: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly cause?: unknown;
}> {}

/** Result of a successful setup run. */
export interface SetupRunnerResult {
  readonly processes: ReadonlyArray<SetupProcessRecord>;
  readonly installOutput: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
  };
}

/** Bounded seed limits (default 256 MB / 50k files in `repoSeedArchive`). */
export interface SetupSeedLimits {
  readonly maxBytes?: number;
  readonly maxFiles?: number;
}

export interface RunSandboxSetupInput {
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly resolved: ResolvedEnvironmentConfig;
  /** Secret values to redact from captured install/start output. */
  readonly secretValues: ReadonlyArray<string>;
  /** When present, seed the repo at `repoRoot` into `/workspace` via copyInto. */
  readonly seed?: { readonly repoRoot: string; readonly limits?: SetupSeedLimits };
  /** When present, seed provider credentials (static + auth) into the container home via copyInto. */
  readonly seedCredentials?: { readonly hostHome: string };
}

/** Default install cwd: the seeded repo lives at /workspace in the container. */
const WORKSPACE = "/workspace";

/**
 * Run the Phase 2 setup for a provisioned sandbox: seed (if requested and the
 * driver supports `copyInto`), blocking `install`, then detached
 * `start`/`terminals`. Returns the process records (for the caller to attach
 * to the session) and the redacted install output. Fails with `SetupFailed`
 * for seed/install/launch failures, or `SandboxProviderError` for driver
 * errors.
 */
export function runSandboxSetup(
  input: RunSandboxSetupInput,
): Effect.Effect<SetupRunnerResult, SetupFailed | SandboxProviderError> {
  return Effect.gen(function* () {
    const { driver, handle, resolved, secretValues } = input;

    // 0. Seed provider credentials (static config + auth) into the container
    //    home before the repo seed and before any provider probe re-checks.
    //    Credentials must be in place before the sandbox server re-probes
    //    providers (the caller triggers a refreshProviders after setup).
    if (input.seedCredentials) {
      yield* seedCredentialsIntoSandbox(driver, handle, input.seedCredentials);
    }

    // 1. Seed the repo into /workspace (when requested and setup is needed).
    if (input.seed) {
      yield* seedWorkspace(driver, handle, input.seed);
    }

    // 2. Blocking install in /workspace, with secret redaction.
    const installOutput = yield* runInstall(driver, handle, resolved, secretValues);

    // 3. Detached start + terminals (no waiting; recorded for teardown).
    // Detached-process output is redirected to in-container log files (not
    // captured here), so secret redaction does not apply to this stage.
    // cwd is /workspace only when the repo was seeded there; without seeding,
    // /workspace may not exist in the container.
    const cwd = input.seed ? WORKSPACE : undefined;
    const processes = yield* runDetachedProcesses(driver, handle, resolved, cwd);

    return { processes, installOutput } satisfies SetupRunnerResult;
  });
}

/** Seed provider credentials (static config + auth) into the container home via copyInto. */
function seedCredentialsIntoSandbox(
  driver: SandboxProvider,
  handle: SandboxHandle,
  input: { readonly hostHome: string },
): Effect.Effect<void, SetupFailed | SandboxProviderError> {
  const copyIntoCap = driver.copyInto;
  if (!copyIntoCap) {
    return Effect.fail(
      new SetupFailed({
        stage: "seed",
        message: "driver does not support copyInto; cannot seed credentials into the sandbox",
      }),
    );
  }
  return Effect.gen(function* () {
    const archives = yield* buildCredentialSeedArchives({ hostHome: input.hostHome }).pipe(
      Effect.mapError(
        (e) =>
          new SetupFailed({
            stage: "seed",
            message: `credential seed build failed: ${e.message}`,
            cause: e,
          }),
      ),
    );
    // Extract to the container home so ~/.codex, ~/.claude, ~/.pi/agent land at
    // /home/katacode/.codex etc. The static archive contains directory entries
    // for the full path, so copyInto's mkdir -p creates the tree.
    if (archives.static) {
      yield* copyIntoCap.copyInto(handle, archives.static, "/home/katacode").pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "seed",
              message: `credential static copyInto failed: ${e.message}`,
              cause: e,
            }),
        ),
      );
    }
    if (archives.credentials) {
      yield* copyIntoCap.copyInto(handle, archives.credentials, "/home/katacode").pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "seed",
              message: `credential auth copyInto failed: ${e.message}`,
              cause: e,
            }),
        ),
      );
    }
  });
}

/** Seed the repo working tree into /workspace via the driver's copyInto. */
function seedWorkspace(
  driver: SandboxProvider,
  handle: SandboxHandle,
  seed: { readonly repoRoot: string; readonly limits?: SetupSeedLimits },
): Effect.Effect<void, SetupFailed | SandboxProviderError> {
  const copyIntoCap = driver.copyInto;
  if (!copyIntoCap) {
    return Effect.fail(
      new SetupFailed({
        stage: "seed",
        message:
          "driver does not support copyInto; cannot seed the repo into the sandbox (cloud drivers seed via their own mechanism in a later phase)",
      }),
    );
  }
  return Effect.gen(function* () {
    // The archive is built host-side; a failure (limit exceeded, read error)
    // fails loud rather than silently truncating.
    const archive = yield* Effect.tryPromise({
      try: () => buildRepoSeedArchive(seed.repoRoot, seed.limits ?? {}),
      catch: (cause) =>
        cause instanceof SeedArchiveError
          ? cause
          : new SeedArchiveError({
              reason: "read-failed",
              message: `failed to build seed archive: ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
    }).pipe(
      Effect.mapError((e) => new SetupFailed({ stage: "seed", message: e.message, cause: e })),
    );
    yield* copyIntoCap
      .copyInto(handle, archive, WORKSPACE)
      .pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({ stage: "seed", message: `copyInto failed: ${e.message}`, cause: e }),
        ),
      );
  });
}

/** Run the blocking install in /workspace, redacting secrets from the output. */
function runInstall(
  driver: SandboxProvider,
  handle: SandboxHandle,
  resolved: ResolvedEnvironmentConfig,
  secretValues: ReadonlyArray<string>,
): Effect.Effect<SetupRunnerResult["installOutput"], SetupFailed | SandboxProviderError> {
  if (resolved.install === undefined) {
    return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 });
  }
  return driver.exec(handle, resolved.install, { cwd: WORKSPACE }).pipe(
    Effect.map((r) => {
      const stdout = redactSecrets(r.stdout, secretValues);
      const stderr = redactSecrets(r.stderr, secretValues);
      return { stdout, stderr, exitCode: r.exitCode };
    }),
    Effect.flatMap((output) => {
      if (output.exitCode !== 0) {
        return Effect.fail(
          new SetupFailed({
            stage: "install",
            message: `install exited with code ${output.exitCode}`,
            exitCode: output.exitCode,
            stdout: output.stdout,
            stderr: output.stderr,
          }),
        );
      }
      return Effect.succeed(output);
    }),
    Effect.mapError((e) =>
      e instanceof SetupFailed
        ? e
        : new SetupFailed({
            stage: "install",
            message: `install exec failed: ${(e as { message?: string }).message ?? String(e)}`,
            cause: e,
          }),
    ),
  );
}

/** Launch `start` and each `terminal` detached, recording process records. */
function runDetachedProcesses(
  driver: SandboxProvider,
  handle: SandboxHandle,
  resolved: ResolvedEnvironmentConfig,
  cwd?: string,
): Effect.Effect<ReadonlyArray<SetupProcessRecord>, SetupFailed | SandboxProviderError> {
  return Effect.gen(function* () {
    const processes: SetupProcessRecord[] = [];

    if (resolved.start !== undefined) {
      yield* launchDetached(driver, handle, "start", resolved.start, cwd).pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "start",
              message: `failed to launch start process: ${(e as { message?: string }).message ?? String(e)}`,
              cause: e,
            }),
        ),
      );
      processes.push({ name: "start", command: resolved.start });
    }

    for (const terminal of resolved.terminals ?? []) {
      yield* launchDetached(driver, handle, terminal.name, terminal.command, cwd).pipe(
        Effect.mapError(
          (e) =>
            new SetupFailed({
              stage: "terminals",
              message: `failed to launch terminal '${terminal.name}': ${(e as { message?: string }).message ?? String(e)}`,
              cause: e,
            }),
        ),
      );
      processes.push({ name: terminal.name, command: terminal.command });
    }

    return processes;
  });
}

/**
 * Launch a long-lived process detached via `setsid sh -c '<cmd>' >log 2>&1 &`.
 * The spike verified the detached child survives the `exec` return (it is
 * reparented to the container init) and is visible in `ps`. The runner does
 * NOT wait on the process. The log filename is slugified from `name`.
 */
function launchDetached(
  driver: SandboxProvider,
  handle: SandboxHandle,
  name: string,
  command: string,
  cwd?: string,
): Effect.Effect<void, SandboxProviderError> {
  const logFile = `/tmp/kata-${uniqueLogSlug(name)}.log`;
  // Match the detached-exec spike: redirect + background the inner shell command
  // so setsid's child exits promptly and the outer exec returns without waiting.
  // cwd is /workspace (when seeded) so relative paths resolve against the repo.
  const inner = `${command} > ${logFile} 2>&1 &`;
  const detached = `setsid sh -c ${shellQuote(inner)}`;
  return driver.exec(handle, detached, cwd !== undefined ? { cwd } : undefined).pipe(Effect.asVoid);
}

/**
 * Single-quote shell-quote: wrap in single quotes, escaping embedded single
 * quotes as `'\''`. Minimal, no external dep.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Slugify a process name for a log filename: keep [A-Za-z0-9_-], drop the rest. */
function slugifyName(name: string): string {
  const slug = name.replace(/[^A-Za-z0-9_-]/g, "").toLowerCase();
  return slug.length > 0 ? slug : "process";
}

/** Unique slug map to avoid log file collisions when names share a slug. */
const usedLogSlugs = new Map<string, number>();

/** Return a unique slug for a log filename, appending an index on collision. */
function uniqueLogSlug(name: string): string {
  const base = slugifyName(name);
  const count = usedLogSlugs.get(base);
  if (count === undefined) {
    usedLogSlugs.set(base, 1);
    return base;
  }
  usedLogSlugs.set(base, count + 1);
  return `${base}-${count}`;
}
