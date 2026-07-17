/**
 * Bootstrap + serve-launch script builders for the Vercel Sandbox driver.
 *
 * The Vercel runtime (`node24`, Amazon Linux 2023) ships node/npm but no
 * provider CLIs or `katacode` server. `buildBootstrapScript` returns a single
 * `sh -c` script that creates the katacode home and installs the CLIs. Env is
 * inlined at serve-launch time (not baked at create time) so resume can
 * restart `katacode serve` with a fresh bootstrap token without re-provisioning.
 *
 * @module bootstrap
 */

/** In-sandbox home for the katacode user (created and chowned at bootstrap). */
export const SANDBOX_HOME = "/home/katacode";

/** The katacode CLI npm package (bin `katacode`). */
export const KATA_CLI_PACKAGE = "@kata-sh/code-cli";

/**
 * Known-good pi SDK build pinned in sandbox installs. The published kata CLI
 * declares `@earendil-works/pi-*: ^0.80.0`; pi 0.80.8 (2026-07-16) removed the
 * root `AuthStorage` export, so a fresh `npm install -g` resolves a pi that
 * crashes `katacode serve` at module load and the sandbox never becomes ready.
 * Pinning the whole trio in one install command makes npm dedupe the CLI's
 * `^0.80.0` ranges to this build. Remove once a CLI built against the new pi
 * API is published.
 */
export const PI_SDK_PIN = "0.80.2";

/**
 * Provider CLIs installed at bootstrap. Mirrors the Dockerfile install list so
 * a runtime-booted sandbox matches the provider-ready Phase 3a image.
 */
export const PROVIDER_CLI_PACKAGES: ReadonlyArray<string> = [
  KATA_CLI_PACKAGE,
  "@openai/codex",
  "@anthropic-ai/claude-code",
  "opencode-ai",
  "@xai-official/grok",
  // Pinned (see PI_SDK_PIN): an unpinned spec in the same install command
  // would defeat the dedupe pin the kata CLI depends on.
  `@earendil-works/pi-coding-agent@${PI_SDK_PIN}`,
];

/** Transitive kata CLI dependencies pinned to the same pi build so npm
 *  dedupes the CLI's `^0.80.0` ranges instead of resolving latest. */
export const KATA_CLI_DEPENDENCY_PINS: ReadonlyArray<string> = [
  `@earendil-works/pi-ai@${PI_SDK_PIN}`,
  `@earendil-works/pi-agent-core@${PI_SDK_PIN}`,
];

/** Install GitHub CLI from its official RPM repository on Amazon Linux 2023.
 * Live-verified in a Vercel `node24` sandbox on 2026-07-10. */
export function buildGitHubCliInstallScript(): string {
  return [
    "sudo dnf install -y 'dnf-command(config-manager)'",
    "sudo dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo",
    "sudo dnf install -y gh",
    "gh --version",
  ].join(" && ");
}

/**
 * Build the bootstrap script run after a runtime provision. Creates
 * `SANDBOX_HOME` owned by the current user (with a no-sudo fallback for
 * runtimes where sudo is unavailable), installs native-addon build tools
 * (python3, make, gcc-c++ — needed by node-pty's node-gyp build), then installs
 * the katacode CLI plus provider CLIs. Echoes stage markers so failures are
 * attributable in stderr.
 *
 * Skipped when booting from a snapshot (the snapshot already has the CLIs).
 */
export function buildBootstrapScript(): string {
  // Allow pinning the kata CLI to a specific npm dist-tag via
  // KATACODE_SANDBOX_CLI_TAG env var set on the sandbox runtime env.
  // During local dev, set this to "nightly" to use the development build
  // published from your branch.  Falls back to npm latest when unset.
  // The shell expression ${KATACODE_SANDBOX_CLI_TAG:+@}${KATACODE_SANDBOX_CLI_TAG}
  // expands to @nightly when the var is set, empty otherwise.
  const tagSuffix = "${KATACODE_SANDBOX_CLI_TAG:+@}${KATACODE_SANDBOX_CLI_TAG}";
  const kataSpec = `${KATA_CLI_PACKAGE}${tagSuffix}`;
  const packagesSpec = PROVIDER_CLI_PACKAGES.map((p) =>
    p === KATA_CLI_PACKAGE ? kataSpec : p,
  ).join(" ");
  return [
    "set -e",
    `echo "[kata:bootstrap] creating ${SANDBOX_HOME}"`,
    `(sudo mkdir -p ${SANDBOX_HOME} && sudo chown "$(id -u):$(id -g)" ${SANDBOX_HOME}) || mkdir -p ${SANDBOX_HOME}`,
    `echo "[kata:bootstrap] installing native build tools"`,
    // Amazon Linux 2023 (Vercel sandbox runtime) uses dnf. node-pty needs
    // python3 + make + gcc-c++ for node-gyp to compile its native addon.
    `sudo dnf install -y python3 make gcc-c++ || true`,
    `echo "[kata:bootstrap] installing GitHub CLI"`,
    buildGitHubCliInstallScript(),
    `echo "[kata:bootstrap] installing CLIs"`,
    `npm install -g ${packagesSpec} ${KATA_CLI_DEPENDENCY_PINS.join(" ")}`,
    `echo "[kata:bootstrap] done"`,
  ].join(" && ");
}

/** Escape a value for single-quote wrapping in a shell command. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Best-effort kill of any prior `katacode serve` on the sandbox port.
 * Used by lifecycle start so a fresh bootstrap token is not exchanged against
 * a leftover process that still owns `/oauth/token`. The `[k]` pattern avoids
 * matching the pkill argv itself. Waits briefly for the port to free before
 * returning so the subsequent serve launch binds cleanly.
 */
export function buildKillServeCommand(port: number): string {
  return [
    `(pkill -9 -f '[k]atacode serve --port ${port}' 2>/dev/null || true)`,
    // Up to ~5s for the old listener to release the port.
    `for i in 1 2 3 4 5 6 7 8 9 10; do (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | grep -q ':${port} ' || break; sleep 0.5; done`,
    // Fail if the port is still occupied so callers can detect a stuck listener.
    `! ((ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | grep -q ':${port} ')`,
  ].join("; ");
}

/**
 * Kill any prior serve on the port, wait for the listener to drop, then launch
 * detached `katacode serve` with the fresh bootstrap env — single shell so the
 * relaunch cannot race a leftover process between separate runCommands.
 */
export function buildReplaceServeCommand(input: {
  readonly port: number;
  readonly env: ReadonlyArray<readonly [string, string]>;
}): string {
  return `${buildKillServeCommand(input.port)}; ${buildServeCommand(input)}`;
}

/** Serve stdout/stderr log inside the sandbox; tailed on readiness-timeout errors. */
export const SERVE_LOG_PATH = "/tmp/katacode-serve.log";

/**
 * Build the detached `katacode serve` launch command. Env is inlined at launch
 * (not baked at create) so resume can restart with a fresh bootstrap token.
 * Output is redirected to SERVE_LOG_PATH for diagnostics.
 */
export function buildServeCommand(input: {
  readonly port: number;
  readonly env: ReadonlyArray<readonly [string, string]>;
}): string {
  const envPrefix = [
    `HOME=${SANDBOX_HOME}`,
    ...input.env.map(([k, v]) => `${k}=${shellSingleQuote(v)}`),
  ].join(" ");
  return `nohup env ${envPrefix} katacode serve --port ${input.port} > ${SERVE_LOG_PATH} 2>&1 &`;
}
