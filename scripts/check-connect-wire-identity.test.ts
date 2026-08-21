import { describe, expect, it } from "@effect/vitest";

import { findConnectWireViolations, scanConnectWireFiles } from "./check-connect-wire-identity.ts";

describe("Connect wire scan", () => {
  it("passes the scoped current implementation", () => {
    expect(scanConnectWireFiles()).toEqual([]);
  });

  it("flags stale protocol and resource literals", () => {
    expect(
      findConnectWireViolations([
        ["packages/contracts/src/relay.ts", 'const old = "t3_relay";'],
        [
          "infra/relay/src/observability.ts",
          'name: relayResourceNameForStage("t3-code-relay-traces", stage),',
        ],
        ["docs/operations/relay-observability.md", "`t3-code-relay-traces-prod`"],
      ]),
    ).toEqual([
      {
        path: "packages/contracts/src/relay.ts",
        line: 1,
        literal: "t3_relay",
      },
      {
        path: "infra/relay/src/observability.ts",
        line: 1,
        literal: "t3-code-relay",
      },
      {
        path: "docs/operations/relay-observability.md",
        line: 1,
        literal: "t3-code-relay",
      },
    ]);
  });
});
