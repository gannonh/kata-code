import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";

const PI_UPDATE_VERIFICATION_ENV = "KATACODE_E2E_PI_UPDATE_VERIFICATION";
const PI_UPDATE_VERIFICATION_VALUES = new Set([
  "KATACODE_E2E_ENABLE_PI",
  "KATACODE_E2E_PI_AGENT_DIR",
  "KATACODE_E2E_PI_MODEL",
]);

/**
 * Apply repo-root `.env` / `.env.local` into `targetEnv`.
 *
 * Keys present in those files win over ambient shell exports so local E2E
 * configuration in `.env` is authoritative (`.env.local` overrides `.env`).
 * Keys only present in the ambient env are left unchanged. Pi update
 * verification preserves its three ambient Pi values so the maintainer gate
 * controls the credentialed run.
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
  const isPiUpdateVerification = targetEnv[PI_UPDATE_VERIFICATION_ENV] === "1";
  for (const [key, value] of Object.entries(fileEnv)) {
    if (
      value !== undefined &&
      !(isPiUpdateVerification && PI_UPDATE_VERIFICATION_VALUES.has(key))
    ) {
      targetEnv[key] = value;
    }
  }
}

applyE2ERepoEnv();
