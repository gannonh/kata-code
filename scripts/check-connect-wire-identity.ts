#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const CONNECT_WIRE_SCAN_FILES = [
  ".env.example",
  "FORK.md",
  "docs/internals/t3-connect.md",
  "docs/internals/t3-code-connect-auth-flow.html",
  "docs/operations/relay-observability.md",
  "infra/relay/.env.example",
  "packages/contracts/src/environmentHttp.ts",
  "packages/contracts/src/relay.ts",
  "packages/shared/src/relayJwt.ts",
  "packages/client-runtime/src/environment/descriptor.ts",
  "packages/tailscale/src/tailscale.ts",
  "apps/server/src/cli/pair.ts",
  "apps/server/src/cloud/http.ts",
  "apps/server/src/relay/AgentAwarenessRelay.ts",
  "apps/desktop/src/backend/DesktopBackendManager.ts",
  "apps/mobile/src/features/cloud/managedRelayTokenStore.ts",
  "apps/mobile/src/features/showcase/showcaseEnvironmentRows.ts",
  "apps/web/src/cloud/managedRelayLayer.ts",
  "infra/relay/src/auth/RelayTokens.ts",
  "infra/relay/src/observability.ts",
  "infra/relay/src/db.ts",
  "infra/relay/src/deploymentConfig.ts",
  "infra/relay/src/environments/EnvironmentConnector.ts",
  "infra/relay/src/environments/EnvironmentLinker.ts",
  "infra/relay/src/environments/EnvironmentPublishSignatures.ts",
] as const;

export const STALE_CONNECT_WIRE_LITERALS = [
  "t3_relay",
  "t3-mobile",
  "t3-web",
  "t3-env:",
  "t3-cloud-mint+jwt",
  "t3-cloud-health+jwt",
  "t3-env-mint+jwt",
  "t3-env-health+jwt",
  "t3-env-activity+jwt",
  "t3-link-challenge+jwt",
  "t3-relay-dpop-access+jwt",
  "/.well-known/t3/environment",
  "/api/t3-connect",
  "t3-relay",
  "t3-code-relay",
] as const;

export interface ConnectWireViolation {
  readonly path: string;
  readonly line: number;
  readonly literal: string;
}

export function findConnectWireViolations(
  files: ReadonlyArray<readonly [path: string, contents: string]>,
): ReadonlyArray<ConnectWireViolation> {
  const violations: ConnectWireViolation[] = [];
  for (const [path, contents] of files) {
    contents.split("\n").forEach((line, index) => {
      for (const literal of STALE_CONNECT_WIRE_LITERALS) {
        if (line.includes(literal)) {
          violations.push({ path, line: index + 1, literal });
        }
      }
    });
  }
  return violations;
}

export function scanConnectWireFiles(
  repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url))),
) {
  return findConnectWireViolations(
    CONNECT_WIRE_SCAN_FILES.map(
      (path) => [path, readFileSync(resolve(repoRoot, path), "utf8")] as const,
    ),
  );
}

if (import.meta.main) {
  const violations = scanConnectWireFiles();
  if (violations.length > 0) {
    for (const violation of violations) {
      process.stderr.write(
        `${violation.path}:${violation.line}: stale Connect wire literal ${JSON.stringify(violation.literal)}\n`,
      );
    }
    process.exit(1);
  }
  process.stdout.write(`Connect wire scan passed (${CONNECT_WIRE_SCAN_FILES.length} files).\n`);
}
