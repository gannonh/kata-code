import { expect, it } from "@effect/vitest";
import { vi, beforeEach } from "vite-plus/test";
import { EnvironmentId, ProjectId, type OrchestrationProjectShell } from "@kata-sh/code-contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Option from "effect/Option";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";

const fixture = vi.hoisted(() => ({
  projects: [] as OrchestrationProjectShell[],
  creates: 0,
  fail: false,
  winner: false,
  snapshots: 0,
}));
vi.mock("../rpc/client.ts", () => ({
  subscribe: () =>
    Stream.suspend(() => {
      fixture.snapshots += 1;
      return Stream.succeed({ kind: "snapshot", snapshot: { projects: fixture.projects } });
    }),
  request: (
    _tag: string,
    input: {
      projectId: ProjectId;
      title: string;
      workspaceRoot: string;
      createWorkspaceRootIfMissing: boolean;
    },
  ) =>
    Effect.suspend(() => {
      fixture.creates += 1;
      expect(input.createWorkspaceRootIfMissing).toBe(false);
      if (!fixture.fail || fixture.winner)
        fixture.projects = [
          {
            id: input.projectId,
            title: input.title,
            workspaceRoot: input.workspaceRoot + "/",
            scripts: [],
            defaultModelSelection: null,
            createdAt: "2026-09-07T00:00:00Z",
            updatedAt: "2026-09-07T00:00:00Z",
          },
        ];
      return fixture.fail
        ? Effect.fail(new WorkspaceProjectError({ message: "Command was rejected" }))
        : Effect.succeed({ sequence: 1 });
    }),
}));
import { ensureWorkspaceProject, WorkspaceProjectError } from "./workspaceProject.ts";
const crypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size),
  digest: (_algorithm, data) => Effect.succeed(data),
});
const run = () =>
  Effect.gen(function* () {
    const supervisor = EnvironmentSupervisor.of({
      target: new PrimaryConnectionTarget({
        environmentId: EnvironmentId.make("test"),
        label: "Test",
        httpBaseUrl: "http://localhost",
        wsBaseUrl: "ws://localhost",
      }),
      state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
      session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
      prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
      connect: Effect.void,
      disconnect: Effect.void,
      retryNow: Effect.void,
    });
    return yield* ensureWorkspaceProject({
      workspaceRoot: "/workspace",
      title: "Repository",
    }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor));
  }).pipe(Effect.provideService(Crypto.Crypto, crypto));

beforeEach(() => {
  fixture.projects = [];
  fixture.creates = 0;
  fixture.fail = false;
  fixture.winner = false;
  fixture.snapshots = 0;
});
it.effect("reuses the authoritative project on repeated attachment", () =>
  Effect.gen(function* () {
    const first = yield* run();
    expect(yield* run()).toBe(first);
    expect(fixture.creates).toBe(1);
    expect(fixture.snapshots).toBe(3);
  }),
);
it.effect("uses a normalized concurrent winner after a rejected create", () =>
  Effect.gen(function* () {
    fixture.fail = true;
    fixture.winner = true;
    expect(yield* run()).toBe(fixture.projects[0]?.id);
    expect(fixture.snapshots).toBe(2);
  }),
);
it.effect("preserves a rejected command when authoritative reread has no winner", () =>
  Effect.gen(function* () {
    fixture.fail = true;
    const result = yield* run().pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") expect(result.failure.message).toBe("Command was rejected");
  }),
);
