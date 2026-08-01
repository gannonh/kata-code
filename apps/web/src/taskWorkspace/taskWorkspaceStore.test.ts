import type { TaskWorkspace } from "@kata-sh/code-contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useTaskWorkspaceStore } from "./taskWorkspaceStore";

function makeTask(id: string, updatedAt: string): TaskWorkspace {
  return {
    id,
    environmentId: null,
    title: id,
    versions: {
      taskContract: "task-workspace@0.1.0",
      artifactContract: "task-artifact@0.1.0",
      workflowDefinition: "standard@0.1.0",
      prompt: "task-workspace-slice-1@0.1.0",
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
        preset: "standard",
        definitionVersion: "standard@0.1.0",
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

  it("hydrates and orders tasks from a server snapshot", () => {
    useTaskWorkspaceStore.getState().applyStreamItem({
      kind: "snapshot",
      snapshot: {
        sequence: 4,
        tasks: [
          makeTask("older", "2026-07-28T17:00:00.000Z"),
          makeTask("newer", "2026-07-28T18:00:00.000Z"),
        ],
      },
    });

    expect(useTaskWorkspaceStore.getState().taskIds).toEqual(["newer", "older"]);
    expect(useTaskWorkspaceStore.getState().sequence).toBe(4);
  });

  it("ignores stale task events after reconnect", () => {
    const current = makeTask("task-1", "2026-07-28T18:00:00.000Z");
    useTaskWorkspaceStore.getState().applyStreamItem({
      kind: "task-upserted",
      sequence: 5,
      task: current,
    });
    useTaskWorkspaceStore.getState().applyStreamItem({
      kind: "task-upserted",
      sequence: 4,
      task: makeTask("task-1", "2026-07-28T17:00:00.000Z"),
    });

    expect(useTaskWorkspaceStore.getState().taskById["task-1"]).toEqual(current);
    expect(useTaskWorkspaceStore.getState().sequence).toBe(5);
  });
});
