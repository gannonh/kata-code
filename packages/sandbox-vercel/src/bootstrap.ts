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
 * Provider CLIs installed at bootstrap. Mirrors the Dockerfile install list so
 * a runtime-booted sandbox matches the provider-ready Phase 3a image.
 */
export const PROVIDER_CLI_PACKAGES: ReadonlyArray<string> = [
  KATA_CLI_PACKAGE,
  "@openai/codex",
  "@anthropic-ai/claude-code",
  "opencode-ai",
  "@xai-official/grok",
  "@earendil-works/pi-coding-agent",
];

/**
 * Build the bootstrap script run after a runtime provision. Creates
 * `SANDBOX_HOME` owned by the current user (with a no-sudo fallback for
 * runtimes where sudo is unavailable) and installs the katacode CLI plus
 * provider CLIs. Echoes stage markers so failures are attributable in stderr.
 *
 * Skipped when booting from a snapshot (the snapshot already has the CLIs).
 */
export function buildBootstrapScript(): string {
  const packages = PROVIDER_CLI_PACKAGES.join(" ");
  return [
    "set -e",
    `echo "[kata:bootstrap] creating ${SANDBOX_HOME}"`,
    `(sudo mkdir -p ${SANDBOX_HOME} && sudo chown "$(id -u):$(id -g)" ${SANDBOX_HOME}) || mkdir -p ${SANDBOX_HOME}`,
    `echo "[kata:bootstrap] installing CLIs"`,
    `npm install -g ${packages}`,
    `echo "[kata:bootstrap] done"`,
  ].join(" && ");
}

/** Escape a value for single-quote wrapping in a shell command. */
function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the detached `katacode serve` launch command. Env is inlined at launch
 * (not baked at create) so resume can restart with a fresh bootstrap token.
 * Output is redirected to `/tmp/katacode-serve.log` for diagnostics.
 */
export function buildServeCommand(input: {
  readonly port: number;
  readonly env: ReadonlyArray<readonly [string, string]>;
}): string {
  const envPrefix = [
    `HOME=${SANDBOX_HOME}`,
    ...input.env.map(([k, v]) => `${k}=${shellSingleQuote(v)}`),
  ].join(" ");
  return `nohup env ${envPrefix} katacode serve --port ${input.port} > /tmp/katacode-serve.log 2>&1 &`;
}
