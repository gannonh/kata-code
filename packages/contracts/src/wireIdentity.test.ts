import { describe, expect, it } from "vite-plus/test";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { EnvironmentHttpApi } from "./environmentHttp.ts";
import { RelayManagedEndpointProviderKind, RelayPublicClientId } from "./relay.ts";
import * as Schema from "effect/Schema";
import {
  WIRE_CONNECT_API_PREFIX,
  WIRE_ENVIRONMENT_ISSUER_PREFIX,
  WIRE_ENVIRONMENT_WELL_KNOWN_PATH,
  WIRE_MOBILE_CLIENT_ID,
  WIRE_RELAY_CLERK_JWT_AUDIENCE,
  WIRE_RELAY_CLERK_JWT_TEMPLATE,
  WIRE_RELAY_CLOUD_HEALTH_REQUEST_JWT_TYP,
  WIRE_RELAY_CLOUD_MINT_REQUEST_JWT_TYP,
  WIRE_RELAY_DPOP_ACCESS_JWT_TYP,
  WIRE_RELAY_ENV_ACTIVITY_JWT_TYP,
  WIRE_RELAY_ENV_HEALTH_RESPONSE_JWT_TYP,
  WIRE_RELAY_ENV_LINK_JWT_TYP,
  WIRE_RELAY_ENV_MINT_RESPONSE_JWT_TYP,
  WIRE_RELAY_LINK_CHALLENGE_JWT_TYP,
  WIRE_RELAY_PROVIDER_KIND,
  WIRE_RELAY_PUBLIC_CLIENT_IDS,
  WIRE_WEB_CLIENT_ID,
  wireEnvironmentIssuer,
} from "./wireIdentity.ts";

describe("Kata Connect wire identity", () => {
  const isRelayProviderKind = Schema.is(RelayManagedEndpointProviderKind);
  const isRelayPublicClientId = Schema.is(RelayPublicClientId);

  it("owns the target provider, client, issuer, Clerk, and JWT values", () => {
    expect(WIRE_RELAY_PROVIDER_KIND).toBe("kata_relay");
    expect(WIRE_RELAY_PUBLIC_CLIENT_IDS).toEqual(["kata-mobile", "kata-web"]);
    expect(isRelayProviderKind("kata_relay")).toBe(true);
    expect(isRelayPublicClientId("kata-mobile")).toBe(true);
    expect(isRelayPublicClientId("kata-web")).toBe(true);
    expect(isRelayPublicClientId("t3-mobile")).toBe(false);
    expect(WIRE_MOBILE_CLIENT_ID).toBe("kata-mobile");
    expect(WIRE_WEB_CLIENT_ID).toBe("kata-web");
    expect(WIRE_ENVIRONMENT_WELL_KNOWN_PATH).toBe("/.well-known/kata/environment");
    expect(WIRE_ENVIRONMENT_ISSUER_PREFIX).toBe("kata-env:");
    expect(wireEnvironmentIssuer("env-1")).toBe("kata-env:env-1");
    expect(WIRE_CONNECT_API_PREFIX).toBe("/api/kata-connect");
    expect(WIRE_RELAY_CLERK_JWT_TEMPLATE).toBe("kata-relay");
    expect(WIRE_RELAY_CLERK_JWT_AUDIENCE).toBe("kata-code-relay");
    expect([
      WIRE_RELAY_ENV_LINK_JWT_TYP,
      WIRE_RELAY_CLOUD_MINT_REQUEST_JWT_TYP,
      WIRE_RELAY_CLOUD_HEALTH_REQUEST_JWT_TYP,
      WIRE_RELAY_ENV_MINT_RESPONSE_JWT_TYP,
      WIRE_RELAY_ENV_HEALTH_RESPONSE_JWT_TYP,
      WIRE_RELAY_ENV_ACTIVITY_JWT_TYP,
      WIRE_RELAY_LINK_CHALLENGE_JWT_TYP,
      WIRE_RELAY_DPOP_ACCESS_JWT_TYP,
    ]).toEqual([
      "kata-env-link+jwt",
      "kata-cloud-mint+jwt",
      "kata-cloud-health+jwt",
      "kata-env-mint+jwt",
      "kata-env-health+jwt",
      "kata-env-activity+jwt",
      "kata-link-challenge+jwt",
      "kata-relay-dpop-access+jwt",
    ]);
  });

  it("exposes Kata descriptor and broker paths while preserving neutral Connect routes", () => {
    const paths = Object.keys(OpenApi.fromApi(EnvironmentHttpApi).paths ?? {});
    expect(paths).toEqual(
      expect.arrayContaining([
        WIRE_ENVIRONMENT_WELL_KNOWN_PATH,
        `${WIRE_CONNECT_API_PREFIX}/health`,
        `${WIRE_CONNECT_API_PREFIX}/mint-credential`,
        "/api/connect/link-proof",
        "/api/connect/relay-config",
        "/api/connect/link-state",
        "/api/connect/unlink",
        "/api/connect/preferences",
        "/api/connect/mint-credential",
      ]),
    );
    expect(paths).not.toContain("/api/t3-connect/health");
    expect(paths).not.toContain("/api/t3-connect/mint-credential");
    expect(paths).not.toContain("/.well-known/t3/environment");
  });
});
