import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";

/* oxlint-disable kata-code/no-global-process-runtime -- Local E2E CLI loads .env into process.env. */

/**
 * Merge repo .env / .env.local into process.env so local-only credentials (Clerk,
 * provider keys) are available to prerequisite checks. Called explicitly from
 * main() rather than as a side-effect import, so importing `run.ts` for tests
 * does not silently mutate process.env.
 */
export function loadEnv(): void {
  Object.assign(process.env, loadRepoEnv());
}
