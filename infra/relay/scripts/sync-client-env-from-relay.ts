#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay bootstrap scripts load dotenv before Effect exists.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { RELAY_CLIENT_ENV_MAPPINGS } from "./deploy-config.ts";
import { upsertEnvValue } from "./env-file.ts";
import { loadRelayEnvFile } from "./relay-env.ts";
import { resolveRelayPublicUrl } from "../src/deploymentConfig.ts";

const REPO_ROOT = NodePath.dirname(
  NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url))),
);
const RELAY_ENV_FILE = NodePath.join(REPO_ROOT, "infra/relay/.env");
const ROOT_ENV_FILE = NodePath.join(REPO_ROOT, ".env");

const relayEnv = loadRelayEnvFile(RELAY_ENV_FILE);
const relayUrl = resolveRelayPublicUrl({
  relayDomain: relayEnv.RELAY_DOMAIN,
  relayApiZoneName: relayEnv.RELAY_API_ZONE_NAME,
});

let contents = NodeFS.existsSync(ROOT_ENV_FILE) ? NodeFS.readFileSync(ROOT_ENV_FILE, "utf8") : "";

for (const mapping of RELAY_CLIENT_ENV_MAPPINGS) {
  const value = relayEnv[mapping.source]?.trim();
  if (!value) {
    continue;
  }
  contents = upsertEnvValue(contents, mapping.target, value);
}

if (relayUrl) {
  contents = upsertEnvValue(contents, "KATACODE_RELAY_URL", relayUrl);
}

NodeFS.writeFileSync(ROOT_ENV_FILE, contents);
process.stdout.write(`Updated ${ROOT_ENV_FILE} from ${RELAY_ENV_FILE}.\n`);
