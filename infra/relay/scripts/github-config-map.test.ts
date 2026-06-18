import { describe, expect, it } from "@effect/vitest";
import {
  WIRE_RELAY_CLERK_JWT_AUDIENCE,
  WIRE_RELAY_CLERK_JWT_TEMPLATE,
  WIRE_RELAY_DPOP_ACCESS_JWT_TYP,
} from "@kata-sh/code-contracts/wireIdentity";

import { buildRelayGithubSyncPlan } from "./github-config-map.ts";

const completeEnv = {
  CLOUDFLARE_ACCOUNT_ID: "cf-account",
  CLOUDFLARE_API_TOKEN: "cf-token",
  PLANETSCALE_ORGANIZATION: "ps-org",
  PLANETSCALE_API_TOKEN_ID: "ps-id",
  PLANETSCALE_API_TOKEN: "ps-token",
  AXIOM_ORG_ID: "axiom-org",
  AXIOM_TOKEN: "axiom-token",
  RELAY_API_ZONE_NAME: "connect.example.test",
  RELAY_TUNNEL_ZONE_NAME: "tunnels.example.test",
  CLERK_PUBLISHABLE_KEY: "pk_test_example",
  CLERK_JWT_AUDIENCE: WIRE_RELAY_CLERK_JWT_AUDIENCE,
  CLERK_JWT_TEMPLATE: WIRE_RELAY_CLERK_JWT_TEMPLATE,
  CLERK_CLI_OAUTH_CLIENT_ID: "oauth_client",
  CLERK_SECRET_KEY: "sk_test_example",
  CLERK_SMOKE_USER_ID: "user_smoke",
  APNS_ENVIRONMENT: "sandbox",
  APNS_TEAM_ID: "team",
  APNS_KEY_ID: "key",
  APNS_BUNDLE_ID: "com.example.app",
  APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
} as const;

describe("buildRelayGithubSyncPlan", () => {
  it("partitions relay env values into repo vars, production vars, and production secrets", () => {
    const plan = buildRelayGithubSyncPlan(completeEnv);
    expect(plan.missing).toEqual([]);
    expect(plan.repoVariables.map((entry) => entry.name)).toEqual([
      "CLOUDFLARE_ACCOUNT_ID",
      "PLANETSCALE_ORGANIZATION",
      "AXIOM_ORG_ID",
    ]);
    expect(plan.productionSecrets.map((entry) => entry.name)).toEqual([
      "CLOUDFLARE_API_TOKEN",
      "PLANETSCALE_API_TOKEN_ID",
      "PLANETSCALE_API_TOKEN",
      "AXIOM_TOKEN",
      "CLERK_SECRET_KEY",
      "APNS_PRIVATE_KEY",
    ]);
    expect(plan.productionVariables.map((entry) => entry.name)).toContain("CLERK_SMOKE_USER_ID");
  });

  it("reports missing required values", () => {
    const plan = buildRelayGithubSyncPlan({});
    expect(plan.missing.length).toBeGreaterThan(0);
    expect(plan.repoVariables).toEqual([]);
    expect(plan.productionSecrets).toEqual([]);
  });
});
