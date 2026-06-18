#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - Root wrapper delegates to relay bootstrap script.

import { spawnSync } from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const script = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../infra/relay/scripts/sync-client-env-from-relay.ts",
);

const result = spawnSync(process.execPath, [script], { stdio: "inherit" });
process.exit(result.status ?? 1);
