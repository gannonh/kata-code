import { EnvironmentId, TaskWorkspace, type TaskWorkspaceEvent } from "@kata-sh/code-contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { deriveImportedEvents, normalizeImportedTask } from "./taskWorkspaceNormalizer.ts";

const environmentId = EnvironmentId.make("environment-import");
const decodeTask = Schema.decodeUnknownSync(TaskWorkspace);

/** A @0.1.0-era task as it decodes through the new schema with defaults. */
function legacyTask(overrides: Record<string, unknown> = {}) {
  return decodeTask({
    id: "legacy-task",
    title: "Legacy slice 1 task",
    versions: {
      taskContract: "task-workspace@0.1.0",
      artifactContract: "task-artifact@0.1.0",
      workflowDefinition: "standard@0.1.0",
      prompt: "task-workspace-slice-1@0.1.0",
    },
    workspace: { repositories: [] },
    workflowRuns: [],
    sessions: [],
    artifacts: [],
    comments: [],
    build: { phases: [], resultingCommitSha: null },
    verification: { criteria: [], results: [], signedOffAt: null },
    sourceLinks: [],
    delivery: { state: "unavailable" },
    createdAt: "2026-07-28T17:00:00.000Z",
    updatedAt: "2026-07-28T17:00:00.000Z",
    ...overrides,
  });
}

function legacyEvent(
  sequence: number,
  eventId: string,
  task: ReturnType<typeof legacyTask>,
): TaskWorkspaceEvent {
  return {
    sequence,
    eventId,
    commandId: `command-${sequence}` as TaskWorkspaceEvent["commandId"],
    taskId: "legacy-task" as TaskWorkspaceEvent["taskId"],
    type: "task.create",
    occurredAt: "2026-07-28T17:00:00.000Z",
    task,
  };
}

describe("taskWorkspaceNormalizer", () => {
  it("stamps the environment, derives intake from title, and defaults Later", () => {
    const normalized = normalizeImportedTask(legacyTask(), { environmentId, taskRevision: 3 });
    expect(normalized.environmentId).toBe(environmentId);
    expect(normalized.intake).toEqual({
      brief: "Legacy slice 1 task",
      source: { kind: "inline", body: "Legacy slice 1 task" },
    });
    expect(normalized.preferences.worktreePolicy).toBe("later");
    expect(normalized.preferences.executionProfile).toBe("planning");
    expect(normalized.taskRevision).toBe(3);
  });

  it("maps provisioned repositories to the canonical ready status", () => {
    const normalized = normalizeImportedTask(
      legacyTask({
        workspace: {
          repositories: [
            {
              id: "primary",
              projectId: "project-1",
              workspaceRoot: "/repo",
              baseRef: "main",
              branch: "katacode/task-legacy",
              worktreePath: "/worktrees/legacy",
              provisioningStatus: "provisioned",
            },
          ],
        },
      }),
      { environmentId, taskRevision: 1 },
    );
    expect(normalized.workspace.repositories[0]?.provisioningStatus).toBe("ready");
  });

  it("preserves workflow and prompt pins, populating the run prompt pin from versions.prompt", () => {
    const normalized = normalizeImportedTask(
      legacyTask({
        workflowRuns: [
          {
            id: "standard-run-1",
            preset: "standard",
            definitionVersion: "standard@0.1.0",
            currentStage: "questions",
            approvalPolicy: "before-build",
            createdAt: "2026-07-28T17:00:00.000Z",
            updatedAt: "2026-07-28T17:00:00.000Z",
          },
        ],
      }),
      { environmentId, taskRevision: 1 },
    );
    expect(normalized.versions.workflowDefinition).toBe("standard@0.1.0");
    expect(normalized.workflowRuns[0]?.promptBundleVersion).toBe("task-workspace-slice-1@0.1.0");
  });

  it("derives per-task revisions from event order and emits one migrated event per task", () => {
    const first = legacyEvent(1, "event-1", legacyTask());
    const second = legacyEvent(
      2,
      "event-2",
      legacyTask({
        workflowRuns: [
          {
            id: "standard-run-1",
            preset: "standard",
            definitionVersion: "standard@0.1.0",
            currentStage: "plan",
            approvalPolicy: "before-build",
            createdAt: "2026-07-28T17:00:00.000Z",
            updatedAt: "2026-07-28T18:00:00.000Z",
          },
        ],
      }),
    );
    const { events, migratedEvents } = deriveImportedEvents(
      [first, second],
      environmentId,
      "2026-08-01T00:00:00.000Z",
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.task.taskRevision).toBe(1);
    expect(events[1]?.task.taskRevision).toBe(2);
    expect(events[0]?.task.environmentId).toBe(environmentId);
    expect(events[1]?.task.environmentId).toBe(environmentId);

    expect(migratedEvents).toHaveLength(1);
    expect(migratedEvents[0]?.type).toBe("task.migrated");
    expect(migratedEvents[0]?.task.taskRevision).toBe(2);
    expect(migratedEvents[0]?.task.environmentId).toBe(environmentId);
  });

  it("keeps an explicit legacy occurrence ordinal", () => {
    const normalized = normalizeImportedTask(
      legacyTask({
        occurrences: [
          {
            id: "occurrence-questions-0",
            stage: "questions",
            ordinal: 2,
            status: "completed",
            createdAt: "2026-07-28T17:00:00.000Z",
          },
        ],
      }),
      { environmentId, taskRevision: 1 },
    );
    expect(normalized.occurrences[0]?.ordinal).toBe(2);
  });
});
