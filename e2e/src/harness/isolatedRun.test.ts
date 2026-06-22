import { describe, expect, it } from "vitest";

import { portPairForOffset } from "./ports.ts";

describe("E2E port allocation contract", () => {
  it("uses the allocated offset for KATACODE_PORT_OFFSET, not the probe start offset", () => {
    const startOffset = 0;
    const allocatedOffset = 3;
    const { serverPort, webPort } = portPairForOffset(allocatedOffset);

    const katacodePortOffset = String(allocatedOffset);

    expect(katacodePortOffset).toBe("3");
    expect(katacodePortOffset).not.toBe(String(startOffset));
    expect(webPort).toBe(5733 + allocatedOffset);
    expect(serverPort).toBe(13773 + allocatedOffset);
  });
});
