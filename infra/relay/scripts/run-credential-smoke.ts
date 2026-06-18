#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay bootstrap scripts load dotenv before Effect exists.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import {
  RELAY_DEPLOY_SECRET_NAMES,
  RELAY_DEPLOY_VARIABLE_NAMES,
  resolveRelayDeployConfig,
  resolveRelayDeploySmokeConfig,
} from "./deploy-config.ts";
import { runCredentialSmoke } from "./credential-smoke.ts";

const RELAY_ROOT = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));
const ENV_FILE = NodePath.join(RELAY_ROOT, ".env");

function loadRelayEnvFile(path: string): Record<string, string | undefined> {
  if (!NodeFS.existsSync(path)) {
    return {};
  }
  return NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8"));
}

function readEnv(
  names: ReadonlyArray<string>,
  source: Readonly<Record<string, string | undefined>>,
) {
  return Object.fromEntries(names.map((name) => [name, source[name]]));
}

const env = {
  ...loadRelayEnvFile(ENV_FILE),
  ...process.env,
};

const configStatus = resolveRelayDeployConfig(
  readEnv(RELAY_DEPLOY_VARIABLE_NAMES, env),
  readEnv(RELAY_DEPLOY_SECRET_NAMES, env),
);

if (!configStatus.ready) {
  process.stderr.write(
    `Missing relay deploy config in ${ENV_FILE}: ${[
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
