/**
 * Read the last upstream scan baseline from FORK.md.
 *
 * Prefers the Step 3 `Upstream tip SHA:` field; falls back to the legacy
 * bulk-merge `Upstream SHA:` line for older FORK.md entries.
 */

// @effect-diagnostics nodeBuiltinImport:off
import { readFileSync } from "node:fs";

const UPSTREAM_TIP_SHA_PATTERN = /^Upstream tip SHA:\s*([0-9a-f]{7,40})/m;
const LEGACY_UPSTREAM_SHA_PATTERN = /^Upstream SHA:\s*([0-9a-f]{7,40})/m;

export function readLastSyncBaseline(forkMdPath: string): string | undefined {
  let content: string;
  try {
    content = readFileSync(forkMdPath, "utf8");
  } catch {
    return undefined;
  }
  return (
    content.match(UPSTREAM_TIP_SHA_PATTERN)?.[1] ?? content.match(LEGACY_UPSTREAM_SHA_PATTERN)?.[1]
  );
}
