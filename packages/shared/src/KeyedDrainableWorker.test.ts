import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";

import { makeKeyedDrainableWorker } from "./KeyedDrainableWorker.ts";

interface Item {
  readonly key: string;
  readonly name: string;
}

describe("makeKeyedDrainableWorker", () => {
  it.live("runs a key while another key is blocked, and keeps order within a key", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];
        const releaseA1 = yield* Deferred.make<void>();
        const a1Started = yield* Deferred.make<void>();

        const worker = yield* makeKeyedDrainableWorker({
          keyOf: (item: Item) => item.key,
          process: (item: Item) =>
            Effect.gen(function* () {
              if (item.name === "a1") {
                yield* Deferred.succeed(a1Started, undefined);
                yield* Deferred.await(releaseA1);
              }
              processed.push(item.name);
            }),
        });

        yield* worker.enqueue({ key: "a", name: "a1" });
        yield* Deferred.await(a1Started);
        yield* worker.enqueue({ key: "a", name: "a2" });
        yield* worker.enqueue({ key: "b", name: "b1" });

        // b1 finishes while a1 still blocks a2.
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        expect(processed).toEqual(["b1"]);

        yield* Deferred.succeed(releaseA1, undefined);
        yield* worker.drain;
        expect(processed).toEqual(["b1", "a1", "a2"]);
      }),
    ),
  );

  it.live("starts a fresh lane for a key after it went idle", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];
        const worker = yield* makeKeyedDrainableWorker({
          keyOf: (item: Item) => item.key,
          process: (item: Item) => Effect.sync(() => void processed.push(item.name)),
        });

        yield* worker.enqueue({ key: "a", name: "first" });
        yield* worker.drain;
        yield* worker.enqueue({ key: "a", name: "second" });
        yield* worker.drain;

        expect(processed).toEqual(["first", "second"]);
      }),
    ),
  );
});
