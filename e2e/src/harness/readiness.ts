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

/**
 * Cap each readiness probe so one hung request cannot consume the entire
 * startup budget. A cold Vite dev server under load can accept the TCP
 * connection and then stall the first response for longer than the whole
 * dev-stack timeout; without a per-attempt cap the loop never retries.
 */
const WEB_DEV_PROBE_ATTEMPT_MS = 3_000;

export async function waitForWebDevServer(
  webPort: number,
  timeoutMs = E2E_TIMEOUTS.devStackMs,
  signal?: AbortSignal,
): Promise<void> {
  const url = `http://127.0.0.1:${webPort}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("waitForWebDevServer aborted");
    }

    const attemptSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(WEB_DEV_PROBE_ATTEMPT_MS)])
      : AbortSignal.timeout(WEB_DEV_PROBE_ATTEMPT_MS);
    try {
      const response = await fetch(url, { redirect: "manual", signal: attemptSignal });
      if (response.status > 0) {
        return;
      }
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
    }

    await delay(500, undefined, signal ? { signal } : undefined);
  }

  throw new Error(`Timed out waiting for Vite dev server at ${url}.`);
}
