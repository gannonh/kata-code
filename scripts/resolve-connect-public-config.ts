#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Release bootstrap writes GitHub Actions output before an Effect runtime exists.

import * as NodeFS from "node:fs";

import {
  maskConnectPublicConfigLogs,
  resolveConnectPublicConfig,
  serializeConnectPublicConfigGithubOutput,
} from "./lib/connect-public-config.ts";

const requireConnectConfig = process.env.REQUIRE_CONNECT_CONFIG === "true";
const resolution = resolveConnectPublicConfig({
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  clerkJwtTemplate: process.env.CLERK_JWT_TEMPLATE,
  clerkCliOAuthClientId: process.env.CLERK_CLI_OAUTH_CLIENT_ID,
  relayUrl: process.env.RELAY_URL,
  relayClientOtlpTracesUrl: process.env.KATACODE_RELAY_CLIENT_OTLP_TRACES_URL,
  relayClientOtlpTracesDataset: process.env.KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET,
  relayClientOtlpTracesToken: process.env.KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN,
});

if (!resolution.ok) {
  if (requireConnectConfig) {
    process.stderr.write(
      `Missing required Kata Code Connect public config: ${resolution.missing.join(", ")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `Optional Kata Code Connect public config incomplete (${resolution.missing.join(", ")}).\n`,
  );
  process.exit(0);
}

for (const line of maskConnectPublicConfigLogs(resolution.config)) {
  process.stdout.write(`${line}\n`);
}

const githubOutputPath = process.env.GITHUB_OUTPUT?.trim();
if (githubOutputPath) {
  NodeFS.appendFileSync(
    githubOutputPath,
    `${serializeConnectPublicConfigGithubOutput(resolution.config)}\n`,
  );
}

process.stdout.write("Resolved Kata Code Connect public config for release builds.\n");
