// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap loads 1Password before an Effect runtime exists.
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";

export interface KatacodePublicConfig {
  readonly clerkPublishableKey: string | undefined;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
  readonly relayUrl: string | undefined;
  readonly mobileOtlpTracesUrl: string | undefined;
  readonly mobileOtlpTracesDataset: string | undefined;
  readonly mobileOtlpTracesToken: string | undefined;
  readonly relayClientOtlpTracesUrl: string | undefined;
  readonly relayClientOtlpTracesDataset: string | undefined;
  readonly relayClientOtlpTracesToken: string | undefined;
}

type Environment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_OP_ENVIRONMENT_ID = "tlgyne6mxr5iejiwvshbxsnxde";

export type OpEnvironmentReader = (input: {
  readonly environmentId: string;
  readonly env: NodeJS.ProcessEnv;
}) => Record<string, string | undefined>;

const opEnvironmentCache = new Map<string, Record<string, string | undefined>>();

export class OnePasswordEnvironmentReadError extends Error {
  readonly environmentId: string;
  readonly detail: string;

  constructor(environmentId: string, detail: string) {
    super(
      `Failed to read 1Password Environment ${environmentId}. Install 1Password CLI beta 2.33.0-beta.02 or later, set OP_SERVICE_ACCOUNT_TOKEN, and confirm the service account can read that Environment. ${detail}`,
    );
    this.name = "OnePasswordEnvironmentReadError";
    this.environmentId = environmentId;
    this.detail = detail;
  }
}

export function readOpEnvironment(input: {
  readonly environmentId: string;
  readonly env: NodeJS.ProcessEnv;
}): Record<string, string | undefined> {
  const cached = opEnvironmentCache.get(input.environmentId);
  if (cached) {
    return cached;
  }

  const result = NodeChildProcess.spawnSync("op", ["environment", "read", input.environmentId], {
    encoding: "utf8",
    env: input.env,
  });
  if (result.error) {
    throw new OnePasswordEnvironmentReadError(input.environmentId, result.error.message);
  }
  if (result.status !== 0) {
    const detail =
      (result.stderr ?? "").trim().split("\n")[0] || `op exited ${String(result.status)}`;
    throw new OnePasswordEnvironmentReadError(input.environmentId, detail);
  }

  const parsed = NodeUtil.parseEnv(result.stdout ?? "");
  opEnvironmentCache.set(input.environmentId, parsed);
  return parsed;
}

export function loadRepoEnv({
  baseEnv = process.env,
  readOpEnvironment: readEnvironment = readOpEnvironment,
}: {
  readonly baseEnv?: Environment;
  readonly readOpEnvironment?: OpEnvironmentReader;
} = {}): Record<string, string | undefined> {
  const token = baseEnv.OP_SERVICE_ACCOUNT_TOKEN?.trim();
  const opEnv =
    token === undefined || token.length === 0
      ? {}
      : readEnvironment({
          environmentId: baseEnv.OP_ENVIRONMENT_ID?.trim() || DEFAULT_OP_ENVIRONMENT_ID,
          env: environmentToProcessEnv(baseEnv),
        });
  const config = resolvePublicConfig(baseEnv, opEnv);

  return {
    ...opEnv,
    ...baseEnv,
    ...(config.clerkPublishableKey
      ? {
          KATACODE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          VITE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
        }
      : {}),
    ...(config.clerkJwtTemplate
      ? {
          KATACODE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          VITE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          EXPO_PUBLIC_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
        }
      : {}),
    ...(config.clerkCliOAuthClientId
      ? {
          KATACODE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
          VITE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
        }
      : {}),
    ...(config.relayUrl
      ? {
          KATACODE_RELAY_URL: config.relayUrl,
          VITE_KATACODE_RELAY_URL: config.relayUrl,
        }
      : {}),
    ...(config.mobileOtlpTracesUrl
      ? {
          KATACODE_MOBILE_OTLP_TRACES_URL: config.mobileOtlpTracesUrl,
          EXPO_PUBLIC_OTLP_TRACES_URL: config.mobileOtlpTracesUrl,
        }
      : {}),
    ...(config.mobileOtlpTracesDataset
      ? {
          KATACODE_MOBILE_OTLP_TRACES_DATASET: config.mobileOtlpTracesDataset,
          EXPO_PUBLIC_OTLP_TRACES_DATASET: config.mobileOtlpTracesDataset,
        }
      : {}),
    ...(config.mobileOtlpTracesToken
      ? {
          KATACODE_MOBILE_OTLP_TRACES_TOKEN: config.mobileOtlpTracesToken,
          EXPO_PUBLIC_OTLP_TRACES_TOKEN: config.mobileOtlpTracesToken,
        }
      : {}),
    ...(config.relayClientOtlpTracesUrl
      ? {
          KATACODE_RELAY_CLIENT_OTLP_TRACES_URL: config.relayClientOtlpTracesUrl,
          VITE_RELAY_OTLP_TRACES_URL: config.relayClientOtlpTracesUrl,
        }
      : {}),
    ...(config.relayClientOtlpTracesDataset
      ? {
          KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET: config.relayClientOtlpTracesDataset,
          VITE_RELAY_OTLP_TRACES_DATASET: config.relayClientOtlpTracesDataset,
        }
      : {}),
    ...(config.relayClientOtlpTracesToken
      ? {
          KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: config.relayClientOtlpTracesToken,
          VITE_RELAY_OTLP_TRACES_TOKEN: config.relayClientOtlpTracesToken,
        }
      : {}),
  };
}

export function resolvePublicConfig(...sources: readonly Environment[]): KatacodePublicConfig {
  return {
    clerkPublishableKey: firstNonEmpty(
      sources,
      "KATACODE_CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ),
    clerkJwtTemplate: firstNonEmpty(
      sources,
      "KATACODE_CLERK_JWT_TEMPLATE",
      "VITE_CLERK_JWT_TEMPLATE",
      "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
    ),
    clerkCliOAuthClientId: firstNonEmpty(
      sources,
      "KATACODE_CLERK_CLI_OAUTH_CLIENT_ID",
      "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
    ),
    relayUrl: firstNonEmpty(sources, "KATACODE_RELAY_URL", "VITE_KATACODE_RELAY_URL"),
    mobileOtlpTracesUrl: firstNonEmpty(
      sources,
      "KATACODE_MOBILE_OTLP_TRACES_URL",
      "EXPO_PUBLIC_OTLP_TRACES_URL",
    ),
    mobileOtlpTracesDataset: firstNonEmpty(
      sources,
      "KATACODE_MOBILE_OTLP_TRACES_DATASET",
      "EXPO_PUBLIC_OTLP_TRACES_DATASET",
    ),
    mobileOtlpTracesToken: firstNonEmpty(
      sources,
      "KATACODE_MOBILE_OTLP_TRACES_TOKEN",
      "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
    ),
    relayClientOtlpTracesUrl: firstNonEmpty(
      sources,
      "KATACODE_RELAY_CLIENT_OTLP_TRACES_URL",
      "VITE_RELAY_OTLP_TRACES_URL",
    ),
    relayClientOtlpTracesDataset: firstNonEmpty(
      sources,
      "KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
      "VITE_RELAY_OTLP_TRACES_DATASET",
    ),
    relayClientOtlpTracesToken: firstNonEmpty(
      sources,
      "KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
      "VITE_RELAY_OTLP_TRACES_TOKEN",
    ),
  };
}

function firstNonEmpty(sources: readonly Environment[], ...names: readonly string[]) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name]?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function environmentToProcessEnv(baseEnv: Environment): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
      env[name] = value;
    }
  }
  return env;
}
