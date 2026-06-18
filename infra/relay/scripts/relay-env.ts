#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Relay bootstrap scripts load dotenv before Effect exists.

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const RELAY_ROOT = NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)));

export const RELAY_ENV_FILE = NodePath.join(RELAY_ROOT, ".env");

export function loadRelayEnvFile(
  path: string = RELAY_ENV_FILE,
): Record<string, string | undefined> {
  if (!NodeFS.existsSync(path)) {
    return {};
  }
  return NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8"));
}

export function readRelayEnv(
  names: ReadonlyArray<string>,
  source: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(names.map((name) => [name, source[name]]));
}

export function mergedRelayEnv(path: string = RELAY_ENV_FILE): Record<string, string | undefined> {
  return {
    ...loadRelayEnvFile(path),
    ...process.env,
  };
}
