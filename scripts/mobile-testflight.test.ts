// @effect-diagnostics globalDate:off - build numbers derive from wall-clock Dates.
import { describe, expect, it } from "vite-plus/test";

import {
  iosBuildNumber,
  missingConnectConfig,
  resolveAppStoreConnectAuth,
} from "./mobile-testflight.ts";

describe("iosBuildNumber", () => {
  it("formats UTC minutes as YYYYMMDDHHmm", () => {
    expect(iosBuildNumber(new Date("2026-09-26T16:12:45.123Z"))).toBe("202609261612");
    expect(iosBuildNumber(new Date("2027-01-02T03:04:59Z"))).toBe("202701020304");
  });
});

describe("resolveAppStoreConnectAuth", () => {
  it("falls back to the Xcode account when no API key variable is set", () => {
    expect(resolveAppStoreConnectAuth({ APPLE_API_KEY: "  " })).toEqual({ kind: "xcode-account" });
  });

  it("uses the trimmed API key trio when all three are set", () => {
    expect(
      resolveAppStoreConnectAuth({
        APPLE_API_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n",
        APPLE_API_KEY_ID: " ABC123DEF4 ",
        APPLE_API_ISSUER: "69a6de70-0000-47e3-e053-5b8c7c11a4d1",
      }),
    ).toEqual({
      kind: "api-key",
      key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      keyId: "ABC123DEF4",
      issuerId: "69a6de70-0000-47e3-e053-5b8c7c11a4d1",
    });
  });

  it("names every missing variable when the trio is incomplete", () => {
    expect(() => resolveAppStoreConnectAuth({ APPLE_API_KEY: "key" })).toThrow(
      "App Store Connect API key is incomplete; missing APPLE_API_KEY_ID, APPLE_API_ISSUER.",
    );
  });
});

describe("missingConnectConfig", () => {
  it("lists the Connect settings an upload still needs", () => {
    expect(missingConnectConfig({ KATACODE_CLERK_JWT_TEMPLATE: "kata-relay" })).toEqual([
      "KATACODE_CLERK_PUBLISHABLE_KEY",
      "KATACODE_RELAY_URL",
    ]);
    expect(
      missingConnectConfig({
        KATACODE_CLERK_PUBLISHABLE_KEY: "pk_test_abc",
        KATACODE_CLERK_JWT_TEMPLATE: "kata-relay",
        KATACODE_RELAY_URL: "https://relay.kata.sh",
      }),
    ).toEqual([]);
  });
});
