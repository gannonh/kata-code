import { describe, expect, it } from "vite-plus/test";

import { shouldReconnectAfterHeartbeatTimeout } from "./wsRpcProtocol.ts";

describe("shouldReconnectAfterHeartbeatTimeout", () => {
  it("reconnects when a visible page misses a visible-page heartbeat", () => {
    expect(shouldReconnectAfterHeartbeatTimeout(false, false)).toBe(true);
  });

  it("keeps the socket when the missed heartbeat was sent while hidden", () => {
    expect(shouldReconnectAfterHeartbeatTimeout(true, false)).toBe(false);
  });

  it("keeps the socket while the page remains hidden", () => {
    expect(shouldReconnectAfterHeartbeatTimeout(false, true)).toBe(false);
    expect(shouldReconnectAfterHeartbeatTimeout(true, true)).toBe(false);
  });
});
