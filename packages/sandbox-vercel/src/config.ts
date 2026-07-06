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
    sourceType: Schema.Literals(["runtime", "snapshot"]).pipe(
      Schema.annotateKey({
        title: "Boot source",
        description: "Boot from a Vercel runtime or a prepared snapshot.",
      }),
    ),
    snapshotId: Schema.optionalKey(
      TrimmedNonEmptyString.pipe(
        Schema.annotateKey({
          title: "Snapshot id",
          description: "Vercel snapshot id to boot from (required when boot source is snapshot).",
          providerSettingsForm: { placeholder: "snap_xxx", clearWhenEmpty: "omit" },
        }),
      ),
    ),
    timeoutMs: Schema.Number.pipe(
      Schema.annotateKey({
        title: "Session timeout (ms)",
        description: "Sandbox auto-termination timeout. Hobby max is 2_700_000 (45m).",
        providerSettingsForm: { placeholder: "2700000" },
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
          title: "vCPUs",
          description: "Optional vCPU allocation (memory is 2048 MB per vCPU).",
          providerSettingsForm: { placeholder: "1", clearWhenEmpty: "omit" },
        }),
      ),
    ),
    auth: Schema.optionalKey(
      Schema.Struct({
        token: TrimmedNonEmptyString,
        teamId: TrimmedNonEmptyString,
        projectId: TrimmedNonEmptyString,
      }).pipe(Schema.annotateKey({ providerSettingsForm: { hidden: true } })),
    ),
  },
  { order: ["runtime", "sourceType", "snapshotId", "timeoutMs", "port", "vcpus", "auth"] },
);

export type VercelSandboxConfig = typeof VercelSandboxConfig.Type;

export const DEFAULT_VERCEL_CONFIG: VercelSandboxConfig = {
  runtime: "node24",
  sourceType: "runtime",
  timeoutMs: 2_700_000,
  port: 13773,
};

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
