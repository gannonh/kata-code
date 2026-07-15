import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";

/**
 * Apply repo-root `.env` / `.env.local` into `targetEnv`.
 *
 * Keys present in those files win over ambient shell exports so local E2E
 * configuration in `.env` is authoritative (`.env.local` overrides `.env`).
 * Keys only present in the ambient env are left unchanged.
 *
 * `loadRepoEnv()` alone keeps process/shell last, which makes a stale
 * `export KATACODE_E2E_PI_MODEL=…` override the value in `.env`. E2E must not
 * do that: the file the operator edits is the source of truth.
 */
export function applyE2ERepoEnv(
  targetEnv: NodeJS.ProcessEnv = process.env,
  options?: { readonly repoRoot?: string },
): void {
  const fileEnv = loadRepoEnv({
    baseEnv: {},
    ...(options?.repoRoot !== undefined ? { repoRoot: options.repoRoot } : {}),
  });
  for (const [key, value] of Object.entries(fileEnv)) {
    if (value !== undefined) {
      targetEnv[key] = value;
    }
  }
}

applyE2ERepoEnv();
