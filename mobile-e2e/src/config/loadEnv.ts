import { loadRepoEnv } from "../../../scripts/lib/public-config.ts";

/* oxlint-disable kata-code/no-global-process-runtime -- Local E2E CLI loads .env into process.env. */

// Side-effect import: merge repo .env / .env.local into process.env so local-only
// credentials (Clerk, provider keys) are available to prerequisite checks.
Object.assign(process.env, loadRepoEnv());
