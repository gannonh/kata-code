import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Process-wide latch so agent-activity publishing waits until Connect lease
 * renew/reconcile has settled (or timed out).
 *
 * Module-scoped so startup reconcile and AgentAwareness share one Deferred
 * across separately built Effect layers.
 */
const CONNECT_STARTUP_GATE_TIMEOUT = "30 seconds" as const;

let connectStartupDeferred = Deferred.makeUnsafe<void>();

/** Wait until Connect startup renew/reconcile settles (or the timeout fires). */
export const waitForConnectStartupGate: Effect.Effect<void> = Effect.suspend(() =>
  Deferred.await(connectStartupDeferred).pipe(
    Effect.timeoutOption(CONNECT_STARTUP_GATE_TIMEOUT),
    Effect.flatMap((settled) =>
      Option.isSome(settled)
        ? Effect.void
        : Effect.logWarning(
            "Kata Code Connect startup gate timed out; continuing agent-activity publishing",
          ),
    ),
  ),
);

/** Open the gate. Safe to call more than once. */
export const completeConnectStartupGate: Effect.Effect<void> = Effect.suspend(() =>
  Deferred.succeed(connectStartupDeferred, undefined).pipe(Effect.asVoid),
);

/** Test-only: open a fresh closed gate. */
export function resetConnectStartupGateForTests(): void {
  connectStartupDeferred = Deferred.makeUnsafe<void>();
}
