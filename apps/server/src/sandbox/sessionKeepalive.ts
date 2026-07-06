/**
 * `sessionKeepalive` — host-side deadline scheduler for sandbox sessions.
 *
 * Vercel `extendTimeout(deltaMs)` is additive and the remaining lifetime is
 * not readable, so the deadline is tracked host-side. The scheduler renews
 * the sandbox timeout on an interval and surfaces lapse when renewal fails
 * (the plan cap is reached or the sandbox stopped). `unref`'d so it never
 * keeps the process alive on its own.
 *
 * @module sessionKeepalive
 */
// @effect-diagnostics globalDate:off - deadline arithmetic is host-side by design (extendTimeout is additive, remaining time unreadable).
// @effect-diagnostics globalTimers:off - setInterval/unref scheduler is the host-side keepalive loop (not an Effect Schedule).
import * as Effect from "effect/Effect";

import type { SandboxHandle, SandboxProvider } from "@kata-sh/code-sandbox/driver";

export interface KeepaliveHandle {
  /** Stop the scheduler. Idempotent. */
  stop(): void;
}

export interface StartSessionKeepaliveInput {
  /** Driver with a `renewTimeout` capability (caller guards). */
  readonly driver: SandboxProvider;
  readonly handle: SandboxHandle;
  /** The sandbox's configured timeout window (ms). */
  readonly timeoutMs: number;
  /** Called with the current deadline (epoch ms) immediately and after each renewal. */
  readonly onDeadline: (deadlineEpochMs: number) => void;
  /** Called with a reason string when the session lapses (renewal failed). */
  readonly onLapse: (reason: string) => void;
}

/**
 * Start a keepalive scheduler. The initial deadline is `now + timeoutMs`;
 * `onDeadline` fires immediately. Each tick (capped to 1–10 min) extends the
 * sandbox timeout by the elapsed delta and bumps the deadline. On renewal
 * failure the scheduler stops and `onLapse` fires with the error message.
 */
export function startSessionKeepalive(input: StartSessionKeepaliveInput): KeepaliveHandle {
  let deadlineEpochMs = Date.now() + input.timeoutMs;
  let stopped = false;

  input.onDeadline(deadlineEpochMs);

  const intervalMs = Math.max(60_000, Math.min(Math.floor(input.timeoutMs / 3), 600_000));
  const timer = setInterval(() => {
    if (stopped) return;
    const delta = Date.now() + input.timeoutMs - deadlineEpochMs;
    if (delta <= 0) return;
    Effect.runPromise(input.driver.renewTimeout!.renewTimeout(input.handle, delta)).then(
      () => {
        if (stopped) return;
        deadlineEpochMs += delta;
        input.onDeadline(deadlineEpochMs);
      },
      (error) => {
        if (stopped) return;
        stop();
        input.onLapse(error instanceof Error ? error.message : String(error));
      },
    );
  }, intervalMs);
  timer.unref();

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  }

  return { stop };
}
