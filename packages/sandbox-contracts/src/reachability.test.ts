import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { SandboxReachabilityKind } from "./reachability.ts";
import { AdvertisedEndpointReachability } from "@kata-sh/code-contracts";

// Hoist compiled schema predicates to module scope (kata-code/no-inline-schema-compile).
const isReachability = Schema.is(AdvertisedEndpointReachability);
const isSandboxReachability = Schema.is(SandboxReachabilityKind);

describe("SandboxReachabilityKind forward-mapping totality", () => {
  it("every SandboxReachabilityKind value maps onto an existing AdvertisedEndpointReachability literal", () => {
    // The V1 sandbox kinds are loopback (container) and public (cloud tunnel),
    // plus private-network reserved for future ssh/tailnet drivers.
    const sandboxKinds = ["loopback", "public", "private-network"] as const;
    // Forward mapping must be total: every sandbox kind is a valid reachability.
    for (const kind of sandboxKinds) {
      expect(isReachability(kind)).toBe(true);
      // And it round-trips through SandboxReachabilityKind.
      expect(isSandboxReachability(kind)).toBe(true);
    }
  });

  it("lan is intentionally unused by any V1 sandbox kind (reverse mapping is not total)", () => {
    // lan is a valid AdvertisedEndpointReachability but no V1 sandbox kind uses it.
    expect(isReachability("lan")).toBe(true);
    expect(isSandboxReachability("lan")).toBe(false);
  });
});
