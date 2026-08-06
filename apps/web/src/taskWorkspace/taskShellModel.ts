import type {
  TaskWorkspace,
  TaskWorkspaceOccurrenceStatus,
  TaskWorkspaceStage,
  ThreadId,
} from "@kata-sh/code-contracts";
import { taskWorkspaceCatalogEntryForVersion } from "@kata-sh/code-shared/taskWorkspaceCatalog";

import { currentTaskStage } from "./taskWorkspaceStore";

export type TaskShellStageStatus = "completed" | "active" | "upcoming";

export interface TaskShellOccurrence {
  readonly id: string;
  readonly ordinal: number;
  /** Human-facing occurrence name, one-based: `Plan v1`, `Plan v2`. */
  readonly label: string;
  readonly status: TaskWorkspaceOccurrenceStatus;
  readonly sessionId: string | null;
  readonly threadId: ThreadId | null;
  readonly artifactRevisionId: string | null;
  /** The occurrence that carries this stage's live workflow path. */
  readonly isCurrent: boolean;
}

export interface TaskShellStage {
  readonly stage: TaskWorkspaceStage;
  /** Product-facing stage name, from the task's pinned workflow definition. */
  readonly label: string;
  readonly status: TaskShellStageStatus;
  /** Oldest first, so the picker reads as a history. */
  readonly occurrences: ReadonlyArray<TaskShellOccurrence>;
  /** A stage the task has reached, and whose content can be inspected. */
  readonly isSelectable: boolean;
}

/**
 * The stage rail for a task, derived from the workflow definition the task
 * pinned at creation.
 *
 * Stage status is workflow truth: which stage the task is in, and which it has
 * left behind. It is deliberately independent of whatever the user is looking
 * at, so selecting a stage can never move the workflow.
 */
export function taskShellStages(task: TaskWorkspace): ReadonlyArray<TaskShellStage> {
  const catalog = taskWorkspaceCatalogEntryForVersion(task.versions.workflowDefinition);
  if (!catalog) return [];
  const activeStage = currentTaskStage(task);
  const activeIndex = catalog.stages.findIndex((entry) => entry.stage === activeStage);
  return catalog.stages.map((entry, index) => {
    const status: TaskShellStageStatus =
      entry.stage === activeStage
        ? "active"
        : activeIndex !== -1 && index < activeIndex
          ? "completed"
          : "upcoming";
    const occurrences = stageOccurrences(task, entry.stage, entry.presentation);
    return {
      stage: entry.stage,
      label: entry.presentation,
      status,
      occurrences,
      isSelectable: status !== "upcoming" || occurrences.length > 0,
    };
  });
}

export interface TaskShellSelection {
  readonly stage: TaskWorkspaceStage;
  /** `null` selects the stage's current occurrence. */
  readonly occurrenceId: string | null;
}

export interface TaskShellOutcome {
  readonly title: string;
  readonly markdown: string;
  readonly revision: number;
}

export type TaskShellContentView = "conversation" | "outcome";

export interface TaskShellView {
  readonly stages: ReadonlyArray<TaskShellStage>;
  /** The stage the workflow is in, regardless of what is being viewed. */
  readonly activeStage: TaskShellStage;
  readonly selectedStage: TaskShellStage;
  readonly selectedOccurrence: TaskShellOccurrence | null;
  /** The selection is the live workflow path, so actions apply to it. */
  readonly isViewingCurrent: boolean;
  /** The selection is history: inspectable, never mutable. */
  readonly isReadOnly: boolean;
  readonly defaultView: TaskShellContentView;
  readonly outcome: TaskShellOutcome | null;
  /** The conversation to render for the selection, if it has one. */
  readonly conversationThreadId: ThreadId | null;
}

/**
 * Resolve what the Task route should show for a selection.
 *
 * Selection is view state and nothing else. A stale or impossible selection
 * falls back to the live workflow path rather than blocking the user in a view
 * the task has moved past.
 */
export function resolveTaskShellView(
  task: TaskWorkspace,
  selection: TaskShellSelection | null,
): TaskShellView {
  const stages = taskShellStages(task);
  const activeStageValue = currentTaskStage(task);
  const activeStage =
    stages.find((stage) => stage.stage === activeStageValue) ?? fallbackStage(activeStageValue);
  const requested = selection
    ? stages.find((stage) => stage.stage === selection.stage && stage.isSelectable)
    : undefined;
  const selectedStage = requested ?? activeStage;
  const currentOccurrence =
    selectedStage.occurrences.find((occurrence) => occurrence.isCurrent) ?? null;
  const selectedOccurrence =
    (selection?.occurrenceId
      ? selectedStage.occurrences.find((occurrence) => occurrence.id === selection.occurrenceId)
      : undefined) ??
    currentOccurrence ??
    null;
  const isViewingCurrent =
    selectedStage.stage === activeStage.stage && (selectedOccurrence?.isCurrent ?? true);

  return {
    stages,
    activeStage,
    selectedStage,
    selectedOccurrence,
    isViewingCurrent,
    isReadOnly: !isViewingCurrent,
    defaultView: isViewingCurrent ? "conversation" : "outcome",
    outcome: occurrenceOutcome(task, selectedOccurrence),
    conversationThreadId: isViewingCurrent
      ? liveStageThreadId(task, selectedStage.stage, selectedOccurrence)
      : (selectedOccurrence?.threadId ?? null),
  };
}

/**
 * The thread the live stage is talking in.
 *
 * Implement can be resumed into a continuation session after a checkpoint, so
 * the occurrence's original session is not always the one still running. An
 * inactive session is never the live conversation.
 */
function liveStageThreadId(
  task: TaskWorkspace,
  stage: TaskWorkspaceStage,
  occurrence: TaskShellOccurrence | null,
): ThreadId | null {
  if (stage === "build") {
    const continuation = task.build.continuationSessionIds
      .toReversed()
      .map((sessionId) =>
        task.sessions.find(
          (session) =>
            session.id === sessionId &&
            session.stage === "build" &&
            session.role === "primary" &&
            session.status === "active",
        ),
      )
      .find((session) => session !== undefined);
    if (continuation) return continuation.threadId;
  }
  const occurrenceSession = task.sessions.find((session) => session.id === occurrence?.sessionId);
  return occurrenceSession?.status === "active" ? occurrenceSession.threadId : null;
}

export interface TaskShellRevisionImpact {
  /** The occurrence a revision would create, and which becomes the live path. */
  readonly nextOccurrenceLabel: string;
  /** Downstream stages whose outcomes survive the revision as history. */
  readonly preservedStageLabels: ReadonlyArray<string>;
}

/**
 * What revising a stage would change, and what it would keep.
 *
 * Revision is append-only: it starts a new occurrence and leaves every existing
 * outcome inspectable. The dialog states this before the user commits, so
 * "Revise from here" is never a silent reopen of settled work.
 */
export function taskShellRevisionImpact(
  task: TaskWorkspace,
  stage: TaskWorkspaceStage,
): TaskShellRevisionImpact {
  const stages = taskShellStages(task);
  const stageIndex = stages.findIndex((candidate) => candidate.stage === stage);
  const selected = stages[stageIndex];
  const nextOrdinal = (selected?.occurrences.at(-1)?.ordinal ?? -1) + 2;
  return {
    nextOccurrenceLabel: `${selected?.label ?? stage} v${nextOrdinal}`,
    preservedStageLabels: stages
      .slice(stageIndex + 1)
      .filter((candidate) => candidate.occurrences.length > 0)
      .map((candidate) => candidate.label),
  };
}

/**
 * Stage shape for a task pinned to a definition this build has no catalog entry
 * for. Rendering a guessed rail would be worse than rendering only the stage
 * the task is actually in.
 */
function fallbackStage(stage: TaskWorkspaceStage): TaskShellStage {
  return { stage, label: stage, status: "active", occurrences: [], isSelectable: true };
}

function occurrenceOutcome(
  task: TaskWorkspace,
  occurrence: TaskShellOccurrence | null,
): TaskShellOutcome | null {
  if (!occurrence?.artifactRevisionId) return null;
  for (const artifact of task.artifacts) {
    const revision = artifact.revisions.find(
      (candidate) => candidate.id === occurrence.artifactRevisionId,
    );
    if (revision) {
      return { title: revision.title, markdown: revision.markdown, revision: revision.revision };
    }
  }
  return null;
}

function stageOccurrences(
  task: TaskWorkspace,
  stage: TaskWorkspaceStage,
  label: string,
): ReadonlyArray<TaskShellOccurrence> {
  const ordered = task.occurrences
    .filter((occurrence) => occurrence.stage === stage)
    .toSorted((left, right) => left.ordinal - right.ordinal);
  const currentOrdinal = ordered.at(-1)?.ordinal ?? null;
  return ordered.map((occurrence) => ({
    id: occurrence.id,
    ordinal: occurrence.ordinal,
    label: `${label} v${occurrence.ordinal + 1}`,
    status: occurrence.status,
    sessionId: occurrence.sessionId,
    threadId: occurrence.threadId,
    artifactRevisionId: occurrence.artifactRevisionId,
    isCurrent: occurrence.ordinal === currentOrdinal,
  }));
}
