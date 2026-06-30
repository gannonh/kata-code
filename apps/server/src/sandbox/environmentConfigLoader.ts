/**
 * `environmentConfigLoader` — host-side resolution of a repo's environment
 * config for sandbox setup (Phase 2).
 *
 * Reads `<repoRoot>/.kata/environment.json` from the host working tree
 * (fail-loud decode when the file is present but malformed; an absent file is
 * the normal no-repo-config case), looks up the saved per-repo environment
 * from `ServerSettings.savedSandboxEnvironments` keyed by
 * `RepositoryIdentity.canonicalKey`, and hands `(repoFileConfig?,
 * savedEnvConfig?, providerDefault)` to the pure `resolveEnvironmentConfig`.
 *
 * The provider default is an empty `EnvironmentConfig` (`{}`): a no-op setup
 * (locked decision 8), not derived from `DEFAULT_DOCKER_CONFIG`. When nothing
 * is configured, setup is a no-op and the container just boots `katacode
 * serve` as in Phase 1.
 *
 * The loader performs the only I/O in the resolution chain (host file read +
 * saved-env lookup); the resolver itself is pure. It does not materialize
 * secrets — the caller (`startSession`) passes already-materialized settings.
 *
 * @module environmentConfigLoader
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { RepositoryIdentity } from "@kata-sh/code-contracts";
import { RepositoryCanonicalKey, type SavedSandboxEnvironment } from "@kata-sh/code-contracts";
import { EnvironmentConfig } from "@kata-sh/code-sandbox-contracts/environmentConfig";
import { resolveEnvironmentConfig, type ResolvedEnvironmentConfig } from "@kata-sh/code-sandbox";

/** Fail-loud error for a present-but-malformed `.kata/environment.json`. */
export class EnvironmentConfigLoadError extends Data.TaggedError("EnvironmentConfigLoadError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** The saved-env map shape (`ServerSettings.savedSandboxEnvironments`). */
export type SavedSandboxEnvironments = Record<string, SavedSandboxEnvironment>;

/** Input to `loadEnvironmentConfig`. */
export interface LoadEnvironmentConfigInput {
  /** Host path to the repo working tree (where `.kata/environment.json` lives). */
  readonly repoRoot: string;
  /** The repo identity whose `canonicalKey` keys the saved-env lookup. */
  readonly repositoryIdentity: RepositoryIdentity;
  /** The saved per-repo environments map (from `ServerSettings`). */
  readonly savedSandboxEnvironments: SavedSandboxEnvironments;
}

/** Result of `loadEnvironmentConfig`. */
export interface LoadedEnvironmentConfig {
  /** The resolved config the setup runner drives provision + setup from. */
  readonly resolved: ResolvedEnvironmentConfig;
  /** Whether a `.kata/environment.json` was present at `repoRoot`. */
  readonly repoFilePresent: boolean;
}

// Hoist compiled schema functions to module scope (kata-code/no-inline-schema-compile).
const decodeEnvironmentConfig = Schema.decodeUnknownSync(EnvironmentConfig);
const parseJson = Schema.decodeUnknownSync(Schema.UnknownFromJsonString);

/**
 * Read and decode `<repoRoot>/.kata/environment.json`. Returns `undefined`
 * when the file is absent (the normal no-repo-config case). Fails with
 * `EnvironmentConfigLoadError` when the file is present but cannot be parsed
 * or does not satisfy the schema (fail loud — no silent fallback).
 */
function readRepoFileConfig(
  repoRoot: string,
): Effect.Effect<
  EnvironmentConfig | undefined,
  EnvironmentConfigLoadError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const filePath = path.join(repoRoot, ".kata", "environment.json");
    const exists = yield* fs.exists(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new EnvironmentConfigLoadError({
            message: `failed to check for ${filePath}: ${String(cause)}`,
            cause,
          }),
      ),
    );
    if (!exists) return undefined;
    const raw = yield* fs.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new EnvironmentConfigLoadError({
            message: `failed to read ${filePath}: ${String(cause)}`,
            cause,
          }),
      ),
    );
    const parsed = yield* Effect.try({
      try: () => parseJson(raw),
      catch: (cause) =>
        new EnvironmentConfigLoadError({
          message: `${filePath} is not valid JSON: ${String(cause)}`,
          cause,
        }),
    });
    return yield* Effect.try({
      try: () => decodeEnvironmentConfig(parsed),
      catch: (cause) =>
        new EnvironmentConfigLoadError({
          message: `${filePath} is not a valid environment config: ${String(cause)}`,
          cause,
        }),
    });
  });
}

/**
 * Adapt a `SavedSandboxEnvironment` into the `EnvironmentConfig` shape the
 * resolver consumes. The saved env carries `install`/`start`/`terminals` a user
 * edits (plus `networkAccess`/`environment` the resolver ignores); it has no
 * `build`/`snapshot`, so those are omitted. `SavedEnvironmentTerminal` is
 * structurally identical to `EnvironmentTerminal` (`{ name, command }`), so
 * `terminals` passes through directly.
 */
function savedEnvToConfig(saved: SavedSandboxEnvironment): EnvironmentConfig {
  return {
    ...(saved.install !== undefined ? { install: saved.install } : {}),
    ...(saved.start !== undefined ? { start: saved.start } : {}),
    ...(saved.terminals !== undefined ? { terminals: saved.terminals } : {}),
  };
}

/**
 * Load and resolve a repo's environment config. Reads the host
 * `.kata/environment.json` (fail loud on a malformed file), looks up the saved
 * env by `canonicalKey`, and merges first-match-wins via the pure resolver.
 * The provider default is an empty `EnvironmentConfig` (no-op setup).
 */
export function loadEnvironmentConfig(
  input: LoadEnvironmentConfigInput,
): Effect.Effect<
  LoadedEnvironmentConfig,
  EnvironmentConfigLoadError,
  FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const repoFileConfig = yield* readRepoFileConfig(input.repoRoot);
    const repoFilePresent = repoFileConfig !== undefined;

    const key = input.repositoryIdentity.canonicalKey as unknown as RepositoryCanonicalKey;
    const saved = input.savedSandboxEnvironments[key as unknown as string];
    const savedEnvConfig = saved !== undefined ? savedEnvToConfig(saved) : undefined;

    // Locked decision 8: the provider default is an empty no-op config, not
    // derived from DEFAULT_DOCKER_CONFIG (a different shape with no setup fields).
    const providerDefault: EnvironmentConfig = {};

    const resolved = resolveEnvironmentConfig({
      ...(repoFileConfig !== undefined ? { repoFileConfig } : {}),
      ...(savedEnvConfig !== undefined ? { savedEnvConfig } : {}),
      providerDefault,
    });
    return { resolved, repoFilePresent };
  });
}
