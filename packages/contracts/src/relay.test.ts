import { describe, expect, it } from "vite-plus/test";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";
import * as Schema from "effect/Schema";

import {
  RelayApi,
  RelayCloudLinearOAuthDeliveryRequest,
  RelayDeviceRegistrationRequest,
  RelayLinearAccessToken,
  RelayLinearOAuthStartRequest,
} from "./relay.ts";

const decodeDevice = Schema.decodeUnknownExit(RelayDeviceRegistrationRequest);
const device = {
  deviceId: "device",
  label: "Phone",
  pushToken: "token",
  preferences: {
    notificationsEnabled: true,
    liveActivitiesEnabled: true,
    notifyOnApproval: true,
    notifyOnInput: true,
    notifyOnCompletion: true,
    notifyOnFailure: true,
  },
};

describe("mobile device platforms", () => {
  it.each([
    [23, "Failure"],
    [24, "Success"],
    [37, "Success"],
  ])("enforces the Android minimum without an upper bound (API %i)", (androidApiLevel, result) => {
    expect(decodeDevice({ ...device, platform: "android", androidApiLevel })._tag).toBe(result);
  });

  it("accepts Android tokens without Apple routing and preserves older iOS registrations", () => {
    expect(decodeDevice({ ...device, platform: "android", androidApiLevel: 36 })._tag).toBe(
      "Success",
    );
    expect(decodeDevice({ ...device, platform: "ios", iosMajorVersion: 18 })._tag).toBe("Success");
  });
  it("rejects missing platform versions and Apple activity tokens on Android", () => {
    expect(decodeDevice({ ...device, platform: "ios" })._tag).toBe("Failure");
    expect(decodeDevice({ ...device, platform: "android" })._tag).toBe("Failure");
    expect(
      decodeDevice({
        ...device,
        platform: "android",
        androidApiLevel: 36,
        pushToStartToken: "apple-token",
      })._tag,
    ).toBe("Failure");
  });
});

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });
});

describe("Linear OAuth relay contracts", () => {
  it("binds a start request to an environment and connection", () => {
    const decode = Schema.decodeUnknownExit(RelayLinearOAuthStartRequest);
    expect(decode({ environmentId: "environment-1", connectionId: "connection-1" })._tag).toBe(
      "Success",
    );
    expect(decode({ environmentId: "environment-1", connectionId: "" })._tag).toBe("Failure");
  });

  it("rejects a connection id that could leave the environment secret directory", () => {
    const decode = Schema.decodeUnknownExit(RelayLinearOAuthStartRequest);
    for (const connectionId of ["x/../relay-issuer", "..", "a.b", "a b", "a".repeat(129)]) {
      expect(decode({ environmentId: "environment-1", connectionId })._tag).toBe("Failure");
    }
  });

  it("carries a refreshed token bundle", () => {
    const decode = Schema.decodeUnknownExit(RelayLinearAccessToken);
    expect(
      decode({ accessToken: "token", expiresAt: 1_800_000_000_000, scope: "read admin" })._tag,
    ).toBe("Success");
  });

  it("accepts a delivery request carrying only the signed proof", () => {
    const decode = Schema.decodeUnknownExit(RelayCloudLinearOAuthDeliveryRequest);
    expect(decode({ proof: "signed" })._tag).toBe("Success");
    expect(decode({})._tag).toBe("Failure");
  });
});
