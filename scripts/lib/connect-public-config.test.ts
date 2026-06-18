import { describe, expect, it } from "vite-plus/test";

import {
  resolveConnectPublicConfig,
  serializeConnectPublicConfigGithubOutput,
} from "./connect-public-config.ts";

const completeConfig = {
  clerkPublishableKey: "pk_live_example",
  clerkJwtTemplate: "kata-relay",
  clerkCliOAuthClientId: "oauth_client",
  relayUrl: "https://relay.example.test",
  relayClientOtlpTracesUrl: "https://api.axiom.co/v1/traces",
  relayClientOtlpTracesDataset: "relay-client-traces",
  relayClientOtlpTracesToken: "xaat-client-token",
} as const;

describe("resolveConnectPublicConfig", () => {
  it("requires every Connect public config value for stable and nightly releases", () => {
    expect(resolveConnectPublicConfig({})).toEqual({
      ok: false,
      missing: [
        "KATACODE_CLERK_PUBLISHABLE_KEY",
        "KATACODE_CLERK_JWT_TEMPLATE",
        "KATACODE_CLERK_CLI_OAUTH_CLIENT_ID",
        "KATACODE_RELAY_URL",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_URL",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
        "KATACODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
      ],
    });
  });

  it("accepts a complete Connect public config bundle", () => {
    expect(resolveConnectPublicConfig(completeConfig)).toEqual({
      ok: true,
      config: completeConfig,
    });
  });
});

describe("serializeConnectPublicConfigGithubOutput", () => {
  it("serializes release workflow outputs without echoing extra fields", () => {
    expect(serializeConnectPublicConfigGithubOutput(completeConfig)).toBe(
      [
        "clerk_publishable_key=pk_live_example",
        "clerk_jwt_template=kata-relay",
        "clerk_cli_oauth_client_id=oauth_client",
        "relay_url=https://relay.example.test",
        "relay_client_otlp_traces_url=https://api.axiom.co/v1/traces",
        "relay_client_otlp_traces_dataset=relay-client-traces",
        "relay_client_otlp_traces_token=xaat-client-token",
      ].join("\n"),
    );
  });
});
