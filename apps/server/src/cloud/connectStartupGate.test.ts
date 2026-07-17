import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";

import {
  completeConnectStartupGate,
  resetConnectStartupGateForTests,
  waitForConnectStartupGate,
} from "./connectStartupGate.ts";

it.effect("opens the Connect startup gate for waiters", () =>
  Effect.scoped(
    Effect.gen(function* () {
      resetConnectStartupGateForTests();

      yield* Effect.forkScoped(waitForConnectStartupGate);
      yield* completeConnectStartupGate;
      yield* waitForConnectStartupGate;

      // Completing again stays idempotent for multi-path server startup.
      yield* completeConnectStartupGate;
      expect(true).toBe(true);
    }),
  ),
);
