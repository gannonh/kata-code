import { EnvironmentId, type TaskWorkspace } from "@kata-sh/code-contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  selectTaskRefsById,
  selectTaskByRef,
  selectTaskWorkspaces,
  useTaskWorkspaceStore,
} from "./taskWorkspaceStore";

const envA = EnvironmentId.make("environment-a");
const envB = EnvironmentId.make("environment-b");

function makeTask(id: string, updatedAt: string, environmentId: EnvironmentId): TaskWorkspace {
  return {
    id,
    environmentId,
    title: id,
    versions: {
      taskContract: "task-workspace@0.3.0",
      artifactContract: "task-artifact@0.3.0",
      workflowDefinition: "guided@0.2.0",
      prompt: "task-workspace-guided@0.2.0",
    },
    intake: { brief: "", source: { kind: "inline", body: "" } },
    preferences: { worktreePolicy: "later", modelSelection: null, executionProfile: "planning" },
    bootstrap: null,
    occurrences: [],
    planGate: null,
    gateHistory: [],
    taskRevision: 0,
    workspace: { repositories: [] },
    workflowRuns: [
      {
        id: "run-1",
        preset: "guided",
        definitionVersion: "guided@0.2.0",
        currentStage: "questions",
        approvalPolicy: "before-build",
        createdAt: updatedAt,
        updatedAt,
      },
    ],
    sessions: [],
    artifacts: [],
    comments: [],
    contextManifests: [],
    build: {
      phases: [],
      resultingCommitSha: null,
      activePhaseId: null,
      activeWorkItemId: null,
      checks: [],
      checkpoints: [],
      amendments: [],
      currentPlanRevisionId: null,
      amendmentGateId: null,
      continuationSessionIds: [],
    },
    verification: { criteria: [], results: [], signedOffAt: null },
    sourceLinks: [],
    delivery: { state: "unavailable" },
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("taskWorkspaceStore", () => {
  beforeEach(() => useTaskWorkspaceStore.getState().reset());

  it("keys tasks by environment and task id, and orders them for the sidebar", () => {
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: {
        sequence: 4,
        tasks: [
          makeTask("task-old", "2026-07-28T17:00:00.000Z", envA),
          makeTask("task-new", "2026-07-28T18:00:00.000Z", envA),
        ],
      },
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envB, {
      kind: "snapshot",
      snapshot: {
        sequence: 1,
        tasks: [makeTask("task-other", "2026-07-28T19:00:00.000Z", envB)],
      },
    });

    const tasks = selectTaskWorkspaces(useTaskWorkspaceStore.getState());
    expect(tasks.map((task) => task.id)).toEqual(["task-other", "task-new", "task-old"]);
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envA, "task-new")).not.toBeNull();
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envB, "task-new")).toBeNull();
  });

  it("ignores stale task events per environment after reconnect", () => {
    const current = makeTask("task-1", "2026-07-28T18:00:00.000Z", envA);
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "task-upserted",
      sequence: 5,
      task: current,
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "task-upserted",
      sequence: 4,
      task: makeTask("task-1", "2026-07-28T17:00:00.000Z", envA),
    });

    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envA, "task-1")).toEqual(current);
  });

  it("keeps environment partitions independent on resubscribe", () => {
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: { sequence: 1, tasks: [makeTask("task-a", "2026-07-28T18:00:00.000Z", envA)] },
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envB, {
      kind: "snapshot",
      snapshot: { sequence: 1, tasks: [makeTask("task-b", "2026-07-28T18:00:00.000Z", envB)] },
    });

    // Environment B reconnects and resubscribes: only its partition resets.
    useTaskWorkspaceStore.getState().resetEnvironment(envB);
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envA, "task-a")).not.toBeNull();
    expect(selectTaskByRef(useTaskWorkspaceStore.getState(), envB, "task-b")).toBeNull();
  });

  it("finds duplicate task ids across environments for the compatibility route", () => {
    useTaskWorkspaceStore.getState().applyStreamItem(envA, {
      kind: "snapshot",
      snapshot: { sequence: 1, tasks: [makeTask("shared", "2026-07-28T18:00:00.000Z", envA)] },
    });
    useTaskWorkspaceStore.getState().applyStreamItem(envB, {
      kind: "snapshot",
      snapshot: { sequence: 1, tasks: [makeTask("shared", "2026-07-28T19:00:00.000Z", envB)] },
    });

    const refs = selectTaskRefsById(useTaskWorkspaceStore.getState(), "shared");
    expect(refs.map((ref) => ref.environmentId)).toEqual([envB, envA]);
  });
});
