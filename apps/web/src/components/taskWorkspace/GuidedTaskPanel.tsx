import type { TaskWorkspace, TaskWorkspaceArtifactKind } from "@kata-sh/code-contracts";
import { TASK_WORKSPACE_STAGE_PRESENTATION } from "@kata-sh/code-shared/taskWorkspaceCatalog";
import { taskWorkspaceCatalogEntryForVersion } from "@kata-sh/code-shared/taskWorkspacePresets";
import { CheckCircle2Icon, CircleIcon, GitBranchIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";

import type { TaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

function latestArtifact(task: TaskWorkspace, kind: TaskWorkspaceArtifactKind) {
  const artifact = task.artifacts.find((candidate) => candidate.kind === kind);
  return (
    artifact?.revisions.find((revision) => revision.revision === artifact.currentRevision) ?? null
  );
}

function currentStage(task: TaskWorkspace) {
  return task.workflowRuns.at(-1)?.currentStage ?? "questions";
}

function operationKey(commandId: string, action: string): string {
  return `task-${action}-${commandId}`;
}

export function GuidedTaskPanel(props: {
  readonly task: TaskWorkspace;
  readonly commands: TaskWorkspaceCommands;
}) {
  const { task, commands } = props;
  const [feedback, setFeedback] = useState("");
  const stage = currentStage(task);
  const catalog = taskWorkspaceCatalogEntryForVersion(task.versions.workflowDefinition);
  const artifact = latestArtifact(
    task,
    stage === "questions" || stage === "research" || stage === "design" || stage === "plan"
      ? stage
      : "plan",
  );
  const occurrence = task.occurrences
    .filter((candidate) => candidate.stage === stage)
    .toSorted((left, right) => right.ordinal - left.ordinal)[0];
  const approved =
    stage === "plan" && occurrence?.status === "completed" && occurrence.gateOutcome === "approved";
  const gateOpen = task.planGate?.status === "open";
  const repository = task.workspace.repositories[0];
  const currentIndex = catalog?.stages.indexOf(stage) ?? -1;
  const worktreeOperationKey = repository?.baseCommitSha
    ? `${task.id}:worktree:${repository.baseCommitSha}:${task.preferences.worktreePolicy}`
    : null;

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

  const requestChanges = () => {
    const trimmed = feedback.trim();
    if (!trimmed) return;
    const base = commands.commandBase("task.stage.request-changes");
    void commands.dispatch(
      {
        ...base,
        expectedTaskRevision: task.taskRevision,
        operationKey: operationKey(base.commandId, "request-changes"),
        feedback: trimmed,
      },
      "request-changes",
    );
    setFeedback("");
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

  return (
    <aside
      data-testid="guided-task-panel"
      className="flex min-h-0 min-w-0 flex-col gap-4 overflow-auto border-t border-border bg-card p-4 lg:border-t-0 lg:border-l lg:p-5"
    >
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Task</p>
        <h2 className="mt-1 text-base font-semibold">{task.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{task.intake.brief}</p>
      </header>

      {catalog ? (
        <ol className="grid gap-1" data-testid="guided-stage-rail">
          {catalog.stages
            .filter((entry) => entry !== "build" && entry !== "verify" && entry !== "verified")
            .map((entry, index) => {
              const isActive = entry === stage;
              const isComplete = index < currentIndex || (entry === "plan" && approved);
              return (
                <li
                  key={entry}
                  data-testid={`guided-stage-${entry}`}
                  data-active={isActive || undefined}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                    isActive ? "bg-primary/10 font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {isComplete ? (
                    <CheckCircle2Icon className="size-4 text-success-foreground" />
                  ) : isActive ? (
                    <Loader2Icon className="size-4 text-primary" />
                  ) : (
                    <CircleIcon className="size-4 text-muted-foreground/50" />
                  )}
                  {TASK_WORKSPACE_STAGE_PRESENTATION[entry]}
                  {isActive ? (
                    <Badge className="ml-auto" size="sm" variant="secondary">
                      current
                    </Badge>
                  ) : null}
                </li>
              );
            })}
        </ol>
      ) : null}

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
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
            {artifact.markdown}
          </pre>
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

      {gateOpen ? (
        <section
          className="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
          data-testid="guided-plan-gate"
        >
          <div>
            <h3 className="text-sm font-semibold">Plan ready for review</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Approve this Plan or send feedback for one continuation conversation.
            </p>
          </div>
          <Textarea
            data-testid="guided-plan-feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.currentTarget.value)}
            placeholder="What should change?"
            className="min-h-20 text-sm"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              data-testid="guided-plan-request-changes"
              size="sm"
              variant="outline"
              disabled={!feedback.trim() || commands.isBusy}
              onClick={requestChanges}
            >
              Request changes
            </Button>
            <Button
              data-testid="guided-plan-approve"
              size="sm"
              disabled={commands.isBusy}
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
      ) : approved ? (
        <p className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-muted-foreground">
          Plan approved. Implement is deferred in this slice.
        </p>
      ) : (
        <p className="rounded-lg border border-border/70 p-3 text-sm text-muted-foreground">
          Continue in the conversation. Kata advances the next stage after its typed output settles.
        </p>
      )}

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

      {commands.error ? (
        <p
          data-testid="guided-task-error"
          className="rounded-lg border border-destructive/35 bg-destructive/8 p-3 text-sm text-destructive"
        >
          {commands.error}
        </p>
      ) : null}
    </aside>
  );
}
