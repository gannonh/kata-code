import { randomUUID } from "node:crypto";
import { RoutineError } from "@kata-sh/code-contracts";

import * as Context from "effect/Context";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import { RoutineDispatcher } from "./RoutineDispatcher.ts";
import { RoutineStore } from "./RoutineStore.ts";

export interface RoutineSchedulerShape {
  readonly owner: string;
  readonly tick: Effect.Effect<void, RoutineError>;
  readonly start: Effect.Effect<void, never, Scope.Scope>;
}

export class RoutineScheduler extends Context.Service<RoutineScheduler, RoutineSchedulerShape>()(
  "@kata-sh/code-cli/routines/RoutineScheduler",
) {}

export const makeRoutineScheduler = Effect.gen(function* () {
  const store = yield* RoutineStore;
  const dispatcher = yield* RoutineDispatcher;
  const owner = `routine-worker:${randomUUID()}`;

  // Admission owns the short scheduler lease and must keep running while
  // workspace preparation or setup scripts are waiting on external work.
  // Dispatching runs on a separate loop so a slow preparation cannot make a
  // live process look like a crashed scheduler.
  const tick: RoutineSchedulerShape["tick"] = DateTime.now.pipe(
    Effect.map(DateTime.toEpochMillis),
    Effect.flatMap((now) =>
      store.tick(owner, now).pipe(Effect.andThen(store.recoverConsumed(now))),
    ),
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
          ? Effect.failCause(cause)
          : Effect.logWarning("routine dispatcher drain failed", { cause }),
      ),
      Effect.andThen(Effect.sleep("1 second")),
    ),
  );
  const start: RoutineSchedulerShape["start"] = Effect.gen(function* () {
    const initialNow = yield* DateTime.now.pipe(Effect.map(DateTime.toEpochMillis));
    yield* store
      .recoverConsumed(initialNow)
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("initial routine submission recovery failed", { cause }),
        ),
      );
    yield* tick.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("initial routine scheduler admission tick failed", { cause }),
      ),
    );
    yield* Effect.forkScoped(admissionLoop);
    return yield* dispatchLoop;
  });

  return { owner, tick, start } satisfies RoutineSchedulerShape;
});

export const RoutineSchedulerLive = Layer.effect(RoutineScheduler, makeRoutineScheduler);
