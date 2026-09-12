import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { RoutineError } from "@kata-sh/code-contracts";

import { failUnlessInterrupted } from "./RoutineDispatcher.ts";

it.effect("preserves interrupt-only causes instead of converting them to blocked", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.interrupt.pipe(
      Effect.catchCause(failUnlessInterrupted),
      Effect.exit,
    );
    assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
  }),
);

it.effect("converts non-interrupt failures into a blocked routine error", () =>
  Effect.gen(function* () {
    const error = yield* Effect.fail(new Error("worktree setup failed")).pipe(
      Effect.catchCause(failUnlessInterrupted),
      Effect.flip,
    );
    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
  }),
);
