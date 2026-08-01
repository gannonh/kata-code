import { createHash } from "node:crypto";

import type { TaskWorkspaceCommand } from "@kata-sh/code-contracts";

/**
 * Transport metadata that never participates in a semantic digest. `commandId`
 * is the transport identity and `createdAt` is transport metadata; the server
 * drives audit time and resolved actor itself.
 */
const TRANSPORT_ONLY_KEYS = new Set(["commandId", "createdAt"]);

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).toSorted()) {
      if (TRANSPORT_ONLY_KEYS.has(key)) continue;
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Canonical SHA-256 digest of a task command's semantic payload.
 *
 * Two commands that name the same semantic operation with the same payload must
 * hash identically regardless of their `commandId` or `createdAt`. The server
 * uses this digest to detect a replayed retry (same digest, replay the stored
 * outcome) versus a payload conflict (same key, different digest).
 */
export function canonicalTaskCommandDigest(command: TaskWorkspaceCommand): string {
  const canonical = sortKeys(command);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
