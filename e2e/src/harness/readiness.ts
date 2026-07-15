import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";

export async function waitForTcpPort(
  port: number,
  timeoutMs = E2E_TIMEOUTS.devStackMs,
  signal?: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("waitForTcpPort aborted");
    }

    const ready = await new Promise<boolean>((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });

    if (ready) {
      return;
    }

    await delay(250, undefined, signal ? { signal } : undefined);
  }

  throw new Error(`Timed out waiting for dev stack port 127.0.0.1:${port}.`);
}
