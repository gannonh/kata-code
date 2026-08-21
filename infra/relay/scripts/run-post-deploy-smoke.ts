#!/usr/bin/env node

import { verifyRelayPublicEndpoints } from "./post-deploy-smoke.ts";

const relayUrl = process.env.RELAY_URL?.trim();
if (!relayUrl) {
  process.stderr.write("Missing required environment variable: RELAY_URL.\n");
  process.exit(1);
}

verifyRelayPublicEndpoints(relayUrl)
  .then((summary) => {
    if (!summary.ok) {
      const failures = summary.results
        .filter((result) => !result.ok)
        .map((result) => `${result.path} (${result.status})`)
        .join(", ");
      process.stderr.write(`Relay public smoke failed: ${failures}\n`);
      process.exit(1);
    }
    process.stdout.write(
      `Relay public smoke passed for ${summary.relayUrl} (${summary.results.length} endpoints).\n`,
    );
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Relay public smoke failed: ${message}\n`);
    process.exit(1);
  });
