import { describe, expect, it } from "@effect/vitest";

import {
  runCredentialSmoke,
  verifyApnsCredentials,
  verifyAxiomCredentials,
  verifyCloudflareCredentials,
  verifyPlanetScaleCredentials,
} from "./credential-smoke.ts";

describe("verifyCloudflareCredentials", () => {
  it("passes when token verify and zone list succeed", async () => {
    const fetchImpl = (async (input) => {
      const url = String(input);
      if (url.includes("/user/tokens/verify")) {
        return Response.json({ success: true, result: { status: "active" } });
      }
      if (url.includes("/zones")) {
        return Response.json({ success: true, result: [] });
      }
      if (
        url.includes("/workers/scripts/alchemy-state-store/settings") ||
        url.includes("/workers/subdomain") ||
        url.includes("/secrets_store/stores")
      ) {
        return Response.json({ success: true, result: {} });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const result = await verifyCloudflareCredentials({
      accountId: "account-1",
      apiToken: "token-1",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
  });

  it("fails when account-level Workers permissions are missing", async () => {
    const fetchImpl = (async (input) => {
      const url = String(input);
      if (url.includes("/user/tokens/verify")) {
        return Response.json({ success: true, result: { status: "active" } });
      }
      if (url.includes("/zones")) {
        return Response.json({ success: true, result: [] });
      }
      if (url.includes("/workers/scripts/alchemy-state-store/settings")) {
        return Response.json(
          { success: false, errors: [{ code: 10000, message: "Authentication error" }] },
          { status: 403 },
        );
      }
      return Response.json({ success: true, result: {} });
    }) as typeof fetch;

    const result = await verifyCloudflareCredentials({
      accountId: "account-1",
      apiToken: "token-1",
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("Workers script settings permission check failed");
  });
});

describe("verifyPlanetScaleCredentials", () => {
  it("passes when organization lookup succeeds", async () => {
    let authHeader: string | null = null;
    const fetchImpl = (async (_input, init) => {
      const headers = new Headers(init?.headers);
      authHeader = headers.get("Authorization");
      return Response.json({ name: "kata" });
    }) as typeof fetch;
    const result = await verifyPlanetScaleCredentials({
      organization: "kata",
      tokenId: "id",
      token: "token",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(authHeader).toBe("id:token");
  });
});

describe("verifyAxiomCredentials", () => {
  it("passes when dataset list succeeds", async () => {
    const fetchImpl = (async (input) => {
      expect(String(input)).toBe("https://api.axiom.co/v1/datasets");
      return Response.json([{ id: "relay-traces" }]);
    }) as typeof fetch;
    const result = await verifyAxiomCredentials({
      orgId: "org-1",
      token: "token",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
  });
});

describe("verifyApnsCredentials", () => {
  it("requires a PEM private key and valid environment", () => {
    expect(
      verifyApnsCredentials({
        environment: "sandbox",
        teamId: "TEAM",
        keyId: "KEY",
        bundleId: "com.example.app",
        privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      }).ok,
    ).toBe(true);
    expect(
      verifyApnsCredentials({
        environment: "invalid",
        teamId: "TEAM",
        keyId: "KEY",
        bundleId: "com.example.app",
        privateKey: "not-a-pem",
      }).ok,
    ).toBe(false);
  });
});

describe("runCredentialSmoke", () => {
  it("fails when any provider check fails", async () => {
    const fetchImpl = (async () => new Response("denied", { status: 401 })) as typeof fetch;
    const summary = await runCredentialSmoke(
      {
        CLOUDFLARE_ACCOUNT_ID: "account",
        CLOUDFLARE_API_TOKEN: "token",
        PLANETSCALE_ORGANIZATION: "org",
        PLANETSCALE_API_TOKEN_ID: "id",
        PLANETSCALE_API_TOKEN: "token",
        AXIOM_ORG_ID: "org",
        AXIOM_TOKEN: "token",
        CLERK_SECRET_KEY: "sk_invalid",
        CLERK_SMOKE_USER_ID: "user_missing",
        APNS_ENVIRONMENT: "sandbox",
        APNS_TEAM_ID: "TEAM",
        APNS_KEY_ID: "KEY",
        APNS_BUNDLE_ID: "com.example.app",
        APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      },
      fetchImpl,
    );
    expect(summary.ok).toBe(false);
    expect(summary.results.some((result) => !result.ok)).toBe(true);
  });
});
