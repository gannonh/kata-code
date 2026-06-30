/**
 * `environmentResolver` — pure first-match-wins merge of three
 * `EnvironmentConfig` sources into a `ResolvedEnvironmentConfig` with
 * per-field provenance.
 *
 * Resolution order (first match wins per field):
 * `repoFileConfig` → `savedEnvConfig` → `providerDefault`.
 *
 * A field present (not `undefined`) in an earlier source wins outright. The
 * resolver does not deep-merge arrays: `terminals` from the winning source
 * replaces rather than concatenates. An empty array `terminals: []` is present
 * and wins (a source may explicitly clear terminals). `build` and `snapshot`
 * are resolved and round-tripped (parsed, not executed) for forward-compat and
 * Phase 5.
 *
 * Pure and I/O-free so it is reusable by the future Kata Agent and unit-testable
 * with no server context. The loader (`apps/server`) performs the host read of
 * `.kata/environment.json` and the saved-env lookup, then hands already-read
 * inputs here.
 *
 * @module environmentResolver
 */
import type {
  EnvironmentBuild,
  EnvironmentConfig,
  EnvironmentTerminal,
} from "@kata-sh/code-sandbox-contracts/environmentConfig";

/** Which source a resolved field came from (for diagnostics + tests). */
export type EnvironmentConfigSource = "repo-file" | "saved-env" | "provider-default";

/** Resolved environment config: executable fields + parsed-but-not-executed
 *  build/snapshot + per-field provenance. */
export interface ResolvedEnvironmentConfig {
  readonly install?: string;
  readonly start?: string;
  readonly terminals?: ReadonlyArray<EnvironmentTerminal>;
  readonly build?: EnvironmentBuild;
  readonly snapshot?: string;
  readonly provenance: {
    readonly install?: EnvironmentConfigSource;
    readonly start?: EnvironmentConfigSource;
    readonly terminals?: EnvironmentConfigSource;
    readonly build?: EnvironmentConfigSource;
    readonly snapshot?: EnvironmentConfigSource;
  };
}

/** Input to `resolveEnvironmentConfig`. */
export interface ResolveEnvironmentConfigInput {
  readonly repoFileConfig?: EnvironmentConfig;
  readonly savedEnvConfig?: EnvironmentConfig;
  readonly providerDefault: EnvironmentConfig;
}

/** Ordered sources carrying both their values and their provenance label. */
interface Source {
  readonly label: EnvironmentConfigSource;
  readonly config: EnvironmentConfig | undefined;
}

/** First-match-wins for a single field across ordered sources. */
function pickField<K extends keyof EnvironmentConfig>(
  sources: ReadonlyArray<Source>,
  field: K,
): { readonly value: EnvironmentConfig[K]; readonly from: EnvironmentConfigSource } | undefined {
  for (const src of sources) {
    if (src.config === undefined) continue;
    const value = src.config[field];
    if (value !== undefined) return { value, from: src.label };
  }
  return undefined;
}

/**
 * Resolve an `EnvironmentConfig` from three sources, first-match-wins per
 * field, with per-field provenance. Fields absent from all sources are omitted
 * from both the resolved config and the provenance map.
 */
export function resolveEnvironmentConfig(
  input: ResolveEnvironmentConfigInput,
): ResolvedEnvironmentConfig {
  const sources: ReadonlyArray<Source> = [
    { label: "repo-file", config: input.repoFileConfig },
    { label: "saved-env", config: input.savedEnvConfig },
    { label: "provider-default", config: input.providerDefault },
  ];

  const fields = ["install", "start", "terminals", "build", "snapshot"] as const;

  const resolved: {
    install?: string;
    start?: string;
    terminals?: ReadonlyArray<EnvironmentTerminal>;
    build?: EnvironmentBuild;
    snapshot?: string;
  } = {};
  const provenance: {
    install?: EnvironmentConfigSource;
    start?: EnvironmentConfigSource;
    terminals?: EnvironmentConfigSource;
    build?: EnvironmentConfigSource;
    snapshot?: EnvironmentConfigSource;
  } = {};

  for (const field of fields) {
    const picked = pickField(sources, field);
    if (picked === undefined) continue;
    // `value` is typed as EnvironmentConfig[K]; assign into the matching slot.
    (resolved as Record<string, unknown>)[field] = picked.value;
    (provenance as Record<string, unknown>)[field] = picked.from;
  }

  return { ...resolved, provenance };
}
