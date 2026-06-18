import { describe, expect, it } from "@effect/vitest";

import {
  relayPublicSmokeUrl,
  RELAY_PUBLIC_SMOKE_PATHS,
  verifyRelayPublicEndpoints,
} from "./post-deploy-smoke.ts";

describe("relayPublicSmokeUrl", () => {
  it("resolves public smoke paths against the relay origin", () => {
    expect(relayPublicSmokeUrl("https://relay.example.test", "/health")).toBe(
      "https://relay.example.test/health",
    );
    expect(relayPublicSmokeUrl("https://relay.example.test/", "/health")).toBe(
      "https://relay.example.test/health",
    );
  });
});

describe("verifyRelayPublicEndpoints", () => {
  it("requires every public endpoint to return a success status", async () => {
    const fetchImpl = (async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response("ok", { status: 200 });
      }
      if (url.includes("/.well-known/oauth-authorization-server")) {
        return new Response(JSON.stringify({ issuer: "https://relay.example.test" }), {
          status: 200,
        });
      }
      if (url.includes("/.well-known/oauth-protected-resource")) {
        return new Response(JSON.stringify({ resource: "https://relay.example.test" }), {
          status: 200,
        });
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const summary = await verifyRelayPublicEndpoints("https://relay.example.test", fetchImpl);
    expect(summary.ok).toBe(true);
    expect(summary.results.map((result) => result.path)).toEqual([...RELAY_PUBLIC_SMOKE_PATHS]);
  });

  it("fails when any public endpoint is unavailable", async () => {
    const fetchImpl = (async () => new Response("down", { status: 503 })) as typeof fetch;
    const summary = await verifyRelayPublicEndpoints("https://relay.example.test", fetchImpl);
    expect(summary.ok).toBe(false);
  });
});
