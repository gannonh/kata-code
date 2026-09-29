import { describe, expect, it, vi } from "@effect/vitest";

import { exchangeClerkDpopToken, fetchSessionJwt, signInWithTicket } from "./clerk-dpop-smoke.ts";

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
    const requestHeaders = (capturedInit?.headers ?? {}) as Record<string, string>;
    expect(String(requestHeaders.dpop)).toMatch(/^eyJ/u);
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

describe("signInWithTicket and fetchSessionJwt", () => {
  it("signs in with the ticket, then requests the template JWT with the client token", async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (String(input).includes("/v1/client/sign_ins")) {
        return Response.json(
          { response: { status: "complete", created_session_id: "sess_1" } },
          { headers: { authorization: "client-jwt" } },
        );
      }
      return Response.json({ jwt: "relay-jwt" });
    });

    const session = await signInWithTicket({
      frontendApiUrl: "https://clerk.example.test",
      ticket: "ticket-1",
      fetchImpl,
    });
    const jwt = await fetchSessionJwt({
      ...session,
      frontendApiUrl: "https://clerk.example.test",
      jwtTemplate: "kata-relay",
      fetchImpl,
    });

    expect(session).toEqual({ sessionId: "sess_1", clientToken: "client-jwt" });
    expect(jwt).toBe("relay-jwt");
    expect(calls.map((call) => call.url)).toEqual([
      "https://clerk.example.test/v1/client/sign_ins?__clerk_api_version=2025-11-10&_is_native=1",
      "https://clerk.example.test/v1/client/sessions/sess_1/tokens/kata-relay?__clerk_api_version=2025-11-10&_is_native=1",
    ]);
    expect(String(calls[0]?.init?.body)).toBe("strategy=ticket&ticket=ticket-1");
    expect(calls[1]?.init?.headers).toEqual({ authorization: "client-jwt" });
  });

  it("fails when Clerk rejects the ticket", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ errors: [{}] }, { status: 422 }));
    await expect(
      signInWithTicket({ frontendApiUrl: "https://clerk.example.test", ticket: "bad", fetchImpl }),
    ).rejects.toThrow("Clerk sign-in ticket was not accepted (422).");
  });

  it("fails when Clerk returns no JWT for the template", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ errors: [{}] }, { status: 404 }));
    await expect(
      fetchSessionJwt({
        sessionId: "sess_1",
        clientToken: "client-jwt",
        frontendApiUrl: "https://clerk.example.test",
        jwtTemplate: "missing",
        fetchImpl,
      }),
    ).rejects.toThrow("Clerk did not return a JWT for the relay smoke template (404).");
  });
});
