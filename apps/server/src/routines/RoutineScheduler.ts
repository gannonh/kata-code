import * as NodeCrypto from "node:crypto";
import { RoutineError } from "@kata-sh/code-contracts";

import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";

import { RoutineDispatcher } from "./RoutineDispatcher.ts";
import { RoutineRunObserver } from "./RoutineRunObserver.ts";
import { RoutineStore } from "./RoutineStore.ts";

export interface RoutineSchedulerShape {
  readonly owner: string;
  readonly tick: Effect.Effect<void, RoutineError>;
  readonly start: Effect.Effect<void, never, Scope.Scope>;
  /**
   * Asks the dispatch loop to drain now instead of at its next interval. The
   * webhook callback offers this after committing a delivery so a run starts
   * without waiting a second; only the lease-holding owner ever claims.
   */
  readonly wake: Effect.Effect<void>;
}

export class RoutineScheduler extends Context.Service<RoutineScheduler, RoutineSchedulerShape>()(
  "@kata-sh/code-cli/routines/RoutineScheduler",
) {}

const makeRoutineScheduler = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const dispatcher = yield* RoutineDispatcher;
  const observer = yield* RoutineRunObserver;
  const owner = `routine-worker:${NodeCrypto.randomUUID()}`;
  // One pending wake is enough: the loop drains every claimable run per pass.
  const wakeups = yield* Queue.make<void>({ capacity: 1, strategy: "dropping" });
  const wake: RoutineSchedulerShape["wake"] = Queue.offer(wakeups, undefined).pipe(Effect.asVoid);

  // Admission owns the short scheduler lease and must keep running while a
  // launch waits on external work. Dispatching runs on a separate loop so a
  // slow launch cannot make a live process look like a crashed scheduler.
  // Each tick also records orchestration progress for launched runs.
  const tick: RoutineSchedulerShape["tick"] = DateTime.now.pipe(
    Effect.map(DateTime.toEpochMillis),
    Effect.flatMap((now) => store.tick(owner, now).pipe(Effect.andThen(observer.observe))),
  );
  const admissionLoop = Effect.forever(
    tick.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("routine scheduler admission tick failed", { cause }),
      ),
      Effect.andThen(Effect.sleep("1 second")),
    ),
  );
  const dispatchLoop = Effect.forever(
    dispatcher.drain(owner).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause as Cause.Cause<never>)
          : Effect.logWarning("routine dispatcher drain failed", { cause }),
      ),
      Effect.andThen(Effect.raceFirst(Queue.take(wakeups), Effect.sleep("1 second"))),
    ),
  );
  const start: RoutineSchedulerShape["start"] = Effect.gen(function* () {
    // Catch up on orchestration events the previous process did not observe,
    // including runs that its shutdown or this startup cancelled.
    yield* observer.observe.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("initial routine run observation failed", { cause }),
      ),
    );
    yield* tick.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("initial routine scheduler admission tick failed", { cause }),
      ),
    );
    yield* Effect.forkScoped(admissionLoop);
    yield* Effect.forkScoped(dispatchLoop);
  });

  return { owner, tick, start, wake } satisfies RoutineSchedulerShape;
});

export const RoutineSchedulerLive = Layer.effect(RoutineScheduler, makeRoutineScheduler);
