import { GIT_REPOSITORY_ENV_VARS } from "../git.ts";

const TEST_ENV_VARS = [...GIT_REPOSITORY_ENV_VARS, "T3_SERVICE_LAUNCHER_CONTEXT"] as const;

for (const name of TEST_ENV_VARS) {
  delete process.env[name];
}
