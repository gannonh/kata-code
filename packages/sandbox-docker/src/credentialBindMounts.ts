/**
 * Phase 3a host-credential bind-mount declarations for the local Docker driver.
 *
 * The local Docker driver bind-mounts the host's provider credential
 * directories into the container so a sandbox session reuses the user's
 * existing OAuth/API-key state (the same `~/.codex`, `~/.claude`,
 * `~/.config/opencode` the user already has on their laptop) without copying
 * credentials. A host dir that does not exist is skipped (the provider starts
 * unauthenticated and surfaces its normal error); a host dir that exists but
 * is empty is mounted normally.
 *
 * `~/.claude.json` is a file at home root, not inside `~/.claude`, so it is
 * mounted separately (AgentBox pattern). Claude Code writes to `~/.claude` and
 * `~/.claude.json` at runtime (skills, plugins, session state, auth refresh),
 * so both are read-write. Codex and OpenCode config dirs are read-only on the
 * host side; the container owns its own runtime writes under those paths via
 * the driver's `HOME=/home/katacode` layout.
 *
 * `CODEX_HOME` (set by the sandbox instance env or saved-env secret path)
 * overrides the Codex bind-mount target: when set to a shadow home, the host
 * `~/.codex` is mounted at that path instead of the default `/home/katacode/.codex`.
 *
 * @module credentialBindMounts
 */

/** A single bind-mount declaration. */
export interface CredentialBindMount {
  /** Absolute host path to mount from. */
  readonly source: string;
  /** Absolute in-container path to mount at. */
  readonly target: string;
  /** Whether the mount is read-only. */
  readonly readOnly: boolean;
}

/** Input the driver assembles to build the credential bind-mount list. */
export interface CredentialBindMountInput {
  /** Absolute host home directory (e.g. `/Users/foo` or `/home/foo`). */
  readonly hostHome: string;
  /** Absolute in-container home directory (the image's `HOME`, e.g. `/home/katacode`). */
  readonly containerHome: string;
  /** Container env tuples already materialized with secrets (instance + saved env). */
  readonly env: ReadonlyArray<readonly [string, string]>;
  /**
   * Predicate the driver supplies to test whether a host path exists. The
   * driver uses `fs.existsSync` in production; tests inject a set-backed stub.
   * Exists-but-empty returns true (the mount proceeds); absent returns false
   * (the mount is skipped).
   */
  readonly hostPathExists: (path: string) => boolean;
}

/** Resolve a non-empty env value, or `undefined` when unset/blank. */
function envValue(env: ReadonlyArray<readonly [string, string]>, name: string): string | undefined {
  for (const [k, v] of env) {
    if (k === name) {
      const trimmed = v.trim();
      return trimmed.length > 0 ? v : undefined;
    }
  }
  return undefined;
}

/**
 * Build the host-credential bind-mount list for a sandbox provision. Mounts are
 * ordered Claude dir, Claude json, Codex, OpenCode for deterministic output;
 * absent host paths are skipped. The Codex target follows `CODEX_HOME` when set.
 */
export function buildCredentialBindMounts(input: CredentialBindMountInput): CredentialBindMount[] {
  const mounts: CredentialBindMount[] = [];

  const claudeDirSource = `${input.hostHome}/.claude`;
  if (input.hostPathExists(claudeDirSource)) {
    mounts.push({
      source: claudeDirSource,
      target: `${input.containerHome}/.claude`,
      readOnly: false,
    });
  }

  const claudeJsonSource = `${input.hostHome}/.claude.json`;
  if (input.hostPathExists(claudeJsonSource)) {
    mounts.push({
      source: claudeJsonSource,
      target: `${input.containerHome}/.claude.json`,
      readOnly: false,
    });
  }

  const codexSource = `${input.hostHome}/.codex`;
  if (input.hostPathExists(codexSource)) {
    const codexHome = envValue(input.env, "CODEX_HOME");
    mounts.push({
      source: codexSource,
      target: codexHome ?? `${input.containerHome}/.codex`,
      readOnly: true,
    });
  }

  const opencodeSource = `${input.hostHome}/.config/opencode`;
  if (input.hostPathExists(opencodeSource)) {
    mounts.push({
      source: opencodeSource,
      target: `${input.containerHome}/.config/opencode`,
      readOnly: true,
    });
  }

  return mounts;
}
