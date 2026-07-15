import { describe, expect, it } from "vitest";

import { resolvePortScanStart } from "./isolatedRun.ts";
import { portPairForOffset } from "./ports.ts";

describe("E2E port allocation contract", () => {
  it("advances past prior stacks and Playwright worker restarts", () => {
    expect(resolvePortScanStart(1, undefined)).toBe(1);
    expect(resolvePortScanStart(1, 4)).toBe(4);
    expect(resolvePortScanStart(6, 4)).toBe(6);
    expect(resolvePortScanStart(1, undefined, 2)).toBe(41);
    expect(resolvePortScanStart(1, 30, 2)).toBe(41);
  });

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
