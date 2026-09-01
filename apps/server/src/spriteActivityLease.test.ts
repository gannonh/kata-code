import type { TurnId } from "@kata-sh/code-contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  hasSpriteActivity,
  nextSpriteLeaseState,
  SPRITE_IDLE_GRACE_MS,
  SPRITE_TASK_REFRESH_MS,
  runSpriteTaskCommand,
  spriteTaskArgs,
  spriteTaskHttpCode,
  type SpriteLeaseState,
} from "./spriteActivityLease.ts";

const idle: SpriteLeaseState = {
  held: false,
  lastDemandAt: null,
  lastRefreshAt: null,
};

function runnerResult(stdout: string, code = 0 as ChildProcessSpawner.ExitCode) {
  return {
    run: () =>
      Effect.succeed({
        stdout,
        stderr: "",
        code,
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdoutInvalidUtf8: false,
        stderrInvalidUtf8: false,
      }),
  };
}

it("detects client, provider, and terminal activity", () => {
  const activity = (input: {
    connectedClientCount?: number;
    activeTurnId?: string;
    providerStatus?: "ready" | "running";
    hasRunningSubprocess?: boolean;
  }) =>
    hasSpriteActivity({
      connectedClientCount: input.connectedClientCount ?? 0,
      providerSessions: [
        {
          activeTurnId: input.activeTurnId as TurnId | undefined,
          status: input.providerStatus ?? "ready",
        },
      ],
      terminals: [{ hasRunningSubprocess: input.hasRunningSubprocess ?? false }],
    });

  assert.isTrue(activity({ connectedClientCount: 1 }));
  assert.isTrue(activity({ activeTurnId: "turn-1" }));
  assert.isTrue(activity({ providerStatus: "running" }));
  assert.isTrue(activity({ hasRunningSubprocess: true }));
  assert.isFalse(activity({}));
});

it.effect("handles automatic Sprite task HTTP results", () =>
  Effect.gen(function* () {
    const releaseArgs = spriteTaskArgs("release");
    assert.include(spriteTaskArgs("refresh"), "--fail-with-body");
    assert.include(releaseArgs, "\n%{http_code}");
    assert.isFalse(releaseArgs.includes("--output"));
    assert.isFalse(releaseArgs.includes("-o"));
    assert.equal(spriteTaskHttpCode("deleted\n204"), "204");
    assert.equal(spriteTaskHttpCode("\n404"), "404");
    assert.equal(spriteTaskHttpCode("404"), "404");

    const transportError = yield* runSpriteTaskCommand(
      runnerResult("", 22 as ChildProcessSpawner.ExitCode),
      spriteTaskArgs("refresh"),
    ).pipe(Effect.flip);
    assert.include(transportError, "code 22");

    yield* runSpriteTaskCommand(runnerResult("\n404"), spriteTaskArgs("release"), {
      acceptNotFound: true,
    });
    yield* runSpriteTaskCommand(runnerResult("deleted\n204"), spriteTaskArgs("release"), {
      acceptNotFound: true,
    });
    const serverError = yield* runSpriteTaskCommand(
      runnerResult("error-body\n503"),
      spriteTaskArgs("release"),
      { acceptNotFound: true },
    ).pipe(Effect.flip);
    assert.include(serverError, "HTTP 503");
  }),
);

it("refreshes the Sprite task during activity and releases it after the idle grace", () => {
  const active = nextSpriteLeaseState({ current: idle, demand: true, now: 1_000 });
  assert.deepEqual(active, {
    action: "refresh",
    next: { held: true, lastDemandAt: 1_000, lastRefreshAt: 1_000 },
  });

  const beforeRefresh = nextSpriteLeaseState({
    current: active.next,
    demand: false,
    now: 1_000 + SPRITE_TASK_REFRESH_MS - 1,
  });
  assert.equal(beforeRefresh.action, "none");

  const refreshed = nextSpriteLeaseState({
    current: beforeRefresh.next,
    demand: false,
    now: 1_000 + SPRITE_TASK_REFRESH_MS,
  });
  assert.equal(refreshed.action, "refresh");

  const released = nextSpriteLeaseState({
    current: refreshed.next,
    demand: false,
    now: 1_000 + SPRITE_IDLE_GRACE_MS,
  });
  assert.equal(released.action, "release");
  assert.isFalse(released.next.held);
});

it("does not create a Sprite task without observed activity", () => {
  assert.equal(nextSpriteLeaseState({ current: idle, demand: false, now: 1_000 }).action, "none");
});

it("extends the Sprite idle grace when activity resumes", () => {
  const first = nextSpriteLeaseState({ current: idle, demand: true, now: 1_000 });
  const resumed = nextSpriteLeaseState({
    current: first.next,
    demand: true,
    now: 1_000 + SPRITE_IDLE_GRACE_MS - 1,
  });
  const stillHeld = nextSpriteLeaseState({
    current: resumed.next,
    demand: false,
    now: 1_000 + SPRITE_IDLE_GRACE_MS * 2 - 2,
  });

  assert.isTrue(stillHeld.next.held);
});
