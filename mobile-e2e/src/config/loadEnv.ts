import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";

/* oxlint-disable kata-code/no-global-process-runtime -- Local E2E CLI loads .env into process.env. */

/**
 * Merge repo `.env` / `.env.local` into process.env so local-only credentials
 * (Clerk, provider keys) are available to prerequisite checks.
 *
 * File-defined keys win over ambient shell exports (same rule as desktop E2E
 * `applyE2ERepoEnv`) so values in `.env` are authoritative. Called explicitly
 * from main() rather than as a side-effect import, so importing `run.ts` for
 * tests does not silently mutate process.env.
 */
export function loadEnv(): void {
  const fileEnv = loadRepoEnv({ baseEnv: {} });
  for (const [key, value] of Object.entries(fileEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}
