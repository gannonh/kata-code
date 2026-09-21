// Tests spawn git through node:child_process, bypassing the scrub the driver applies to its own spawns.
import { GIT_REPOSITORY_ENV_VARS } from "../git.ts";

for (const name of GIT_REPOSITORY_ENV_VARS) {
  delete process.env[name];
}
