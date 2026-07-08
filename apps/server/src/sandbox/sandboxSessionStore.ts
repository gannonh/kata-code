/**
 * `SandboxSessionStore` — durable persistence for sandbox session records.
 *
 * Replaces the Phase 1 in-memory `runningSessions` map as the source of truth
 * so a Kata server restart can reclaim running/stopped sandboxes. Persists JSON
 * at `<katacodeHome>/userdata/sandbox-sessions.json` (respects `KATACODE_HOME`),
 * matching the existing `userdata/` layout. Atomic write-on-change (temp file +
 * rename). Schema-validated on load; invalid entries are evicted with a
 * warning log.
 *
 * The store holds only non-secret handle state: sandbox name, ports, domain,
 * persistence flag, environment id, endpoint, status, relay linkage. The
 * Vercel auth trio is **not** stored; it re-resolves from instance config env
 * on load (the server re-injects it via `mergeVercelAuthIntoConfig` before
 * reconcile).
 *
 * @module sandboxSessionStore
 */
// @effect-diagnostics nodeBuiltinImport:off - atomic file write via node:fs/promises + node:path; no Effect FileSystem service.
// @effect-diagnostics globalDateInEffect:off - temp file naming uses Date.now for uniqueness; no Effect Clock in this utility.
// @effect-diagnostics globalErrorInEffectCatch:off - the store returns a plain Error for file I/O failures (simple utility, not a tagged-error boundary).
// @effect-diagnostics globalErrorInEffectFailure:off - same: plain Error for file I/O failures.
// @effect-diagnostics preferSchemaOverJson:off - the store file is an opaque JSON blob validated by Schema on load; JSON.parse/stringify are the raw file I/O layer.
// @effect-diagnostics globalConsole:off - per-entry eviction and corrupt-file warnings use console in a non-Effect decode utility.
import * as NodeFs from "node:fs/promises";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { AdvertisedEndpoint } from "@kata-sh/code-contracts";
import type { SandboxProviderInstanceId } from "@kata-sh/code-contracts/sandboxProviderInstance";

/** Opaque driver handle state (non-secret, serializable). */
export const SandboxStoredHandle = Schema.Struct({
  /** Driver kind that owns the handle (routes reconcile/dispose). */
  driverKind: Schema.String,
  /** Driver-defined opaque state (container id/name, sandbox name, ports, …). */
  handle: Schema.Unknown,
});
export type SandboxStoredHandle = typeof SandboxStoredHandle.Type;

/** Relay link info for unlinking on dispose. Only the relay URL is stored;
 *  the bearer token is a secret and is re-resolved at dispose time via
 *  `resolveConnectAuthToken`. */
export const SandboxStoredRelay = Schema.Struct({
  relayUrl: Schema.String,
});
export type SandboxStoredRelay = typeof SandboxStoredRelay.Type;

/** A persisted sandbox session record. */
export const SandboxSessionRecord = Schema.Struct({
  instanceId: Schema.String,
  /** Driver kind (routes reconcile/dispose to the right driver). */
  driverKind: Schema.String,
  /** Server environment id (the configured deployment target id). */
  environmentId: Schema.String,
  /** The in-sandbox Kata server's environment id. */
  sandboxEnvironmentId: Schema.String,
  handle: SandboxStoredHandle,
  endpoint: Schema.Unknown,
  /** Lifecycle status: `running` or `stopped`. */
  status: Schema.Literals(["running", "stopped"]),
  /** Reconcile warning (e.g. auth missing on boot). */
  statusDetail: Schema.optional(Schema.String),
  relay: Schema.optional(SandboxStoredRelay),
  /** Host-side deadline (epoch ms) the keepalive scheduler maintains. */
  deadlineEpochMs: Schema.optional(Schema.Number),
});
export type SandboxSessionRecord = typeof SandboxSessionRecord.Type;

const SandboxSessionStoreFile = Schema.Struct({
  records: Schema.Array(SandboxSessionRecord),
});
type SandboxSessionStoreFile = typeof SandboxSessionStoreFile.Type;

// Hoist compiled schema function to module scope (kata-code/no-inline-schema-compile).
const decodeSandboxSessionRecord = Schema.decodeUnknownSync(SandboxSessionRecord);

/** Resolve the store file path under the katacode home `userdata/` dir. */
function storeFilePath(katacodeHome: string): string {
  return NodePath.join(katacodeHome, "userdata", "sandbox-sessions.json");
}

/** Atomic write: serialize to a temp file in the same dir, then rename. */
function atomicWriteFile(filePath: string, contents: string): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: async () => {
      const dir = NodePath.dirname(filePath);
      await NodeFs.mkdir(dir, { recursive: true });
      const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      await NodeFs.writeFile(tmp, contents, "utf8");
      await NodeFs.rename(tmp, filePath);
    },
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  });
}

/** A durable sandbox session store backed by a JSON file. */
export interface SandboxSessionStore {
  /** Load all records (schema-validated; invalid entries evicted + logged). */
  load(): Effect.Effect<ReadonlyArray<SandboxSessionRecord>, Error>;
  /** Replace the full record set (atomic write). */
  save(records: ReadonlyArray<SandboxSessionRecord>): Effect.Effect<void, Error>;
  /** Read + upsert one record by instance id, then save. */
  upsert(record: SandboxSessionRecord): Effect.Effect<void, Error>;
  /** Remove a record by instance id, then save. No-op when absent. */
  remove(instanceId: SandboxProviderInstanceId): Effect.Effect<void, Error>;
  /** Read the current records without re-loading from disk. */
  readonly records: ReadonlyArray<SandboxSessionRecord>;
}

/** Decode + validate a store file payload, evicting invalid records
 *  individually with a warning log (per-entry eviction, not all-or-nothing). */
function decodeStore(raw: unknown): ReadonlyArray<SandboxSessionRecord> {
  if (raw === null || typeof raw !== "object") return [];
  const recordsRaw = (raw as { records?: unknown }).records;
  if (!Array.isArray(recordsRaw)) return [];
  const valid: SandboxSessionRecord[] = [];
  for (const entry of recordsRaw) {
    try {
      valid.push(decodeSandboxSessionRecord(entry));
    } catch (error) {
      // Per-entry eviction: log the evicted record so operators can see data loss.
      const id =
        entry !== null && typeof entry === "object" && "instanceId" in entry
          ? String((entry as { instanceId: unknown }).instanceId)
          : "<unknown>";
      // console.warn is appropriate here (non-Effect context, same as the
      // corrupt-JSON case above which uses Effect.logWarning).
      // @effect-diagnostics-next-line effect(globalConsole):off - per-entry eviction log in a non-Effect decode utility.
      console.warn(
        `[kata:sandbox-store] evicted invalid session record for instance "${id}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return valid;
}

/**
 * Create a sandbox session store backed by `<katacodeHome>/userdata/sandbox-sessions.json`.
 * The store loads lazily on first access and caches records in memory; `save`
 * persists atomically and updates the cache.
 */
export function makeSandboxSessionStore(katacodeHome: string): SandboxSessionStore {
  const filePath = storeFilePath(katacodeHome);
  let cached: ReadonlyArray<SandboxSessionRecord> | null = null;

  const loadOnce = Effect.gen(function* () {
    if (cached !== null) return cached;
    const raw = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await NodeFs.readFile(filePath, "utf8");
        } catch (error) {
          // A missing store file is the initial state (no sessions yet).
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw error;
        }
      },
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    });
    if (raw === null) {
      cached = [];
      return cached;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      // Corrupt JSON: start empty rather than crashing the server.
      yield* Effect.logWarning("Sandbox session store JSON is corrupt; starting empty", {
        path: filePath,
      });
      cached = [];
      return cached;
    }
    const decoded = decodeStore(parsed);
    cached = decoded;
    return cached;
  });

  const persist = (records: ReadonlyArray<SandboxSessionRecord>) =>
    Effect.gen(function* () {
      const file: SandboxSessionStoreFile = { records: [...records] };
      yield* atomicWriteFile(filePath, JSON.stringify(file, null, 2));
      cached = records;
    });

  return {
    load: () => loadOnce,
    save: (records) => persist(records),
    upsert: (record) =>
      Effect.gen(function* () {
        const current = yield* loadOnce;
        const next = current.filter((r) => r.instanceId !== record.instanceId);
        next.push(record);
        yield* persist(next);
      }),
    remove: (instanceId) =>
      Effect.gen(function* () {
        const current = yield* loadOnce;
        const next = current.filter((r) => r.instanceId !== (instanceId as string));
        if (next.length === current.length) return; // absent — no write
        yield* persist(next);
      }),
    get records() {
      return cached ?? [];
    },
  };
}

/** Re-export the endpoint type for callers that construct records. */
export type { AdvertisedEndpoint };
