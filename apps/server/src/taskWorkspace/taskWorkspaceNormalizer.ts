import type {
  EnvironmentId,
  TaskWorkspace,
  TaskWorkspaceEvent,
  TaskWorkspaceId,
} from "@kata-sh/code-contracts";

export const TASK_WORKSPACE_CONTRACT_VERSION_0_3_0 = "task-workspace@0.3.0";
export const TASK_ARTIFACT_CONTRACT_VERSION_0_3_0 = "task-artifact@0.3.0";

/**
 * Version-aware whole-aggregate normalization for imported legacy records.
 *
 * A field decoder cannot derive these defaults (they need task context or the
 * server environment), so the one-time NDJSON import applies them:
 *
 * - stamp the owning server environment id;
 * - create legacy intake from the existing title without fabricating an artifact;
 * - default missing worktree policy to Later;
 * - map `provisioned` to the canonical `ready`;
 * - preserve old workflow/prompt pins, populating a missing run-level prompt pin
 *   from `versions.prompt`;
 * - derive the historical `taskRevision` from the imported per-task event order;
 * - set missing stage occurrence ordinals to zero.
 */
export function normalizeImportedTask(
  task: TaskWorkspace,
  input: { readonly environmentId: EnvironmentId; readonly taskRevision: number },
): TaskWorkspace {
  const repositories = task.workspace.repositories.map((repository) => ({
    ...repository,
    provisioningStatus:
      repository.provisioningStatus === "provisioned"
        ? ("ready" as const)
        : repository.provisioningStatus,
  }));
  const workflowRuns = task.workflowRuns.map((run) => ({
    ...run,
    promptBundleVersion: run.promptBundleVersion ?? task.versions.prompt,
  }));
  return {
    ...task,
    environmentId: task.environmentId ?? input.environmentId,
    intake:
      task.intake.brief !== "" || task.intake.source.body !== ""
        ? task.intake
        : { brief: task.title, source: { kind: "inline", body: task.title } },
    preferences: {
      worktreePolicy: task.preferences.worktreePolicy,
      modelSelection: task.preferences.modelSelection,
      executionProfile: "planning",
    },
    bootstrap: task.bootstrap,
    occurrences: task.occurrences.map((occurrence, index) => ({
      ...occurrence,
      ordinal: occurrence.ordinal > 0 ? occurrence.ordinal : index,
    })),
    planGate: task.planGate,
    gateHistory: task.gateHistory,
    taskRevision: task.taskRevision > 0 ? task.taskRevision : input.taskRevision,
    workspace: { ...task.workspace, repositories },
    workflowRuns,
  };
}

/**
 * Turn raw legacy NDJSON events into import-ready canonical events plus one
 * terminal `task.migrated` event per task. The terminal event stamps the
 * environment id and records the derived final revision, giving the import an
 * audit trail without rewriting any historical event.
 */
export function deriveImportedEvents(
  rawEvents: ReadonlyArray<TaskWorkspaceEvent>,
  environmentId: EnvironmentId,
  nowIso: string,
): {
  readonly events: ReadonlyArray<TaskWorkspaceEvent>;
  readonly migratedEvents: ReadonlyArray<TaskWorkspaceEvent>;
} {
  const revisionByTask = new Map<TaskWorkspaceId, number>();
  const events: TaskWorkspaceEvent[] = [];
  const migratedEvents: TaskWorkspaceEvent[] = [];

  for (const event of rawEvents) {
    const revision = (revisionByTask.get(event.taskId) ?? 0) + 1;
    revisionByTask.set(event.taskId, revision);
    const normalizedTask = normalizeImportedTask(event.task, {
      environmentId,
      taskRevision: revision,
    });
    events.push({ ...event, task: normalizedTask });
  }

  for (const event of rawEvents) {
    const revision = revisionByTask.get(event.taskId) ?? 0;
    const taskEvents = rawEvents.filter((candidate) => candidate.taskId === event.taskId);
    const isLastForTask = taskEvents.at(-1)?.eventId === event.eventId;
    if (!isLastForTask) continue;
    const migratedTask = normalizeImportedTask(event.task, {
      environmentId,
      taskRevision: revision,
    });
    migratedEvents.push({
      sequence: 0,
      eventId: `migrated-${event.eventId}`,
      commandId: event.commandId,
      taskId: event.taskId,
      type: "task.migrated",
      occurredAt: nowIso,
      task: { ...migratedTask, taskRevision: revision },
    });
  }

  return { events, migratedEvents };
}
