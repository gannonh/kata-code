// @effect-diagnostics globalDate:off - fake-timer-driven deadline arithmetic in the keepalive test.
// @effect-diagnostics globalTimers:off - fake timers drive the scheduler ticks.
// @effect-diagnostics effect(runEffectInsideEffect):off - the keepalive scheduler runs Effect.runPromise from a setInterval callback (host-side scheduler, not an Effect-internal fork).
// @effect-diagnostics anyUnknownInErrorContext:off - fake driver returns a plain error shape for the lapse path.
import { describe, expect, it, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";

import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";

import { startSessionKeepalive } from "./sessionKeepalive.ts";

class FakeKeepaliveError extends Data.TaggedError("SandboxProviderError")<{
  readonly reason: "unknown";
  readonly message: string;
}> {}

function fakeDriver(opts: { renewFailsAt?: number }): {
  driver: SandboxProvider;
  renewCalls: Array<{ deltaMs: number }>;
} {
  const renewCalls: Array<{ deltaMs: number }> = [];
  let calls = 0;
  const driver = {
    renewTimeout: {
      renewTimeout: (_handle: SandboxHandle, deltaMs: number) => {
        renewCalls.push({ deltaMs });
        calls += 1;
        if (opts.renewFailsAt !== undefined && calls >= opts.renewFailsAt) {
          return Effect.fail(
            new FakeKeepaliveError({ reason: "unknown", message: "plan cap reached" }),
          );
        }
        return Effect.void;
      },
    },
  } as unknown as SandboxProvider;
  return { driver, renewCalls };
}

const fakeHandle: SandboxHandle = {
  driverKind: "vercel" as never,
  instanceId: "inst_1",
  handle: { sandboxId: "sb-1" },
};

describe("startSessionKeepalive", () => {
  it("emits the initial deadline immediately and extends by the elapsed delta on each tick", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    const deadlines: number[] = [];
    const { driver, renewCalls } = fakeDriver({});
    const ka = startSessionKeepalive({
      driver,
      handle: fakeHandle,
      timeoutMs: 180_000,
      onDeadline: (d) => deadlines.push(d),
      onLapse: () => undefined,
    });
    // Initial deadline emitted synchronously.
    expect(deadlines).toEqual([start + 180_000]);
    // advanceTimersByTimeAsync flushes the renew promise microtask.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(renewCalls).toHaveLength(1);
    // delta = now(60s later) + 180s - deadline(start+180s) = 60s.
    expect(renewCalls[0]?.deltaMs).toBe(60_000);
    expect(deadlines[1]).toBe(start + 180_000 + 60_000);
    ka.stop();
    vi.useRealTimers();
  });

  it("lapses and stops when renewal fails", async () => {
    vi.useFakeTimers();
    const lapsed: string[] = [];
    const { driver } = fakeDriver({ renewFailsAt: 1 });
    const ka = startSessionKeepalive({
      driver,
      handle: fakeHandle,
      timeoutMs: 180_000,
      onDeadline: () => undefined,
      onLapse: (r) => lapsed.push(r),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(lapsed).toEqual(["plan cap reached"]);
    // After lapse, advancing timers does not call onLapse again.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(lapsed).toHaveLength(1);
    ka.stop();
    vi.useRealTimers();
  });
});
