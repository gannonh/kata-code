/**
 * `dockerRemoteSetup` — Docker-specific helpers for the remote GitHub clone flow.
 *
 * After credential seed places authenticated `gh`/Git in the container, Kata
 * shallow-clones the selected `owner/name@branch` into `/workspace`. Clone
 * failures surface concrete stderr and never leave a half-ready session.
 *
 * @module dockerRemoteSetup
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import {
  type SandboxHandle,
  type SandboxProvider,
  type SandboxProviderError,
} from "@kata-sh/code-sandbox/driver";

/** Docker sandbox workspace root (seeded by remote clone). */
export const DOCKER_WORKSPACE = "/workspace";

/** Fail-loud error for a Docker remote clone failure. */
export class DockerRemoteSetupError extends Data.TaggedError("DockerRemoteSetupError")<{
  readonly stage: "clone" | "read-config";
  readonly message: string;
  readonly cause?: unknown;
}> {}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the single `sh -c` command that shallow-clones `httpsUrl` at `branch`
 * into `workspacePath`. Uses the container's seeded GitHub auth (`gh auth
 * setup-git` / credential helper). The destination must be empty or absent.
 */
export function buildDockerShallowCloneCommand(input: {
  readonly httpsUrl: string;
  readonly branch: string;
  readonly workspacePath?: string;
}): string {
  const workspace = input.workspacePath ?? DOCKER_WORKSPACE;
  const quotedUrl = shellQuote(input.httpsUrl);
  const quotedBranch = shellQuote(input.branch);
  const quotedWorkspace = shellQuote(workspace);
  // Clone into a temp dir then move contents so `/workspace` (already present
  // and owned by katacode) becomes the git root without requiring an empty
  // mount-point rename.
  return [
    "set -eu",
    `export HOME=/home/katacode`,
    `tmp=$(mktemp -d /tmp/kata-docker-clone-XXXXXX)`,
    `trap 'rm -rf "$tmp"' EXIT`,
    `git clone --depth 1 --single-branch --branch ${quotedBranch} ${quotedUrl} "$tmp/repo"`,
    // Clear any residual contents (should be empty on fresh provision).
    `find ${quotedWorkspace} -mindepth 1 -maxdepth 1 -exec rm -rf {} +`,
    `cp -a "$tmp/repo"/. ${quotedWorkspace}/`,
  ].join("; ");
}

/**
 * Shallow-clone the selected GitHub source into `/workspace` using seeded
 * credentials. Surfaces concrete clone stderr on failure.
 */
export function cloneGitHubSourceIntoWorkspace(input: {
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly httpsUrl: string;
  readonly branch: string;
  readonly workspacePath?: string;
}): Effect.Effect<void, DockerRemoteSetupError | SandboxProviderError> {
  return Effect.gen(function* () {
    const workspace = input.workspacePath ?? DOCKER_WORKSPACE;
    const command = buildDockerShallowCloneCommand({
      httpsUrl: input.httpsUrl,
      branch: input.branch,
      workspacePath: workspace,
    });
    const result = yield* input.driver.exec(input.handle, command, { cwd: "/" });
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).slice(-512);
      return yield* new DockerRemoteSetupError({
        stage: "clone",
        message: `GitHub clone failed (exit ${result.exitCode}): ${detail}`,
      });
    }
  });
}

/**
 * Read `.kata/environment.json` from the Docker workspace via the driver.
 * Returns the raw file text when present, or `null` when absent.
 */
export function readDockerRemoteEnvironmentConfig(
  driver: SandboxProvider,
  handle: SandboxHandle,
  workspacePath: string = DOCKER_WORKSPACE,
): Effect.Effect<string | null, DockerRemoteSetupError | SandboxProviderError> {
  return Effect.gen(function* () {
    const probe = yield* driver.exec(handle, "test -f .kata/environment.json", {
      cwd: workspacePath,
    });
    if (probe.exitCode !== 0) return null;
    const read = yield* driver.exec(handle, "cat .kata/environment.json", {
      cwd: workspacePath,
    });
    if (read.exitCode !== 0) {
      return yield* new DockerRemoteSetupError({
        stage: "read-config",
        message: `failed to read .kata/environment.json (exit ${read.exitCode}): ${read.stderr.slice(-256)}`,
      });
    }
    return read.stdout;
  });
}
