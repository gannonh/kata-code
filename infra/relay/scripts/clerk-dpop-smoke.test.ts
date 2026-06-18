import { describe, expect, it, vi } from "@effect/vitest";

import { exchangeClerkDpopToken } from "./clerk-dpop-smoke.ts";

describe("exchangeClerkDpopToken", () => {
  it("exchanges a Clerk JWT for a DPoP-bound relay access token", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        access_token: "relay-dpop-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "DPoP",
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
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe("https://relay.example.test/v1/client/dpop-token");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(
      String((capturedInit?.headers as Record<string, string> | undefined)?.dpop ?? ""),
    ).toMatch(/^eyJ/u);
    const tokenBody = new URLSearchParams(String(capturedInit?.body));
    expect(tokenBody.get("subject_token")).toBe("clerk-jwt");
    expect(tokenBody.get("client_id")).toBe("kata-web");
  });

  it("fails when relay returns a non-success response", async () => {
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
