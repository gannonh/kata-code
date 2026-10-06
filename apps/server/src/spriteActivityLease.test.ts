import {
  ThreadId,
  type OrchestrationV2AppThreadLineage,
  type OrchestrationV2ProviderSession,
  type ThreadPullRequestLink,
  type ThreadPullRequestWatch,
} from "@kata-sh/code-contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as SqlitePersistence from "./persistence/Sqlite.ts";
import {
  hasSpriteActivity,
  nextSpriteLeaseState,
  readOpenProviderSessions,
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

const watch: ThreadPullRequestWatch = {
  startedAt: "2026-10-05T10:00:00.000Z",
  headSha: "abc123",
  failedChecks: [],
  passed: false,
  passedChecks: [],
  remarksThrough: "2026-10-05T10:00:00.000Z",
  remarkIds: [],
  conflicting: false,
  wakes: 0,
};

const topLevel: OrchestrationV2AppThreadLineage = {
  parentThreadId: null,
  relationshipToParent: null,
  rootThreadId: ThreadId.make("thread-1"),
};

function pullRequestLink(input: {
  readonly watched: boolean;
  readonly source?: ThreadPullRequestLink["source"];
}): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "gannonh/kata-code",
    number: 42,
    url: "https://github.com/gannonh/kata-code/pull/42",
    source: input.source ?? "agent",
    linkedAt: "2026-10-05T10:00:00.000Z",
    snapshot: null,
    stack: null,
    ...(input.watched ? { watch } : {}),
  };
}

function noActivityExcept(
  pullRequestThreads: Parameters<typeof hasSpriteActivity>[0]["pullRequestThreads"],
) {
  return hasSpriteActivity({
    connectedClientCount: 0,
    providerSessions: [{ status: "ready" }],
    terminals: [{ hasRunningSubprocess: false }],
    pullRequestThreads,
  });
}

it("detects client, provider, and terminal activity", () => {
  const activity = (input: {
    connectedClientCount?: number;
    providerStatus?: OrchestrationV2ProviderSession["status"];
    hasRunningSubprocess?: boolean;
  }) =>
    hasSpriteActivity({
      connectedClientCount: input.connectedClientCount ?? 0,
      providerSessions: [{ status: input.providerStatus ?? "ready" }],
      terminals: [{ hasRunningSubprocess: input.hasRunningSubprocess ?? false }],
      pullRequestThreads: [],
    });

  assert.isTrue(activity({ connectedClientCount: 1 }));
  assert.isTrue(activity({ providerStatus: "starting" }));
  assert.isTrue(activity({ providerStatus: "running" }));
  assert.isTrue(activity({ providerStatus: "waiting" }));
  assert.isTrue(activity({ hasRunningSubprocess: true }));
  assert.isFalse(activity({}));
  assert.isFalse(activity({ providerStatus: "error" }));
  assert.isFalse(activity({ providerStatus: "stopped" }));
});

it("counts a pull request watch the sweep reads as activity", () => {
  const settledAt = DateTime.makeUnsafe("2026-10-05T11:00:00.000Z");

  assert.isTrue(
    noActivityExcept([
      {
        lineage: topLevel,
        settledOverride: null,
        settledAt: null,
        pullRequests: [pullRequestLink({ watched: true })],
      },
    ]),
  );
  assert.isTrue(
    noActivityExcept([
      {
        lineage: topLevel,
        settledOverride: "active",
        settledAt: null,
        pullRequests: [pullRequestLink({ watched: false }), pullRequestLink({ watched: true })],
      },
    ]),
  );
  assert.isFalse(
    noActivityExcept([
      {
        lineage: topLevel,
        settledOverride: null,
        settledAt: null,
        pullRequests: [pullRequestLink({ watched: false })],
      },
    ]),
  );
  assert.isFalse(
    noActivityExcept([
      {
        lineage: topLevel,
        settledOverride: null,
        settledAt: null,
        pullRequests: [pullRequestLink({ watched: true, source: "stack-dismissed" })],
      },
    ]),
  );
  assert.isFalse(
    noActivityExcept([
      {
        lineage: topLevel,
        settledOverride: "settled",
        settledAt: null,
        pullRequests: [pullRequestLink({ watched: true })],
      },
    ]),
  );
  assert.isFalse(
    noActivityExcept([
      {
        lineage: topLevel,
        settledOverride: null,
        settledAt,
        pullRequests: [pullRequestLink({ watched: true })],
      },
    ]),
  );
  // The sweep ends a subagent's watch without reading it, so it is not work to stay awake for.
  assert.isFalse(
    noActivityExcept([
      {
        lineage: {
          parentThreadId: ThreadId.make("thread-parent"),
          relationshipToParent: "subagent",
          rootThreadId: ThreadId.make("thread-parent"),
        },
        settledOverride: null,
        settledAt: null,
        pullRequests: [pullRequestLink({ watched: true })],
      },
    ]),
  );
});

it("holds the Sprite task past the idle grace until the pull request watch ends", () => {
  const watched = [
    {
      lineage: topLevel,
      settledOverride: null,
      settledAt: null,
      pullRequests: [pullRequestLink({ watched: true })],
    },
  ];
  const unwatched = [
    {
      lineage: topLevel,
      settledOverride: null,
      settledAt: null,
      pullRequests: [pullRequestLink({ watched: false })],
    },
  ];
  const watchEndsAtMinute = 30;

  let state = idle;
  const actionByMinute: Array<string> = [];
  for (let minute = 0; minute < 45; minute++) {
    const decision = nextSpriteLeaseState({
      current: state,
      demand: noActivityExcept(minute < watchEndsAtMinute ? watched : unwatched),
      now: minute * 60_000,
    });
    state = decision.next;
    actionByMinute.push(decision.action);
  }

  assert.deepEqual(actionByMinute.slice(0, 39), Array(39).fill("refresh"));
  assert.equal(actionByMinute[39], "release");
  assert.deepEqual(actionByMinute.slice(40), Array(5).fill("none"));
});

it.effect("reads open provider sessions from the V2 projection", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const [id, status] of [
      ["session-running", "running"],
      ["session-ready", "ready"],
      ["session-stopped", "stopped"],
    ] as const) {
      yield* sql`
        INSERT INTO orchestration_v2_projection_provider_sessions (
          provider_session_id, thread_id, provider, status, model, updated_at, payload_json
        ) VALUES (${id}, NULL, 'codex', ${status}, NULL, '2026-10-03T00:00:00.000Z', '{}')
      `;
    }
    const sessions = yield* readOpenProviderSessions;
    assert.deepEqual(sessions.map((session) => session.status).toSorted(), ["ready", "running"]);
    assert.isTrue(
      hasSpriteActivity({
        connectedClientCount: 0,
        providerSessions: sessions,
        terminals: [],
        pullRequestThreads: [],
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

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
