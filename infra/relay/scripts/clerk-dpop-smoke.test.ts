import { describe, expect, it, vi } from "@effect/vitest";

import { exchangeClerkDpopToken } from "./clerk-dpop-smoke.ts";

describe("exchangeClerkDpopToken", () => {
  it("requests a DPoP-bound token with the Kata web client ID", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        access_token: "relay-dpop-token",
        expires_in: 300,
        scope: "environment:status",
      });
    });

    const result = await exchangeClerkDpopToken({
      relayUrl: "https://relay.example.test",
      clerkToken: "clerk-jwt",
      fetchImpl,
    });

    expect(result).toEqual({
      accessToken: "relay-dpop-token",
      expiresIn: 300,
      scope: "environment:status",
    });
    expect(capturedUrl).toBe("https://relay.example.test/v1/client/dpop-token");
    expect(capturedInit?.method).toBe("POST");
    expect(String((capturedInit?.headers as Record<string, string>).dpop)).toMatch(/^eyJ/u);
    expect(new URLSearchParams(String(capturedInit?.body)).get("client_id")).toBe("kata-web");
  });

  it("fails when the relay rejects the exchange", async () => {
    const fetchImpl = vi.fn(async () => new Response("invalid_dpop", { status: 401 }));
    await expect(
      exchangeClerkDpopToken({
        relayUrl: "https://relay.example.test",
        clerkToken: "clerk-jwt",
        fetchImpl,
      }),
    ).rejects.toThrow(/Relay DPoP token exchange failed/);
  });
});
