/**
 * KeyedDrainableWorker - Runs items one at a time per key, and different keys
 * concurrently, with a `drain()` effect that resolves once nothing is queued or
 * running.
 *
 * Items that share a key keep their enqueue order. A slow item only delays the
 * items behind it under the same key. A lane exists only while it has work, so
 * idle keys hold no fiber.
 *
 * @module KeyedDrainableWorker
 */
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import * as TxRef from "effect/TxRef";

export interface KeyedDrainableWorker<A> {
  /** Queue an item behind earlier items with the same key. */
  readonly enqueue: (item: A) => Effect.Effect<void>;

  /** Resolves when every queued item, under every key, has finished processing. */
  readonly drain: Effect.Effect<void>;
}

export const makeKeyedDrainableWorker = <A, K, R>(options: {
  readonly keyOf: (item: A) => K;
  readonly process: (item: A) => Effect.Effect<void, never, R>;
}): Effect.Effect<KeyedDrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const services = yield* Effect.context<R>();
    const outstanding = yield* TxRef.make(0);
    const lanes = new Map<K, Array<A>>();

    const runLane = (key: K): Effect.Effect<void, never, R> =>
      Effect.suspend(() => {
        const next = lanes.get(key)?.shift();
        if (next === undefined) {
          lanes.delete(key);
          return Effect.void;
        }
        return Effect.ensuring(
          options.process(next),
          TxRef.update(outstanding, (n) => n - 1).pipe(Effect.tx),
        ).pipe(Effect.andThen(runLane(key)));
      });

    const enqueue: KeyedDrainableWorker<A>["enqueue"] = (item) =>
      TxRef.update(outstanding, (n) => n + 1).pipe(
        Effect.tx,
        Effect.andThen(
          Effect.suspend(() => {
            const key = options.keyOf(item);
            const lane = lanes.get(key);
            if (lane) {
              lane.push(item);
              return Effect.void;
            }
            lanes.set(key, [item]);
            return runLane(key).pipe(
              Effect.provideContext(services),
              Effect.forkIn(scope),
              Effect.asVoid,
            );
          }),
        ),
      );

    const drain: KeyedDrainableWorker<A>["drain"] = TxRef.get(outstanding).pipe(
      Effect.tap((n) => (n > 0 ? Effect.txRetry : Effect.void)),
      Effect.tx,
    );

    return { enqueue, drain } satisfies KeyedDrainableWorker<A>;
  });
