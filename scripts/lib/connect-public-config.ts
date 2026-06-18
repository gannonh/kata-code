export const CONNECT_PUBLIC_CONFIG_KEYS = [
  "KATACODE_CLERK_PUBLISHABLE_KEY",
  "KATACODE_CLERK_JWT_TEMPLATE",
  "KATACODE_CLERK_CLI_OAUTH_CLIENT_ID",
  "KATACODE_RELAY_URL",
  "KATACODE_RELAY_CLIENT_OTLP_TRACES_URL",
  "KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
  "KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
] as const;

export type ConnectPublicConfigKey = (typeof CONNECT_PUBLIC_CONFIG_KEYS)[number];

export interface ConnectPublicConfigInput {
  readonly clerkPublishableKey?: string | undefined;
  readonly clerkJwtTemplate?: string | undefined;
  readonly clerkCliOAuthClientId?: string | undefined;
  readonly relayUrl?: string | undefined;
  readonly relayClientOtlpTracesUrl?: string | undefined;
  readonly relayClientOtlpTracesDataset?: string | undefined;
  readonly relayClientOtlpTracesToken?: string | undefined;
}

export interface ConnectPublicConfig {
  readonly clerkPublishableKey: string;
  readonly clerkJwtTemplate: string;
  readonly clerkCliOAuthClientId: string;
  readonly relayUrl: string;
  readonly relayClientOtlpTracesUrl: string;
  readonly relayClientOtlpTracesDataset: string;
  readonly relayClientOtlpTracesToken: string;
}

export interface ConnectPublicConfigResolution {
  readonly ok: true;
  readonly config: ConnectPublicConfig;
}

export interface ConnectPublicConfigFailure {
  readonly ok: false;
  readonly missing: ReadonlyArray<ConnectPublicConfigKey>;
}

export type ConnectPublicConfigResult = ConnectPublicConfigResolution | ConnectPublicConfigFailure;

function trimmed(value: string | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

export function resolveConnectPublicConfig(
  input: ConnectPublicConfigInput,
): ConnectPublicConfigResult {
  const config = {
    clerkPublishableKey: trimmed(input.clerkPublishableKey),
    clerkJwtTemplate: trimmed(input.clerkJwtTemplate),
    clerkCliOAuthClientId: trimmed(input.clerkCliOAuthClientId),
    relayUrl: trimmed(input.relayUrl),
    relayClientOtlpTracesUrl: trimmed(input.relayClientOtlpTracesUrl),
    relayClientOtlpTracesDataset: trimmed(input.relayClientOtlpTracesDataset),
    relayClientOtlpTracesToken: trimmed(input.relayClientOtlpTracesToken),
  };
  const missing = (
    [
      ["KATACODE_CLERK_PUBLISHABLE_KEY", config.clerkPublishableKey],
      ["KATACODE_CLERK_JWT_TEMPLATE", config.clerkJwtTemplate],
      ["KATACODE_CLERK_CLI_OAUTH_CLIENT_ID", config.clerkCliOAuthClientId],
      ["KATACODE_RELAY_URL", config.relayUrl],
      ["KATACODE_RELAY_CLIENT_OTLP_TRACES_URL", config.relayClientOtlpTracesUrl],
      ["KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET", config.relayClientOtlpTracesDataset],
      ["KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN", config.relayClientOtlpTracesToken],
    ] as const satisfies ReadonlyArray<readonly [ConnectPublicConfigKey, string | undefined]>
  )
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    config: config as ConnectPublicConfig,
  };
}

export function serializeConnectPublicConfigGithubOutput(config: ConnectPublicConfig): string {
  return [
    `clerk_publishable_key=${config.clerkPublishableKey}`,
    `clerk_jwt_template=${config.clerkJwtTemplate}`,
    `clerk_cli_oauth_client_id=${config.clerkCliOAuthClientId}`,
    `relay_url=${config.relayUrl}`,
    `relay_client_otlp_traces_url=${config.relayClientOtlpTracesUrl}`,
    `relay_client_otlp_traces_dataset=${config.relayClientOtlpTracesDataset}`,
    `relay_client_otlp_traces_token=${config.relayClientOtlpTracesToken}`,
  ].join("\n");
}

export function maskConnectPublicConfigLogs(config: ConnectPublicConfig): ReadonlyArray<string> {
  return [`::add-mask::${config.relayClientOtlpTracesToken}`];
}
