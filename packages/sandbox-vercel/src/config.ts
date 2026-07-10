/**
 * Config schema + auth-merge helper for the Vercel Sandbox driver.
 *
 * The driver-specific `config` payload stored under
 * `SandboxProviderInstanceConfig.config`. `auth` is injected server-side from
 * the materialized `VERCEL_TOKEN`/`VERCEL_TEAM_ID`/`VERCEL_PROJECT_ID`
 * sensitive environment variables (the existing `sandbox-env-*` secret path),
 * never rendered as a settings form field, and excluded from the env passed
 * into the sandbox VM. `mergeVercelAuthIntoConfig` performs that injection
 * before the registry decodes the config so `validate`/`provision` see real
 * credentials.
 *
 * @module config
 */
// @effect-diagnostics globalConsole:off - the legacy-config migration log runs in a non-Effect decode context (registry materialization), where console is the available surface.
import * as Schema from "effect/Schema";

import { makeProviderSettingsSchema } from "@kata-sh/code-contracts/settings";
import { PortSchema, TrimmedNonEmptyString } from "@kata-sh/code-contracts/baseSchemas";
import type { SandboxProviderInstanceConfig } from "@kata-sh/code-contracts/sandboxProviderInstance";

/**
 * Vercel Sandbox driver config. `auth` is hidden from the settings form
 * (annotated `hidden: true`) because it is server-injected from sensitive
 * instance environment variables, not user-entered. The remaining fields are
 * rendered by `ProviderSettingsForm` using the `providerSettingsForm`
 * annotations, mirroring `packages/sandbox-docker/src/config.ts`.
 *
 * `persistent` (default true) maps to SDK v2 persistent sandboxes: stop
 * auto-saves the filesystem, start resumes it by name. The legacy
 * `sourceType`/`snapshotId` fields are removed from the schema; the decoder
 * tolerates and strips them via `decodeVercelSandboxConfig` so existing
 * targets keep decoding (decode-time migration, logged once per process).
 */
export const VercelSandboxConfig = makeProviderSettingsSchema(
  {
    runtime: TrimmedNonEmptyString.pipe(
      Schema.annotateKey({
        title: "Runtime",
        description: "Vercel Sandbox runtime (e.g. node24).",
        providerSettingsForm: { placeholder: "node24", clearWhenEmpty: "omit" },
      }),
    ),
    persistent: Schema.Boolean.pipe(
      Schema.annotateKey({
        title: "Persistent filesystem",
        description:
          "When on, stop auto-saves the sandbox filesystem and start resumes it (bounded snapshot storage). Turn off only for throwaway sandboxes.",
      }),
    ),
    timeoutMs: Schema.Number.pipe(
      Schema.annotateKey({
        title: "Session timeout (ms)",
        description:
          "Sandbox auto-termination timeout. Hobby max is 2_700_000 (45m); Pro/Enterprise max is 86_400_000 (24h).",
        providerSettingsForm: { placeholder: "86400000" },
      }),
    ),
    port: PortSchema.pipe(
      Schema.annotateKey({
        title: "Sandbox port",
        description: "In-sandbox port the Kata server listens on (exposed via sandbox.domain).",
        providerSettingsForm: { placeholder: "13773" },
      }),
    ),
    vcpus: Schema.optionalKey(
      Schema.Number.pipe(
        Schema.annotateKey({
          title: "Machine size (vCPU / RAM)",
          description:
            "vCPU allocation applied at sandbox create only (cannot resize later). RAM is fixed at 2048 MB per vCPU. Default is 2 vCPUs / 4 GB RAM.",
          providerSettingsForm: { placeholder: "2" },
        }),
      ),
    ),
    source: Schema.optionalKey(
      Schema.Struct({
        repository: TrimmedNonEmptyString,
        branch: TrimmedNonEmptyString,
      }).pipe(Schema.annotateKey({ providerSettingsForm: { hidden: true } })),
    ),
    auth: Schema.optionalKey(
      Schema.Struct({
        token: TrimmedNonEmptyString,
        teamId: TrimmedNonEmptyString,
        projectId: TrimmedNonEmptyString,
      }).pipe(Schema.annotateKey({ providerSettingsForm: { hidden: true } })),
    ),
  },
  { order: ["runtime", "persistent", "timeoutMs", "port", "vcpus", "source", "auth"] },
);

export type VercelSandboxConfig = typeof VercelSandboxConfig.Type;

const decodeVercelSandboxConfigSchema = Schema.decodeUnknownSync(VercelSandboxConfig);

/** Recommended floor / Vercel platform default when `resources` is unspecified. */
export const DEFAULT_VERCEL_VCPUS = 2;

export const DEFAULT_VERCEL_CONFIG: VercelSandboxConfig = {
  runtime: "node24",
  persistent: true,
  timeoutMs: 86_400_000,
  port: 13773,
  vcpus: DEFAULT_VERCEL_VCPUS,
};

/** Legacy config keys removed in the lifecycle rework. Stripped at decode time
 *  so existing targets keep decoding; the strip is logged once per process. */
const LEGACY_VERCEL_CONFIG_KEYS = ["sourceType", "snapshotId"] as const;
let loggedLegacyStrip = false;

/** Decode a Vercel config, stripping legacy `sourceType`/`snapshotId` keys
 *  (decode-time migration). The strip is logged once per process so operators
 *  see the migration on first load after upgrade. */
export function decodeVercelSandboxConfig(input: unknown): VercelSandboxConfig {
  if (input !== null && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const stripped: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if ((LEGACY_VERCEL_CONFIG_KEYS as readonly string[]).includes(key)) {
        stripped.push(key);
        continue;
      }
      next[key] = value;
    }
    if (stripped.length > 0 && !loggedLegacyStrip) {
      loggedLegacyStrip = true;
      // Decode-time migration log (one line per process); see the file-level
      // globalConsole disable for why console is used here.
      console.warn(
        `[kata:sandbox-vercel] stripped legacy config keys ${stripped.join(", ")}; snapshot boot is no longer supported. Delete the sandbox and re-create it if you relied on snapshot boot.`,
      );
    }
    return decodeVercelSandboxConfigSchema(next);
  }
  return decodeVercelSandboxConfigSchema(input);
}

/**
 * Sensitive instance environment variable names that carry the Vercel auth
 * trio. Stored under the existing `sandbox-env-*` secret path and materialized
 * by `materializeSandboxProviderEnvironmentSecrets` before the driver runs.
 * The driver excludes these from the env passed into the sandbox VM.
 */
export const VERCEL_AUTH_ENV_VARS = [
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
] as const;

/**
 * Merge the materialized Vercel auth trio from an instance envelope's
 * `environment` into its `config.auth` payload. The server calls this before
 * `materializeOne` so the driver's `validate`/`provision` see real credentials.
 *
 * Returns the envelope unchanged when any of the three variables is missing or
 * empty (the driver's `validate` then fails loud with `invalid-config`).
 */
export function mergeVercelAuthIntoConfig(
  envelope: SandboxProviderInstanceConfig,
): SandboxProviderInstanceConfig {
  const env = envelope.environment ?? [];
  const get = (name: string): string | undefined => {
    const entry = env.find((v) => v.name === name);
    return entry !== undefined && entry.value.length > 0 ? entry.value : undefined;
  };
  const token = get("VERCEL_TOKEN");
  const teamId = get("VERCEL_TEAM_ID");
  const projectId = get("VERCEL_PROJECT_ID");
  if (token === undefined || teamId === undefined || projectId === undefined) {
    return envelope;
  }
  const config = (envelope.config ?? {}) as Record<string, unknown>;
  return {
    ...envelope,
    config: { ...config, auth: { token, teamId, projectId } },
  };
}
