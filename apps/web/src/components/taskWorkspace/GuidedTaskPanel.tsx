import {
  type RuntimeMode,
  type TaskWorkspace,
  type TaskWorkspaceCommentAuthor,
  type ThreadId,
} from "@kata-sh/code-contracts";
import { dependenciesPass } from "@kata-sh/code-shared/taskWorkspaceBuild";
import { TASK_WORKSPACE_STAGE_PRESENTATION } from "@kata-sh/code-shared/taskWorkspaceCatalog";
import { ArrowLeftIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { TaskShellOccurrence } from "../../taskWorkspace/taskShellModel";
import { operationKey } from "../../taskWorkspace/operationKey";
import { latestArtifact } from "../../taskWorkspace/taskWorkspaceArtifacts";
import { currentTaskStage } from "../../taskWorkspace/taskWorkspaceStore";
import type { TaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { useComposerDraftStore } from "../../composerDraftStore";
import { readEnvironmentApi } from "../../environmentApi";
import { newCommandId } from "../../lib/utils";
import { runtimeModeConfig, runtimeModeOptions } from "../../runtimeModePresentation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

function latestOccurrence(task: TaskWorkspace, stage = currentTaskStage(task)) {
  return task.occurrences
    .filter((candidate) => candidate.stage === stage)
    .toSorted((left, right) => right.ordinal - left.ordinal)[0];
}

function buildStatusVariant(
  status:
    | TaskWorkspace["build"]["phases"][number]["status"]
    | TaskWorkspace["build"]["checks"][number]["status"]
    | TaskWorkspace["build"]["checkAttempts"][number]["status"],
): "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "info" | "error" {
  switch (status) {
    case "completed":
    case "pass":
      return "success";
    case "fail":
    case "blocked":
      return "error";
    case "stale":
    case "indeterminate":
    case "invalidated":
      return "warning";
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

function checkAttempts(task: TaskWorkspace, checkId: string) {
  return task.build.checkAttempts.filter((attempt) => attempt.checkId === checkId);
}

function phaseChecks(task: TaskWorkspace, phase: TaskWorkspace["build"]["phases"][number]) {
  return phase.checkIds
    .map((checkId) => task.build.checks.find((check) => check.id === checkId))
    .filter((check): check is NonNullable<typeof check> => check !== undefined);
}

function phaseById(task: TaskWorkspace, phaseId: string) {
  return task.build.phases.find((phase) => phase.id === phaseId) ?? null;
}

function workItemById(task: TaskWorkspace, workItemId: string | null) {
  if (workItemId === null) return null;
  return (
    task.build.phases.flatMap((phase) => phase.workItems).find((item) => item.id === workItemId) ??
    null
  );
}

function approvedPlanReady(task: TaskWorkspace) {
  const planOccurrence = latestOccurrence(task, "plan");
  return planOccurrence?.status === "completed" && planOccurrence.gateOutcome === "approved";
}

function hasImplementOccurrence(task: TaskWorkspace) {
  return task.occurrences.some((occurrence) => occurrence.stage === "build");
}

function startImplementDisabledReason(task: TaskWorkspace): string | null {
  const repository = task.workspace.repositories[0];
  if (!approvedPlanReady(task)) return "Approve the Plan first.";
  if (hasImplementOccurrence(task)) return "Implement has already started.";
  if (task.planGate?.status === "open") return "Resolve the Plan gate first.";
  if (task.preferences.worktreePolicy === "never") return "Choose a worktree policy first.";
  if (repository?.provisioningStatus !== "ready")
    return `Wait for the canonical task worktree to be ready (current status: ${repository?.provisioningStatus ?? "missing"}).`;
  if (!repository.worktreePath || !repository.baseCommitSha) {
    return "The canonical task worktree is not ready.";
  }
  if (!task.preferences.modelSelection) return "Choose an implementation-capable provider first.";
  if (task.bootstrap?.status === "pending" || task.bootstrap?.status === "running") {
    return "Implement session bootstrap is already running.";
  }
  return null;
}

function checkpointCanContinue(
  task: TaskWorkspace,
  checkpoint: TaskWorkspace["build"]["checkpoints"][number],
) {
  const phase = phaseById(task, checkpoint.phaseId);
  const checks = checkpoint.checkIds
    .map((checkId) => task.build.checks.find((check) => check.id === checkId))
    .filter((check): check is NonNullable<typeof check> => check !== undefined);
  if (
    checkpoint.status !== "waiting" ||
    checkpoint.continuationSessionId !== null ||
    !phase ||
    !checks.every((check) => check.status === "pass")
  ) {
    return false;
  }
  if (phase.status === "completed") {
    return phase.workItems.every((item) => item.status === "completed");
  }
  return (
    phase.status === "blocked" ||
    phase.status === "pending" ||
    phase.status === "running" ||
    phase.workItems.some(
      (item) => item.status === "blocked" || item.status === "pending" || item.status === "running",
    )
  );
}

function checkpointDisabledReason(
  task: TaskWorkspace,
  checkpoint: TaskWorkspace["build"]["checkpoints"][number],
  isBusy: boolean,
) {
  if (checkpoint.status !== "waiting") return "Checkpoint already continued.";
  if (checkpoint.continuationSessionId !== null) return "Checkpoint continuation is starting.";
  if (task.build.amendmentGateId) return "Approve the pending amendment first.";
  if (!checkpointCanContinue(task, checkpoint))
    return "Pass the checkpoint checks and complete finished phases first.";
  if (isBusy) return "Another task command is running.";
  return null;
}

function checkCanRecover(
  task: TaskWorkspace,
  check: TaskWorkspace["build"]["checks"][number],
): boolean {
  if (
    check.status === "fail" ||
    check.status === "blocked" ||
    check.status === "stale" ||
    check.status === "indeterminate"
  ) {
    return true;
  }
  const latestAttempt = task.build.checkAttempts
    .toReversed()
    .find((attempt) => attempt.checkId === check.id);
  return (
    latestAttempt?.status === "fail" ||
    latestAttempt?.status === "stale" ||
    latestAttempt?.status === "indeterminate"
  );
}

function waitingCheckpointAllowsCheckRerun(
  task: TaskWorkspace,
  check: TaskWorkspace["build"]["checks"][number],
): boolean {
  return task.build.checkpoints.some(
    (checkpoint) => checkpoint.status === "waiting" && checkpoint.checkIds.includes(check.id),
  );
}

function automatedCheckDisabledReason(
  task: TaskWorkspace,
  check: TaskWorkspace["build"]["checks"][number],
  isBusy: boolean,
) {
  if (task.build.amendmentGateId) return "Approve the pending amendment first.";
  if (isBusy) return "Another task command is running.";
  if (check.status === "running") return "A check attempt is already running.";
  const plan = latestArtifact(task, "plan");
  const repository = task.workspace.repositories[0];
  if (!plan || task.build.currentPlanRevisionId !== plan.id)
    return "The approved implementation Plan is unavailable.";
  if (!repository?.worktreePath) return "The canonical task worktree is unavailable.";
  const isRecoveryRerun = checkCanRecover(task, check);
  if (isRecoveryRerun) {
    if (task.build.checkpoints.some((checkpoint) => checkpoint.status === "waiting")) {
      return waitingCheckpointAllowsCheckRerun(task, check)
        ? null
        : "Implementation is paused; rerun the failed checkpoint check first.";
    }
    return null;
  }
  if (task.build.checkpoints.some((checkpoint) => checkpoint.status === "waiting")) {
    return "Implementation is paused at a waiting checkpoint.";
  }
  const phase = phaseById(task, check.phaseId);
  const item = workItemById(task, check.workItemId);
  if (phase?.status !== "running" || task.build.activePhaseId !== phase.id)
    return "The owning phase must be running.";
  if (item && (item.status !== "running" || task.build.activeWorkItemId !== item.id))
    return "The owning work item must be running.";
  if (phase && item && !dependenciesPass(phase, item))
    return `Depends on ${item.dependsOn.join(", ")}.`;
  return null;
}

function manualCheckDisabledReason(
  task: TaskWorkspace,
  check: TaskWorkspace["build"]["checks"][number],
  note: string,
  isBusy: boolean,
) {
  const phase = phaseById(task, check.phaseId);
  const item = workItemById(task, check.workItemId);
  if (task.build.amendmentGateId) return "Approve the pending amendment first.";
  if (task.build.checkpoints.some((checkpoint) => checkpoint.status === "waiting")) {
    return "Implementation is paused at a waiting checkpoint.";
  }
  if (isBusy) return "Another task command is running.";
  if (!note.trim()) return "Add a note before recording a manual result.";
  if (phase?.status !== "running") return "The owning phase must be running.";
  if (item && item.status !== "running") return "The owning work item must be running.";
  return null;
}

function isPlanValidationError(error: string | null): error is string {
  return error?.startsWith("Invalid implementation Plan:") ?? false;
}

function completionDisabledReason(task: TaskWorkspace, isBusy: boolean) {
  if (task.build.resultingCommitSha) return "Implementation is already complete.";
  if (task.build.amendmentGateId) return "Approve the pending amendment first.";
  if (task.build.checkpoints.some((checkpoint) => checkpoint.status === "waiting")) {
    return "Continue the waiting checkpoint first.";
  }
  if (!task.build.phases.every((phase) => phase.status === "completed")) {
    return "Complete every implementation phase first.";
  }
  if (
    !task.build.phases.every((phase) =>
      phase.workItems.every((item) => item.status === "completed"),
    )
  ) {
    return "Complete every work item first.";
  }
  if (!task.build.checks.every((check) => check.status === "pass" && check.commitSha !== null)) {
    return "All required checks must pass at the current commit.";
  }
  if (isBusy) return "Another task command is running.";
  return null;
}

export function GuidedTaskPanel(props: {
  readonly task: TaskWorkspace;
  readonly commands: TaskWorkspaceCommands;
  readonly currentUser: TaskWorkspaceCommentAuthor;
  /** Stage navigation, owned by the shell so selection stays view state. */
  readonly stageRail: ReactNode;
  /** Occurrences of the stage being viewed, oldest first. */
  readonly occurrences: ReadonlyArray<TaskShellOccurrence>;
  readonly selectedOccurrenceId: string | null;
  readonly onSelectOccurrence: (occurrenceId: string) => void;
  /** False while the user is inspecting history rather than the live path. */
  readonly isViewingCurrent: boolean;
  readonly onReturnToCurrent: () => void;
  /** True when the shell renders the revision control for this view. */
  readonly canRevise: boolean;
  /** The live stage conversation, when one is open; null while preparing or in history. */
  readonly liveThreadId: ThreadId | null;
}) {
  const {
    task,
    commands,
    currentUser,
    stageRail,
    occurrences,
    selectedOccurrenceId,
    onSelectOccurrence,
    isViewingCurrent,
    onReturnToCurrent,
    canRevise,
    liveThreadId,
  } = props;
  const [manualNotes, setManualNotes] = useState<Record<string, string>>({});
  const [amendmentFeedback, setAmendmentFeedback] = useState<Record<string, string>>({});
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [pendingRuntimeMode, setPendingRuntimeMode] = useState<RuntimeMode | null>(null);
  const [runtimeModeRetry, setRuntimeModeRetry] = useState<{
    readonly requested: RuntimeMode;
    readonly previous: RuntimeMode;
  } | null>(null);
  const permissionsAttemptRef = useRef(false);
  const runtimeModeChangeInFlightRef = useRef(false);
  const stage = currentTaskStage(task);
  const artifact = latestArtifact(
    task,
    stage === "questions" || stage === "research" || stage === "design" || stage === "plan"
      ? stage
      : "plan",
  );
  const planArtifact = latestArtifact(task, "plan");
  const occurrence = latestOccurrence(task, stage);
  const approved = stage === "plan" && approvedPlanReady(task);
  const gateOpen = task.planGate?.status === "open";
  const repository = task.workspace.repositories[0];
  const worktreeOperationKey = repository?.baseCommitSha
    ? `${task.id}:worktree:${repository.baseCommitSha}:${task.preferences.worktreePolicy}`
    : null;
  const amendmentGate = task.build.amendmentGateId
    ? task.build.amendments.find((amendment) => amendment.id === task.build.amendmentGateId)
    : null;
  const startReason = startImplementDisabledReason(task);
  const hasBuildProjection = task.build.phases.length > 0;
  const implementationComplete = task.build.resultingCommitSha !== null;
  const completeReason = completionDisabledReason(task, commands.isBusy);
  const activeRuntimeMode = runtimeModeRetry?.previous ?? task.preferences.runtimeMode;

  const approvePlan = () => {
    const base = commands.commandBase("task.plan.approve");
    void commands.dispatch(
      {
        ...base,
        expectedTaskRevision: task.taskRevision,
        operationKey: operationKey(base.commandId, "approve-plan"),
      },
      "approve-plan",
    );
  };

  const setWorktreePolicy = (policy: "now" | "later") => {
    const base = commands.commandBase("task.worktree.policy.set");
    void commands.dispatch(
      {
        ...base,
        expectedTaskRevision: task.taskRevision,
        operationKey: operationKey(base.commandId, `worktree-${policy}`),
        policy,
      },
      `worktree-${policy}`,
    );
  };

  /**
   * Change the task-wide permission. The server preference governs the next
   * stage session; the open stage conversation adopts it immediately through
   * `thread.runtime-mode.set` plus a composer-draft alignment, without
   * starting a new occurrence or moving workflow state.
   */
  const changeRuntimeMode = async (mode: RuntimeMode) => {
    if (runtimeModeChangeInFlightRef.current || pendingRuntimeMode !== null || commands.isBusy) {
      return;
    }
    const previousMode =
      runtimeModeRetry?.requested === mode
        ? runtimeModeRetry.previous
        : (runtimeModeRetry?.previous ?? task.preferences.runtimeMode);
    if (mode === activeRuntimeMode) return;

    runtimeModeChangeInFlightRef.current = true;
    setPendingRuntimeMode(mode);
    if (runtimeModeRetry !== null) {
      // Keep the last known live-thread mode displayed while a retry is in flight.
      setRuntimeModeRetry({ requested: mode, previous: previousMode });
    }
    setPermissionsError(null);

    try {
      if (task.preferences.runtimeMode !== mode) {
        permissionsAttemptRef.current = true;
        const base = commands.commandBase("task.permissions.set");
        const accepted = await commands.dispatch(
          {
            ...base,
            expectedTaskRevision: task.taskRevision,
            operationKey: operationKey(base.commandId, "permissions-set"),
            runtimeMode: mode,
          },
          "permissions-set",
        );
        if (!accepted) {
          // The rejection reason lands in `commands.error` after the re-render;
          // the effect below captures it beside the control. No task event was
          // written, so the persisted mode remains selected.
          setPendingRuntimeMode(null);
          setRuntimeModeRetry(null);
          return;
        }
        permissionsAttemptRef.current = false;
      }

      if (liveThreadId === null || task.environmentId === null) {
        setPendingRuntimeMode(null);
        setRuntimeModeRetry(null);
        return;
      }
      const api = readEnvironmentApi(task.environmentId);
      if (!api) {
        setPendingRuntimeMode(null);
        setRuntimeModeRetry({ requested: mode, previous: previousMode });
        setPermissionsError("The task conversation is unavailable. Try again.");
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.runtime-mode.set",
          commandId: newCommandId(),
          threadId: liveThreadId,
          runtimeMode: mode,
          createdAt: new Date().toISOString(),
        });
        // Align the composer draft so the next turn in the open conversation
        // keeps the new permission instead of reverting to a stale draft value.
        useComposerDraftStore
          .getState()
          .setRuntimeMode({ environmentId: task.environmentId, threadId: liveThreadId }, mode);
      } catch (cause) {
        setPendingRuntimeMode(null);
        setRuntimeModeRetry({ requested: mode, previous: previousMode });
        setPermissionsError(
          cause instanceof Error
            ? cause.message
            : "Failed to apply the permission to this conversation.",
        );
        return;
      }
      setPendingRuntimeMode(null);
      setRuntimeModeRetry(null);
    } finally {
      runtimeModeChangeInFlightRef.current = false;
    }
  };

  // Captures the fresh rejection reason from `commands.error` on the render
  // that follows a failed `task.permissions.set`, so the failure is reported
  // beside the control rather than only in the shared banner.
  useEffect(() => {
    if (!permissionsAttemptRef.current) return;
    permissionsAttemptRef.current = false;
    if (commands.error !== null) {
      setPermissionsError(commands.error);
    }
  }, [commands.error]);

  const startImplement = async () => {
    if (task.versions.workflowDefinition === "guided@0.2.0") {
      const base = commands.commandBase("task.workflow.upgrade");
      await commands.dispatch(
        {
          ...base,
          expectedTaskRevision: task.taskRevision,
          operationKey: operationKey(base.commandId, "workflow-upgrade-guided-0-3"),
          sourceVersion: "guided@0.2.0",
          targetVersion: "guided@0.3.0",
        },
        "upgrade-guided-workflow",
      );
      return;
    }
    const base = commands.commandBase("task.implementation.start");
    await commands.dispatch(
      {
        ...base,
        expectedTaskRevision: task.taskRevision,
        operationKey: operationKey(base.commandId, "implementation-start"),
      },
      "start-implement",
    );
  };

  return (
    <div
      data-testid="guided-task-panel"
      className="flex min-h-0 min-w-0 flex-col gap-4 bg-card p-4 lg:p-5"
    >
      {isViewingCurrent ? null : (
        <div
          data-testid="guided-history-notice"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-info/30 bg-info/8 p-2.5 text-xs"
        >
          <span className="min-w-0 flex-1">
            These actions apply to {TASK_WORKSPACE_STAGE_PRESENTATION[stage]}, not to the history
            you are viewing.
          </span>
          <Button
            data-testid="guided-panel-return-to-current"
            size="xs"
            variant="outline"
            onClick={onReturnToCurrent}
          >
            <ArrowLeftIcon className="size-3.5" />
            Return to current
          </Button>
        </div>
      )}

      {stageRail}

      {occurrences.length > 1 ? (
        <section data-testid="guided-stage-occurrences" className="grid gap-1">
          <p className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            History
          </p>
          {occurrences.map((occurrence) => (
            <button
              key={occurrence.id}
              type="button"
              data-testid={`guided-occurrence-${occurrence.id}`}
              data-selected={occurrence.id === selectedOccurrenceId || undefined}
              aria-pressed={occurrence.id === selectedOccurrenceId}
              onClick={() => onSelectOccurrence(occurrence.id)}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                occurrence.id === selectedOccurrenceId
                  ? "border-border/60 bg-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-accent/60"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{occurrence.label}</span>
              {occurrence.isCurrent ? (
                <Badge size="sm" variant="secondary">
                  current
                </Badge>
              ) : null}
            </button>
          ))}
        </section>
      ) : null}

      <p className="text-xs leading-5 text-muted-foreground">{task.intake.brief}</p>

      <section
        className="rounded-lg border border-border/70 p-3"
        data-testid="guided-task-artifact"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{artifact ? `${artifact.title}` : "Stage output"}</h3>
          <Badge size="sm" variant="outline">
            {occurrence?.status ?? "starting"}
          </Badge>
        </div>
        {artifact ? (
          <>
            {stage === "build" ? (
              <p
                data-testid="guided-build-plan-link"
                className="mt-2 text-xs text-muted-foreground"
              >
                Approved Plan revision {artifact.revision} anchors this Implement projection.
              </p>
            ) : null}
            <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
              {artifact.markdown}
            </pre>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            The active conversation will publish the {TASK_WORKSPACE_STAGE_PRESENTATION[stage]}{" "}
            output here.
          </p>
        )}
      </section>

      <section
        className="rounded-lg border border-border/70 p-3 text-xs"
        data-testid="guided-task-repository"
      >
        <p className="font-medium">Repository</p>
        <p className="mt-1 truncate text-muted-foreground">{repository?.workspaceRoot}</p>
        <p className="mt-1 flex items-center gap-1 text-muted-foreground">
          <GitBranchIcon className="size-3.5" />
          {repository?.branch ?? repository?.baseRef}
        </p>
        <p className="mt-2 text-muted-foreground">
          Worktree: {repository?.worktreePath ?? repository?.provisioningStatus}
        </p>
      </section>

      <section
        className="rounded-lg border border-border/70 p-3"
        data-testid="guided-task-permissions"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Permissions</h3>
          <Badge size="sm" variant="outline">
            {runtimeModeConfig[activeRuntimeMode].label}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Applies to every stage session, including Implement. The next stage starts in the new
          mode; the open conversation adopts it immediately.
        </p>
        <div className="mt-3 grid gap-2" data-testid="task-panel-permissions-picker">
          {runtimeModeOptions.map((mode) => {
            const option = runtimeModeConfig[mode];
            const active = mode === activeRuntimeMode;
            return (
              <label
                key={mode}
                data-testid={`task-panel-permissions-option-${mode}`}
                data-active={active || undefined}
                className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition-colors ${
                  active ? "border-primary bg-primary/5" : "border-border/70 hover:border-border"
                }`}
              >
                <input
                  type="radio"
                  name="task-panel-permissions"
                  className="mt-0.5 size-4 shrink-0"
                  value={mode}
                  checked={active}
                  disabled={commands.isBusy || pendingRuntimeMode !== null}
                  onChange={() => void changeRuntimeMode(mode)}
                />
                <span className="min-w-0 space-y-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-medium">
                    <option.icon className="size-3.5 shrink-0 text-muted-foreground" />
                    {option.label}
                  </span>
                  <span className="block text-xs text-muted-foreground">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
        {permissionsError !== null ? (
          <p
            role="alert"
            data-testid="task-panel-permissions-error"
            className="mt-2 rounded-md border border-destructive/35 bg-destructive/8 p-2 text-xs text-destructive"
          >
            {permissionsError}
          </p>
        ) : null}
      </section>

      {gateOpen ? (
        <section
          className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
          data-testid="guided-plan-gate"
        >
          <div>
            <h3 className="text-sm font-semibold">Plan ready for review</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {canRevise
                ? "Approve this Plan, or use Revise from here to start a new Plan occurrence."
                : "Approve this Plan when it is ready."}
            </p>
          </div>
          {isPlanValidationError(commands.error) ? (
            <div
              role="alert"
              data-testid="guided-plan-validation-error"
              className="space-y-1 rounded-md border border-destructive/35 bg-destructive/8 p-3 text-xs text-destructive"
            >
              <p className="font-semibold">This Plan cannot be approved yet.</p>
              <p>{commands.error}</p>
              <p>
                {canRevise
                  ? "Use Revise from here above the conversation to ask the active stage conversation to repair it."
                  : "Return to the current Plan to revise it."}
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              data-testid="guided-plan-approve"
              size="sm"
              disabled={commands.isBusy}
              title={commands.isBusy ? "Another task command is running." : undefined}
              onClick={approvePlan}
            >
              Approve Plan
            </Button>
          </div>
        </section>
      ) : approved && task.preferences.worktreePolicy === "never" ? (
        <section
          className="space-y-3 rounded-lg border border-border/70 p-3"
          data-testid="guided-worktree-policy"
        >
          <div>
            <h3 className="text-sm font-semibold">Choose a worktree when ready</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The approved Plan remains in this conversation while the worktree is prepared.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              data-testid="guided-worktree-now"
              size="sm"
              variant="outline"
              disabled={commands.isBusy}
              onClick={() => setWorktreePolicy("now")}
            >
              Now
            </Button>
            <Button
              data-testid="guided-worktree-later"
              size="sm"
              disabled={commands.isBusy}
              onClick={() => setWorktreePolicy("later")}
            >
              Later
            </Button>
          </div>
        </section>
      ) : approved && !hasImplementOccurrence(task) ? (
        <section
          className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-3"
          data-testid="guided-start-implement"
        >
          <h3 className="text-sm font-semibold">Plan approved</h3>
          <p className="text-xs text-muted-foreground">
            Start Implement in the managed task worktree. Upgraded Guided tasks first move to
            guided@0.3.0, then expose the write-enabled start.
          </p>
          <Button
            data-testid="guided-start-implement-button"
            size="sm"
            disabled={commands.isBusy || startReason !== null}
            title={startReason ?? undefined}
            onClick={() => void startImplement()}
          >
            {task.versions.workflowDefinition === "guided@0.2.0"
              ? "Start Implement"
              : "Start Implement"}
          </Button>
          {startReason ? (
            <p
              data-testid="guided-start-implement-disabled-reason"
              className="text-xs text-muted-foreground"
            >
              {startReason}
            </p>
          ) : task.versions.workflowDefinition === "guided@0.2.0" ? (
            <p className="text-xs text-muted-foreground">
              This click upgrades the task to guided@0.3.0. Start becomes available after the server
              persists the upgrade.
            </p>
          ) : null}
        </section>
      ) : stage === "build" || hasBuildProjection ? (
        <section
          data-testid="guided-implementation-panel"
          className="space-y-3 rounded-lg border border-border/70 p-3"
        >
          <div>
            <h3 className="text-sm font-semibold">Implement progress</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Approved Plan {planArtifact ? `revision ${planArtifact.revision}` : "projection"} ·
              server-persisted phases, checks, checkpoints, and amendments.
            </p>
          </div>

          {implementationComplete ? (
            <div
              data-testid="guided-implementation-complete"
              className="rounded-md border border-success/30 bg-success/5 p-3 text-xs"
            >
              <p className="font-semibold text-success-foreground">Implementation complete</p>
              <p data-testid="guided-resulting-commit" className="mt-1 break-all font-mono">
                {task.build.resultingCommitSha}
              </p>
              <p className="mt-2 text-muted-foreground">
                Guided verification is deferred to the Guided verification slice.
              </p>
            </div>
          ) : null}

          {amendmentGate ? (
            <div
              data-testid="guided-amendment-gate"
              className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">Plan amendment review</p>
                <Badge size="sm" variant="warning">
                  {amendmentGate.status}
                </Badge>
              </div>
              <dl className="grid gap-2">
                <div>
                  <dt className="font-medium">Expected</dt>
                  <dd className="text-muted-foreground">{amendmentGate.expected}</dd>
                </div>
                <div>
                  <dt className="font-medium">Found</dt>
                  <dd className="text-muted-foreground">{amendmentGate.found}</dd>
                </div>
                <div>
                  <dt className="font-medium">Proposed changes</dt>
                  <dd className="text-muted-foreground">{amendmentGate.proposedChanges}</dd>
                </div>
              </dl>
              {amendmentGate.proposedPlanMarkdown ? (
                <pre
                  data-testid="guided-amendment-proposed-plan"
                  className="max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border/60 bg-background p-2"
                >
                  {amendmentGate.proposedPlanMarkdown}
                </pre>
              ) : amendmentGate.planDiff ? (
                <p data-testid="guided-amendment-diff" className="text-muted-foreground">
                  {amendmentGate.planDiff.summary} · {amendmentGate.planDiff.baseRevisionId} →{" "}
                  {amendmentGate.planDiff.proposedRevisionId}
                </p>
              ) : null}
              <Textarea
                data-testid={`guided-amendment-feedback-${amendmentGate.id}`}
                value={amendmentFeedback[amendmentGate.id] ?? ""}
                onChange={(event) =>
                  setAmendmentFeedback((current) => ({
                    ...current,
                    [amendmentGate.id]: event.currentTarget.value,
                  }))
                }
                placeholder="What should the implementer change?"
                className="min-h-16 text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  data-testid={`guided-amendment-approve-${amendmentGate.id}`}
                  size="xs"
                  disabled={commands.isBusy || amendmentGate.status !== "requested"}
                  title={
                    amendmentGate.status !== "requested"
                      ? "This amendment has already been reviewed."
                      : commands.isBusy
                        ? "Another task command is running."
                        : undefined
                  }
                  onClick={() => {
                    const base = commands.commandBase("task.amendment.approve");
                    void commands.dispatch(
                      {
                        ...base,
                        expectedTaskRevision: task.taskRevision,
                        operationKey: operationKey(base.commandId, "amendment-approve"),
                        amendmentId: amendmentGate.id,
                        approvedBy: currentUser.id,
                      },
                      "approve-amendment",
                    );
                  }}
                >
                  Approve amendment
                </Button>
                <Button
                  data-testid={`guided-amendment-request-changes-${amendmentGate.id}`}
                  size="xs"
                  variant="outline"
                  disabled={
                    commands.isBusy ||
                    amendmentGate.status !== "requested" ||
                    !(amendmentFeedback[amendmentGate.id] ?? "").trim()
                  }
                  title={
                    amendmentGate.status !== "requested"
                      ? "This amendment has already been reviewed."
                      : !(amendmentFeedback[amendmentGate.id] ?? "").trim()
                        ? "Add feedback before requesting changes."
                        : commands.isBusy
                          ? "Another task command is running."
                          : undefined
                  }
                  onClick={() => {
                    const feedback = (amendmentFeedback[amendmentGate.id] ?? "").trim();
                    if (!feedback) return;
                    const base = commands.commandBase("task.amendment.request-changes");
                    void commands.dispatch(
                      {
                        ...base,
                        expectedTaskRevision: task.taskRevision,
                        operationKey: operationKey(base.commandId, "amendment-request-changes"),
                        amendmentId: amendmentGate.id,
                        feedback,
                      },
                      "request-amendment-changes",
                    );
                  }}
                >
                  Request changes
                </Button>
              </div>
            </div>
          ) : null}

          <div data-testid="guided-phase-tree" className="space-y-3">
            {task.build.phases.map((phase) => {
              const checks = phaseChecks(task, phase);
              return (
                <div
                  key={phase.id}
                  data-testid={`guided-build-phase-${phase.id}`}
                  className="space-y-2 rounded-md border border-border/60 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{phase.title}</p>
                        {task.build.activePhaseId === phase.id ? (
                          <Badge size="sm" variant="info">
                            current
                          </Badge>
                        ) : null}
                        <Badge size="sm" variant={buildStatusVariant(phase.status)}>
                          {phase.status}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Checkpoint: {phase.checkpointPolicy} · {phase.workItems.length} work item
                        {phase.workItems.length === 1 ? "" : "s"} · {checks.length} check
                        {checks.length === 1 ? "" : "s"}
                      </p>
                      {phase.phaseCommitSha ? (
                        <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                          Commit {phase.phaseCommitSha}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {phase.workItems.map((item) => {
                    const itemChecks = item.checkIds
                      .map((checkId) => task.build.checks.find((check) => check.id === checkId))
                      .filter((check): check is NonNullable<typeof check> => check !== undefined);
                    const dependencyReason = dependenciesPass(phase, item)
                      ? null
                      : `Depends on ${item.dependsOn.join(", ")}.`;
                    return (
                      <div
                        key={item.id}
                        data-testid={`guided-build-work-${item.id}`}
                        className="space-y-2 rounded border border-border/50 bg-background p-2"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium">{item.title}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {item.summary ?? dependencyReason ?? "No dependencies"}
                            </p>
                            {item.invalidationReason ? (
                              <p
                                data-testid={`guided-invalidation-${item.id}`}
                                className="mt-1 text-[11px] text-warning-foreground"
                              >
                                {item.invalidationReason}
                              </p>
                            ) : null}
                          </div>
                          <Badge size="sm" variant={buildStatusVariant(item.status)}>
                            {item.status}
                          </Badge>
                        </div>

                        {itemChecks.map((check) => {
                          const attempts = checkAttempts(task, check.id);
                          const latestAttempt = attempts.at(-1);
                          const runReason = automatedCheckDisabledReason(
                            task,
                            check,
                            commands.isBusy,
                          );
                          const note = manualNotes[check.id] ?? "";
                          const recordReason = manualCheckDisabledReason(
                            task,
                            check,
                            note,
                            commands.isBusy,
                          );
                          return (
                            <div
                              key={check.id}
                              data-testid={`guided-build-check-${check.id}`}
                              className="space-y-2 rounded border border-border/50 p-2 text-xs"
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <p className="font-medium">{check.label}</p>
                                  <p className="text-[11px] text-muted-foreground">
                                    {check.kind} · {check.status}
                                  </p>
                                  {check.command ? (
                                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                                      {check.command}
                                    </p>
                                  ) : null}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  {check.kind === "automated" ? (
                                    <Button
                                      data-testid={`guided-check-run-${check.id}`}
                                      size="xs"
                                      variant="outline"
                                      disabled={runReason !== null}
                                      title={runReason ?? undefined}
                                      onClick={() => {
                                        const base = commands.commandBase(
                                          "task.implementation.check.run",
                                        );
                                        void commands.dispatch(
                                          {
                                            ...base,
                                            expectedTaskRevision: task.taskRevision,
                                            checkId: check.id,
                                            operationKey: operationKey(
                                              base.commandId,
                                              `check-${check.id}`,
                                            ),
                                          },
                                          `run-check-${check.id}`,
                                        );
                                      }}
                                    >
                                      {check.status === "pending" ? "Run" : "Rerun"}
                                    </Button>
                                  ) : null}
                                </div>
                              </div>
                              {check.kind === "automated" && runReason ? (
                                <p
                                  data-testid={`guided-check-run-disabled-reason-${check.id}`}
                                  className="text-[11px] text-muted-foreground"
                                >
                                  {runReason}
                                </p>
                              ) : null}
                              {check.kind === "manual" ? (
                                <div className="space-y-2">
                                  <input
                                    aria-label={`Manual note for ${check.label}`}
                                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                                    placeholder="Manual review note"
                                    value={note}
                                    onChange={(event) =>
                                      setManualNotes((current) => ({
                                        ...current,
                                        [check.id]: event.currentTarget.value,
                                      }))
                                    }
                                  />
                                  <div className="flex flex-wrap gap-2">
                                    {(["pass", "fail", "blocked"] as const).map((status) => (
                                      <Button
                                        key={status}
                                        data-testid={`guided-check-record-${check.id}-${status}`}
                                        size="xs"
                                        variant={status === "pass" ? "default" : "outline"}
                                        disabled={recordReason !== null}
                                        title={recordReason ?? undefined}
                                        onClick={() => {
                                          const base = commands.commandBase(
                                            "task.build.check.record-manual",
                                          );
                                          void commands.dispatch(
                                            {
                                              ...base,
                                              expectedTaskRevision: task.taskRevision,
                                              checkId: check.id,
                                              status,
                                              note: note.trim(),
                                              operationKey: operationKey(
                                                base.commandId,
                                                `record-check-${check.id}-${status}`,
                                              ),
                                            },
                                            `record-check-${check.id}-${status}`,
                                          );
                                        }}
                                      >
                                        Record {status}
                                      </Button>
                                    ))}
                                  </div>
                                  {recordReason ? (
                                    <p
                                      data-testid={`guided-check-record-disabled-reason-${check.id}`}
                                      className="text-[11px] text-muted-foreground"
                                    >
                                      {recordReason}
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                              {check.commitSha ? (
                                <p
                                  data-testid={`guided-check-commit-${check.id}`}
                                  className="break-all font-mono text-[11px] text-muted-foreground"
                                >
                                  Commit {check.commitSha}
                                </p>
                              ) : null}
                              {check.output ? (
                                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-2 text-[11px] text-muted-foreground">
                                  {check.output}
                                </pre>
                              ) : null}
                              {check.note ? (
                                <p className="text-[11px] text-muted-foreground">{check.note}</p>
                              ) : null}
                              {attempts.length > 0 ? (
                                <details data-testid={`guided-check-attempts-${check.id}`} open>
                                  <summary className="cursor-pointer text-[11px] text-muted-foreground">
                                    {attempts.length} attempt{attempts.length === 1 ? "" : "s"}
                                  </summary>
                                  <ol className="mt-1 space-y-1">
                                    {attempts.map((attempt) => (
                                      <li
                                        key={attempt.id}
                                        data-testid={`guided-check-attempt-${attempt.id}`}
                                        className="rounded border border-border/40 p-1"
                                      >
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-mono text-[11px]">
                                            {attempt.id}
                                          </span>
                                          <Badge
                                            size="sm"
                                            variant={buildStatusVariant(attempt.status)}
                                          >
                                            {attempt.status}
                                          </Badge>
                                          {latestAttempt?.id === attempt.id ? (
                                            <span className="text-[11px] text-muted-foreground">
                                              latest
                                            </span>
                                          ) : null}
                                        </div>
                                        {attempt.endingCommitSha ? (
                                          <p className="break-all font-mono text-[11px] text-muted-foreground">
                                            {attempt.endingCommitSha}
                                          </p>
                                        ) : null}
                                        {attempt.output ? (
                                          <p className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">
                                            {attempt.output}
                                          </p>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ol>
                                </details>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {task.build.checkpoints.length > 0 ? (
            <div data-testid="guided-checkpoints" className="space-y-2">
              <p className="text-xs font-medium">Checkpoints</p>
              {task.build.checkpoints.map((checkpoint) => {
                const reason = checkpointDisabledReason(task, checkpoint, commands.isBusy);
                const observedCommit = checkpoint.observedCommitSha;
                return (
                  <div
                    key={checkpoint.id}
                    data-testid={`guided-checkpoint-${checkpoint.id}`}
                    className="rounded-md border border-info/40 bg-info/5 p-2 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{checkpoint.reason}</p>
                        <p className="text-muted-foreground">
                          Phase {checkpoint.phaseId} · checks{" "}
                          {checkpoint.checkIds.join(", ") || "none"}
                        </p>
                        <p
                          data-testid={`guided-checkpoint-observed-${checkpoint.id}`}
                          className="break-all font-mono text-[11px] text-muted-foreground"
                        >
                          {observedCommit
                            ? `Observed ${observedCommit}`
                            : "Observed commit not observed yet"}
                        </p>
                      </div>
                      <Button
                        data-testid={`guided-checkpoint-continue-${checkpoint.id}`}
                        size="xs"
                        disabled={reason !== null}
                        title={reason ?? undefined}
                        onClick={() => {
                          const base = commands.commandBase("task.build.checkpoint.continue");
                          void commands.dispatch(
                            {
                              ...base,
                              expectedTaskRevision: task.taskRevision,
                              operationKey: operationKey(
                                base.commandId,
                                `checkpoint-${checkpoint.id}`,
                              ),
                              checkpointId: checkpoint.id,
                            },
                            `continue-checkpoint-${checkpoint.id}`,
                          );
                        }}
                      >
                        Continue
                      </Button>
                    </div>
                    {reason ? (
                      <p
                        data-testid={`guided-checkpoint-disabled-reason-${checkpoint.id}`}
                        className="mt-1 text-[11px] text-muted-foreground"
                      >
                        {reason}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {task.build.checks.some(
            (check) => check.status === "fail" || check.status === "blocked",
          ) && !amendmentGate ? (
            <div
              data-testid="guided-amendment-hint"
              className="rounded-md border border-border/60 p-2 text-xs text-muted-foreground"
            >
              A failed check blocks completion. The active Implement conversation can propose a
              reviewed Plan amendment with the task implementation tools.
            </div>
          ) : null}

          {!implementationComplete ? (
            <div
              data-testid="guided-implementation-completion-note"
              className="space-y-1 border-t border-border/50 pt-3 text-xs text-muted-foreground"
            >
              <p>
                Completion is provider-owned. The active Implement conversation requests completion
                after all phases, work items, checks, checkpoints, and amendment gates are clear.
              </p>
              {completeReason ? (
                <p data-testid="guided-complete-disabled-reason">
                  Current blocker: {completeReason}
                </p>
              ) : (
                <p>The server will verify the clean worktree and exact branch HEAD.</p>
              )}
            </div>
          ) : null}
        </section>
      ) : (
        <p className="rounded-lg border border-border/70 p-3 text-sm text-muted-foreground">
          Continue in the conversation. Kata advances the next stage after its typed output settles.
        </p>
      )}

      {task.bootstrap?.status === "failed" ? (
        <Button
          data-testid="guided-implementation-start-retry"
          size="sm"
          variant="outline"
          disabled={commands.isBusy}
          title={commands.isBusy ? "Another task command is running." : undefined}
          onClick={() => {
            const base = commands.commandBase("task.operation.retry");
            void commands.dispatch(
              {
                ...base,
                expectedTaskRevision: task.taskRevision,
                targetOperationKey: task.bootstrap!.operationKey,
              },
              "retry-implementation-start",
            );
          }}
        >
          Retry failed start
        </Button>
      ) : null}

      {repository?.provisioningStatus === "failed" && worktreeOperationKey ? (
        <Button
          data-testid="guided-worktree-retry"
          size="sm"
          variant="outline"
          disabled={commands.isBusy}
          onClick={() => {
            const base = commands.commandBase("task.operation.retry");
            void commands.dispatch(
              {
                ...base,
                expectedTaskRevision: task.taskRevision,
                targetOperationKey: worktreeOperationKey,
              },
              "retry-worktree",
            );
          }}
        >
          Retry worktree
        </Button>
      ) : null}

      {commands.error && (!isPlanValidationError(commands.error) || !gateOpen) ? (
        <p
          data-testid="guided-task-error"
          className="rounded-lg border border-destructive/35 bg-destructive/8 p-3 text-sm text-destructive"
        >
          {commands.error}
        </p>
      ) : null}
    </div>
  );
}
