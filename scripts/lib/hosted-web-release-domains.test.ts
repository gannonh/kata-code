import { describe, expect, it } from "vite-plus/test";

import { resolveHostedWebReleaseDomains } from "./hosted-web-release-domains.ts";

describe("resolveHostedWebReleaseDomains", () => {
  it("defaults to Kata Code hosted domains instead of upstream fallbacks", () => {
    expect(resolveHostedWebReleaseDomains({})).toEqual({
      routerUrl: "https://app.kata.sh",
      latestDomain: "latest.app.kata.sh",
      nightlyDomain: "nightly.app.kata.sh",
      routerDomain: "app.kata.sh",
    });
  });

  it("accepts explicit fork domain overrides", () => {
    expect(
      resolveHostedWebReleaseDomains({
        routerUrl: "https://custom.katacode.test",
        latestDomain: "latest.custom.katacode.test",
        nightlyDomain: "nightly.custom.katacode.test",
      }),
    ).toEqual({
      routerUrl: "https://custom.katacode.test",
      latestDomain: "latest.custom.katacode.test",
      nightlyDomain: "nightly.custom.katacode.test",
      routerDomain: "custom.katacode.test",
    });
  });

  it("never falls back to upstream app.t3.codes domains", () => {
    const domains = resolveHostedWebReleaseDomains({});

    expect(domains.routerUrl).not.toContain("t3.codes");
    expect(domains.latestDomain).not.toContain("t3.codes");
    expect(domains.nightlyDomain).not.toContain("t3.codes");
  });
});
