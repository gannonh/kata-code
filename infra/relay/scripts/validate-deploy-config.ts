#!/usr/bin/env node

import {
  RELAY_DEPLOY_SECRET_NAMES,
  RELAY_DEPLOY_VARIABLE_NAMES,
  resolveRelayDeployConfig,
  resolveRelayDeploySmokeConfig,
} from "./deploy-config.ts";
import { mergedRelayEnv, readRelayEnv } from "./relay-env.ts";

const includeSmoke = process.argv.includes("--include-smoke");
const env = mergedRelayEnv();
const status = resolveRelayDeployConfig(
  readRelayEnv(RELAY_DEPLOY_VARIABLE_NAMES, env),
  readRelayEnv(RELAY_DEPLOY_SECRET_NAMES, env),
);
const missingSmokeVariables = includeSmoke ? resolveRelayDeploySmokeConfig(env) : [];

if (status.ready && missingSmokeVariables.length === 0) {
  process.stdout.write("Relay production deploy configuration is complete.\n");
  process.exit(0);
}

if (status.missingVariables.length > 0) {
  process.stderr.write(
    `Missing required relay deploy variables: ${status.missingVariables.join(", ")}\n`,
  );
}
if (status.missingSecrets.length > 0) {
  process.stderr.write(
    `Missing required relay deploy secrets: ${status.missingSecrets.join(", ")}\n`,
  );
}
if (missingSmokeVariables.length > 0) {
  process.stderr.write(
    `Missing required relay deploy smoke variables: ${missingSmokeVariables.join(", ")}\n`,
  );
}
process.exit(1);
