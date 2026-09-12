import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { RoutineError } from "@kata-sh/code-contracts";

import { failUnlessInterrupted } from "./RoutineDispatcher.ts";

class TestDispatchFailure extends Data.TaggedError("TestDispatchFailure")<{
  readonly message: string;
}> {}

it.effect("preserves interrupt-only causes instead of converting them to blocked", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.interrupt.pipe(
      Effect.catchCause(failUnlessInterrupted),
      Effect.exit,
    );
    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) {
      assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
    }
  }),
);

it.effect("converts non-interrupt failures into a blocked routine error", () =>
  Effect.gen(function* () {
    const error = yield* Effect.fail(
      new TestDispatchFailure({ message: "worktree setup failed" }),
    ).pipe(Effect.catchCause(failUnlessInterrupted), Effect.flip);
    assert.instanceOf(error, RoutineError);
    assert.equal(error.code, "blocked");
  }),
);
