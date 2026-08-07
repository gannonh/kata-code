import { EnvironmentId, ThreadId } from "@kata-sh/code-contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { makeTaskWorkspace } from "./taskWorkspaceFixtures";
import {
  selectTaskOwnedThreadKeys,
  selectTaskRefsById,
  selectTaskByRef,
  selectTaskWorkspaces,
  useTaskWorkspaceStore,
} from "./taskWorkspaceStore";

const envA = EnvironmentId.make("environment-a");
const envB = EnvironmentId.make("environment-b");

describe("taskWorkspaceStore", () => {
  beforeEach(() => useTaskWorkspaceStore.getState().reset());

  it("keys tasks by environment and task id, and orders them for the sidebar", () => {
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: {
        sequence: 4,
        tasks: [
          makeTaskWorkspace({
            id: "task-old",
            updatedAt: "2026-07-28T17:00:00.000Z",
            environmentId: envA,
          }),
          makeTaskWorkspace({
            id: "task-new",
            updatedAt: "2026-07-28T18:00:00.000Z",
            environmentId: envA,
          }),
        ],
      },
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envB, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [
          makeTaskWorkspace({
            id: "task-other",
            updatedAt: "2026-07-28T19:00:00.000Z",
            environmentId: envB,
          }),
        ],
      },
    });

    const tasks = selectTaskWorkspaces(useTaskWorkspaceStore.getState());
    expect(tasks.map((task) => task.id)).toEqual(["task-other", "task-new", "task-old"]);
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envA, "task-new")).not.toBeNull();
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envB, "task-new")).toBeNull();
  });

  it("ignores stale task events per environment after reconnect", () => {
    const current = makeTaskWorkspace({
      id: "task-1",
      updatedAt: "2026-07-28T18:00:00.000Z",
      environmentId: envA,
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "task-upserted",
      sequence: 5,
      task: current,
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "task-upserted",
      sequence: 4,
      task: makeTaskWorkspace({
        id: "task-1",
        updatedAt: "2026-07-28T17:00:00.000Z",
        environmentId: envA,
      }),
    });

    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envA, "task-1")).toEqual(current);
  });

  it("keeps environment partitions independent on resubscribe", () => {
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [
          makeTaskWorkspace({
            id: "task-a",
            updatedAt: "2026-07-28T18:00:00.000Z",
            environmentId: envA,
          }),
        ],
      },
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envB, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [
          makeTaskWorkspace({
            id: "task-b",
            updatedAt: "2026-07-28T18:00:00.000Z",
            environmentId: envB,
          }),
        ],
      },
    });

    // Environment B reconnects and resubscribes: only its partition resets.
    useTaskWorkspaceStore.getState().resetEnvironment(envB);
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envA, "task-a")).not.toBeNull();
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envB, "task-b")).toBeNull();
  });

  it("claims every thread a task owns so the chat sidebar can hide them", () => {
    const task = makeTaskWorkspace({
      id: "task-guided",
      updatedAt: "2026-07-28T18:00:00.000Z",
      environmentId: envA,
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [
          {
            ...task,
            sessions: [
              {
                id: "session-1",
                stage: "questions",
                threadId: ThreadId.make("thread-clarify"),
                role: "primary",
                provider: null,
                status: "active",
                parentSessionId: null,
                contextManifestId: null,
                forkPoint: null,
                createdAt: "2026-07-28T18:00:00.000Z",
              },
            ],
            occurrences: [
              {
                id: "occurrence-1",
                stage: "plan",
                ordinal: 0,
                status: "completed",
                sessionId: null,
                threadId: ThreadId.make("thread-plan"),
                contextManifestId: null,
                artifactRevisionId: null,
                completionProposalId: null,
                gateOutcome: null,
                feedback: null,
                supersedesOccurrenceId: null,
                createdAt: "2026-07-28T18:00:00.000Z",
                completedAt: null,
              },
            ],
          },
        ],
      },
    });

    const owned = selectTaskOwnedThreadKeys(useTaskWorkspaceStore.getState());
    expect(owned.has(`${envA}:thread-clarify`)).toBe(true);
    expect(owned.has(`${envA}:thread-plan`)).toBe(true);
    expect(owned.has(`${envB}:thread-clarify`)).toBe(false);
    expect(owned.has(`${envA}:thread-standard-chat`)).toBe(false);

    // The same thread ID in another environment is a different conversation,
    // so it must own a distinct scoped key rather than colliding with envA's.
    useTaskWorkspaceStore.getState().applyStreamItem(envB, {
      kind: "task-upserted",
      sequence: 1,
      task: {
        ...makeTaskWorkspace({
          id: "task-other-env",
          updatedAt: "2026-07-28T18:00:00.000Z",
          environmentId: envB,
        }),
        sessions: [
          {
            id: "session-1",
            stage: "questions",
            threadId: ThreadId.make("thread-clarify"),
            role: "primary",
            provider: null,
            status: "active",
            parentSessionId: null,
            contextManifestId: null,
            forkPoint: null,
            createdAt: "2026-07-28T18:00:00.000Z",
          },
        ],
      },
    });

    const scoped = selectTaskOwnedThreadKeys(useTaskWorkspaceStore.getState());
    expect(scoped.has(`${envA}:thread-clarify`)).toBe(true);
    expect(scoped.has(`${envB}:thread-clarify`)).toBe(true);
  });

  it("reuses the owned-thread set until the tasks themselves change", () => {
    const task = makeTaskWorkspace({
      id: "task-a",
      updatedAt: "2026-07-28T18:00:00.000Z",
      environmentId: envA,
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [
          {
            ...task,
            sessions: [
              {
                id: "session-1",
                stage: "questions",
                threadId: ThreadId.make("thread-clarify"),
                role: "primary",
                provider: null,
                status: "active",
                parentSessionId: null,
                contextManifestId: null,
                forkPoint: null,
                createdAt: "2026-07-28T18:00:00.000Z",
              },
            ],
          },
        ],
      },
    });

    const first = selectTaskOwnedThreadKeys(useTaskWorkspaceStore.getState());
    expect(first.size).toBe(1);
    // The sidebar re-renders constantly; recomputing this set each time would
    // walk every task's sessions and occurrences for nothing.
    expect(selectTaskOwnedThreadKeys(useTaskWorkspaceStore.getState())).toBe(first);

    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "task-upserted",
      sequence: 2,
      task: makeTaskWorkspace({
        id: "task-b",
        updatedAt: "2026-07-28T19:00:00.000Z",
        environmentId: envA,
      }),
    });
    expect(selectTaskOwnedThreadKeys(useTaskWorkspaceStore.getState())).not.toBe(first);
  });

  it("finds duplicate task ids across environments for the compatibility route", () => {
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [
          makeTaskWorkspace({
            id: "shared",
            updatedAt: "2026-07-28T18:00:00.000Z",
            environmentId: envA,
          }),
        ],
      },
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envB, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [
          makeTaskWorkspace({
            id: "shared",
            updatedAt: "2026-07-28T19:00:00.000Z",
            environmentId: envB,
          }),
        ],
      },
    });

    const refs = selectTaskRefsById(useTaskWorkspaceStore.getState(), "shared");
    expect(refs.map((ref) => ref.environmentId)).toEqual([envB, envA]);
  });
});
