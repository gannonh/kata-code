import { describe, expect, it } from "@effect/vitest";

import {
  RELAY_PUBLIC_SMOKE_PATHS,
  relayPublicSmokeUrl,
  verifyRelayPublicEndpoints,
} from "./post-deploy-smoke.ts";

describe("relay post-deploy smoke", () => {
  it("resolves public endpoint paths against the relay origin", () => {
    expect(relayPublicSmokeUrl("https://relay.example.test", "/health")).toBe(
      "https://relay.example.test/health",
    );
    expect(relayPublicSmokeUrl("https://relay.example.test/", "/health")).toBe(
      "https://relay.example.test/health",
    );
  });

  it("requires all public endpoints to succeed", async () => {
    const fetchImpl = (async () => new Response("ok", { status: 200 })) as typeof fetch;
    const summary = await verifyRelayPublicEndpoints("https://relay.example.test", fetchImpl);
    expect(summary.ok).toBe(true);
    expect(summary.results.map((result) => result.path)).toEqual([...RELAY_PUBLIC_SMOKE_PATHS]);
  });

  it("reports an unavailable public endpoint", async () => {
    const fetchImpl = (async () => new Response("down", { status: 503 })) as typeof fetch;
    expect((await verifyRelayPublicEndpoints("https://relay.example.test", fetchImpl)).ok).toBe(
      false,
    );
  });
});
