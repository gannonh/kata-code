import { it } from "@effect/vitest";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { expect } from "vite-plus/test";

import { startEnvironmentLeaseMaintenance } from "./environmentLeaseMaintenance.ts";

class LeaseMaintenanceTestError extends Data.TaggedError("LeaseMaintenanceTestError") {}

it.effect("starts lease renewal when startup reconciliation fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let reconcileCalls = 0;
      let renewalCalls = 0;

      yield* startEnvironmentLeaseMaintenance({
        startupReconcile: Effect.sync(() => {
          reconcileCalls += 1;
        }).pipe(Effect.andThen(new LeaseMaintenanceTestError())),
        renewLeases: Effect.sync(() => {
          renewalCalls += 1;
        }),
        renewalInterval: Duration.minutes(5),
      });
      yield* Effect.yieldNow;

      expect(reconcileCalls).toBe(1);
      expect(renewalCalls).toBe(1);
    }),
  ),
);

it.effect("continues lease renewal after an iteration fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let renewalCalls = 0;

      yield* startEnvironmentLeaseMaintenance({
        startupReconcile: Effect.void,
        renewLeases: Effect.suspend(() => {
          renewalCalls += 1;
          return renewalCalls === 1 ? new LeaseMaintenanceTestError() : Effect.void;
        }),
        renewalInterval: Duration.minutes(5),
      });
      yield* Effect.yieldNow;
      expect(renewalCalls).toBe(1);

      yield* TestClock.adjust(Duration.minutes(5));
      yield* Effect.yieldNow;

      expect(renewalCalls).toBe(2);
    }),
  ).pipe(Effect.provide(TestClock.layer())),
);
