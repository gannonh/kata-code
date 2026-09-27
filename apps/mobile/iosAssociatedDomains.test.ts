import { describe, expect, it } from "vite-plus/test";

import { clerkIosAssociatedDomains } from "./iosAssociatedDomains.ts";

describe("clerkIosAssociatedDomains", () => {
  it("names the frontend API domain of a development instance", () => {
    // base64("fun-kiwi-12.clerk.accounts.dev$")
    expect(
      clerkIosAssociatedDomains("pk_test_ZnVuLWtpd2ktMTIuY2xlcmsuYWNjb3VudHMuZGV2JA=="),
    ).toEqual([
      "applinks:fun-kiwi-12.clerk.accounts.dev",
      "webcredentials:fun-kiwi-12.clerk.accounts.dev",
    ]);
  });

  it("names the frontend API domain of a production instance", () => {
    // base64("clerk.katacode.dev$")
    expect(clerkIosAssociatedDomains("pk_live_Y2xlcmsua2F0YWNvZGUuZGV2JA==")).toEqual([
      "applinks:clerk.katacode.dev",
      "webcredentials:clerk.katacode.dev",
    ]);
  });

  it("declares no associated domains without a publishable key", () => {
    expect(clerkIosAssociatedDomains(undefined)).toBeUndefined();
    expect(clerkIosAssociatedDomains("  ")).toBeUndefined();
  });

  it("rejects a key that does not decode to a domain", () => {
    expect(() => clerkIosAssociatedDomains("pk_live_not-base64!")).toThrow(
      "Failed to decode Clerk publishable key (pk_live).",
    );
  });
});
