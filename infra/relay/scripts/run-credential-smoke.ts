#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay bootstrap scripts load dotenv before Effect exists.

import {
  RELAY_DEPLOY_SECRET_NAMES,
  RELAY_DEPLOY_VARIABLE_NAMES,
  resolveRelayDeployConfig,
  resolveRelayDeploySmokeConfig,
} from "./deploy-config.ts";
import { runCredentialSmoke } from "./credential-smoke.ts";
import { mergedRelayEnv, readRelayEnv } from "./relay-env.ts";

const env = mergedRelayEnv();

const configStatus = resolveRelayDeployConfig(
  readRelayEnv(RELAY_DEPLOY_VARIABLE_NAMES, env),
  readRelayEnv(RELAY_DEPLOY_SECRET_NAMES, env),
);

if (!configStatus.ready) {
  process.stderr.write(
    `Missing relay deploy config in infra/relay/.env: ${[
      ...configStatus.missingVariables,
      ...configStatus.missingSecrets,
    ].join(", ")}\n`,
  );
  process.exit(1);
}

const missingSmoke = resolveRelayDeploySmokeConfig(env);
if (missingSmoke.length > 0) {
  process.stderr.write(`Missing relay smoke config: ${missingSmoke.join(", ")}\n`);
  process.exit(1);
}

runCredentialSmoke(env)
  .then((summary) => {
    for (const result of summary.results) {
      const line = `${result.ok ? "pass" : "fail"} ${result.name}: ${result.detail}\n`;
      if (result.ok) {
        process.stdout.write(line);
      } else {
        process.stderr.write(line);
      }
    }
    if (!summary.ok) {
      process.exit(1);
    }
    process.stdout.write("Relay credential smoke passed.\n");
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Relay credential smoke failed: ${message}\n`);
    process.exit(1);
  });
