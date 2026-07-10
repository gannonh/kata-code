/**
 * `vercelRemoteSetup` — Vercel-specific setup helpers for the native-clone flow.
 *
 * After Vercel clones the selected GitHub repository into `/vercel/sandbox`,
 * Kata reads `.kata/environment.json` from that workspace through the driver
 * (there is no host repo to read) and seeds authenticated `gh`/Git into the
 * persistent sandbox filesystem. The GitHub token is passed in memory, written
 * to a temporary mode-0600 file, consumed by `gh auth login --with-token`, and
 * removed by a shell `trap` on every exit path. The token never appears in an
 * exec command string, log, or persisted record.
 *
 * @module vercelRemoteSetup
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

import {
  type SandboxHandle,
  type SandboxProvider,
  type SandboxProviderError,
} from "@kata-sh/code-sandbox/driver";
import { redactSecrets } from "@kata-sh/code-sandbox/redactSecrets";

import { packUstarArchive } from "./ustarWriter.ts";

/** Vercel's native clone workspace (the default session working directory). */
export const VERCEL_WORKSPACE = "/vercel/sandbox";

/** Container home the seeded `gh`/Git credential state lives under (persisted
 *  by Vercel's filesystem snapshot across stop/start). */
const SANDBOX_HOME = "/home/katacode";

/** Fail-loud error for a remote read or GitHub auth seed failure. */
export class VercelRemoteSetupError extends Data.TaggedError("VercelRemoteSetupError")<{
  readonly stage: "read-config" | "github-auth";
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Read `.kata/environment.json` from the Vercel workspace via the driver.
 * Returns the raw file text when present, or `null` when absent (exit 1 from
 * `test -f`). A non-zero `cat` exit fails loud.
 */
export function readRemoteEnvironmentConfig(
  driver: SandboxProvider,
  handle: SandboxHandle,
): Effect.Effect<string | null, VercelRemoteSetupError | SandboxProviderError> {
  return Effect.gen(function* () {
    const probe = yield* driver.exec(handle, "test -f .kata/environment.json", {
      cwd: VERCEL_WORKSPACE,
    });
    if (probe.exitCode !== 0) return null;
    const read = yield* driver.exec(handle, "cat .kata/environment.json", {
      cwd: VERCEL_WORKSPACE,
    });
    if (read.exitCode !== 0) {
      return yield* new VercelRemoteSetupError({
        stage: "read-config",
        message: `failed to read .kata/environment.json (exit ${read.exitCode}): ${read.stderr.slice(-256)}`,
      });
    }
    return read.stdout;
  });
}

/**
 * Build the single `sh -c` command that authenticates `gh` and Git from a
 * temporary token file, then removes the file (and its directory) on every exit
 * path via a `trap`. The command references only `tokenFilePath`, never the
 * token itself.
 */
export function buildGitHubAuthSeedCommand(tokenFilePath: string): string {
  const quoted = `'${tokenFilePath.replace(/'/g, "'\\''")}'`;
  return [
    "set -eu",
    `export HOME=${SANDBOX_HOME}`,
    `trap 'rm -rf "$(dirname ${quoted})"' EXIT`,
    `gh auth login --hostname github.com --with-token < ${quoted}`,
    "gh auth setup-git",
  ].join("; ");
}

/**
 * Seed authenticated `gh`/Git into the sandbox from an in-memory GitHub token.
 * Uploads a mode-0600 token file to a random `/tmp` path via `copyInto`, runs
 * the auth command (which removes the file on exit), and redacts the token from
 * any captured output before mapping a failure. The `nonce` makes the temp path
 * unique; callers pass a random value.
 */
export function seedGitHubAuth(input: {
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  readonly token: string;
  readonly nonce: string;
}): Effect.Effect<void, VercelRemoteSetupError | SandboxProviderError> {
  return Effect.gen(function* () {
    const copyIntoCap = input.driver.copyInto;
    if (copyIntoCap === undefined) {
      return yield* new VercelRemoteSetupError({
        stage: "github-auth",
        message: "driver does not support copyInto; cannot seed GitHub auth",
      });
    }
    const dir = `/tmp/kata-github-auth-${input.nonce}`;
    const tokenFilePath = `${dir}/token`;
    // Upload the token as a mode-0600 file under the random dir. copyInto
    // extracts the tar at `/tmp`, so the entry path is relative to /tmp.
    const archive = yield* Effect.tryPromise({
      try: () =>
        packUstarArchive(
          [],
          [
            {
              relativePath: `kata-github-auth-${input.nonce}/token`,
              content: Buffer.from(input.token, "utf8"),
              mode: 0o600,
            },
          ],
        ),
      catch: (cause) =>
        new VercelRemoteSetupError({
          stage: "github-auth",
          message: `failed to pack GitHub token file: ${String(cause)}`,
          cause,
        }),
    });
    yield* copyIntoCap.copyInto(input.handle, archive, "/tmp").pipe(
      Effect.mapError(
        (e) =>
          new VercelRemoteSetupError({
            stage: "github-auth",
            message: `failed to upload GitHub token file: ${e.message}`,
            cause: e,
          }),
      ),
    );
    const command = buildGitHubAuthSeedCommand(tokenFilePath);
    const result = yield* input.driver.exec(input.handle, command, { cwd: VERCEL_WORKSPACE });
    if (result.exitCode !== 0) {
      const stderr = redactSecrets(result.stderr, [input.token]);
      const stdout = redactSecrets(result.stdout, [input.token]);
      return yield* new VercelRemoteSetupError({
        stage: "github-auth",
        message: `gh auth seed failed (exit ${result.exitCode}): ${(stderr || stdout).slice(-256)}`,
      });
    }
  });
}
