import { once } from "node:events";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { assert, describe, it } from "@effect/vitest";

import { claimAvailablePortOffset } from "./dev-ports.ts";

describe("claimAvailablePortOffset", () => {
  it("releases promptly after a client probes a claimed port", async () => {
    const claim = await claimAvailablePortOffset(4_000);
    const socket = createConnection(claim.serverPort, "127.0.0.1");
    let released = false;

    try {
      await once(socket, "connect");
      await Promise.race([
        claim.release().then(() => {
          released = true;
        }),
        delay(1_000).then(() => {
          throw new Error("Port claim release timed out after a client probe");
        }),
      ]);
      assert.isTrue(released);
    } finally {
      socket.destroy();
      if (!released) await claim.release();
    }
  });
});
