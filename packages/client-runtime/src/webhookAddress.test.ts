import { describe, expect, it } from "vite-plus/test";

import { webhookAddress } from "./webhookAddress.ts";

const path = "/api/hooks/scheduled-task%3Ahook/token";
const endpoint = (url: string | null) => ({ path, url, hasSecret: false });

describe("webhookAddress", () => {
  it("uses the Kata Code Connect URL when the server has one", () => {
    expect(webhookAddress(endpoint("https://relay.kata.sh/v1/hooks/k/t/x"), null)).toEqual({
      address: "https://relay.kata.sh/v1/hooks/k/t/x",
      copyable: true,
      note: null,
    });
  });

  it("builds a direct URL on the environment's address without Kata Code Connect", () => {
    const result = webhookAddress(endpoint(null), "https://mac.tail1234.ts.net/");
    expect(result.address).toBe(`https://mac.tail1234.ts.net${path}`);
    expect(result.copyable).toBe(true);
    expect(result.note).toBe(
      "Works wherever this environment's address is reachable, for example over Tailscale or your own proxy. Link Kata Code Connect for a public URL.",
    );
  });

  it("says only this computer can call a loopback address", () => {
    const result = webhookAddress(endpoint(null), "http://127.0.0.1:3773/");
    expect(result.copyable).toBe(true);
    expect(result.note).toBe(
      "Only this computer can call this address. Link Kata Code Connect for a public URL.",
    );
  });

  it("falls back to the path when the address is unknown", () => {
    expect(webhookAddress(endpoint(null), null)).toEqual({
      address: path,
      copyable: false,
      note: "Link this environment to Kata Code Connect for a public URL.",
    });
  });
});
