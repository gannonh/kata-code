import {
  type TaskWorkspace,
  type TaskWorkspaceArtifactKind,
  type TaskWorkspaceCommentAuthor,
  type TaskWorkspaceStage,
} from "@kata-sh/code-contracts";
import { useClerk } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2Icon, CircleIcon, GitBranchIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { usePrimaryEnvironmentId } from "../../environments/primary";
import { selectSidebarThreadsAcrossEnvironments, useStore } from "../../store";
import { currentTaskStage, useTaskWorkspaceStore } from "../../taskWorkspace/taskWorkspaceStore";
import { useTaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { ArtifactsPanel } from "./ArtifactsPanel";
import { CommentsPanel } from "./CommentsPanel";
import { SessionsPanel } from "./SessionsPanel";

const STAGES: ReadonlyArray<{ id: TaskWorkspaceStage; label: string }> = [
  { id: "questions", label: "Questions" },
  { id: "plan", label: "Plan" },
  { id: "build", label: "Build" },
  { id: "verify", label: "Verify" },
  { id: "verified", label: "Verified" },
];

const DEFAULT_PLAN = `# Plan

## Phase 1 — Deterministic walking skeleton

### Work item 1
Create and commit \`task-workspace-slice-1.txt\` in the provisioned task worktree.

## Acceptance criterion
The fixture file exists at the resulting commit with the canonical Slice 1 content.`;

function latestArtifact(task: TaskWorkspace, kind: TaskWorkspaceArtifactKind) {
  const artifact = task.artifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) return null;
  return (
    artifact.revisions.find((revision) => revision.revision === artifact.currentRevision) ?? null
  );
}

function stageIndex(stage: TaskWorkspaceStage): number {
  return STAGES.findIndex((entry) => entry.id === stage);
}

function statusLabel(stage: TaskWorkspaceStage): string {
  return stage === "verified" ? "Verified" : stage[0]!.toUpperCase() + stage.slice(1);
}

export function TaskWorkspaceView({ taskId }: { taskId: string }) {
  const task = useTaskWorkspaceStore((state) => state.taskById[taskId] ?? null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const [questionsMarkdown, setQuestionsMarkdown] = useState("");
  const [planMarkdown, setPlanMarkdown] = useState(DEFAULT_PLAN);
  const { user } = useClerk();
  const commands = useTaskWorkspaceCommands(taskId);
  const { dispatch, commandBase, pendingAction, isBusy, error } = commands;
  const currentUser = useMemo<TaskWorkspaceCommentAuthor>(
    () => ({
      kind: "user",
      id: user?.id ?? "local-user",
      displayName:
        user?.fullName?.trim() || user?.primaryEmailAddress?.emailAddress.trim() || "You",
    }),
    [user],
  );

  const questionsArtifact = task ? latestArtifact(task, "questions") : null;
  const planArtifact = task ? latestArtifact(task, "plan") : null;
  const verificationArtifact = task ? latestArtifact(task, "verification") : null;
  const stage = task ? currentTaskStage(task) : "questions";
  const repository = task?.workspace.repositories[0] ?? null;
  const availableThreads = useMemo(
    () =>
      task && repository
        ? threads.filter(
            (thread) =>
              thread.environmentId === primaryEnvironmentId &&
              thread.projectId === repository.projectId &&
              thread.archivedAt === null,
          )
        : [],
    [primaryEnvironmentId, repository, task, threads],
  );

  useEffect(() => {
    if (questionsArtifact) setQuestionsMarkdown(questionsArtifact.markdown);
  }, [questionsArtifact?.id, questionsArtifact?.revision]);

  useEffect(() => {
    if (planArtifact) setPlanMarkdown(planArtifact.markdown);
  }, [planArtifact?.id, planArtifact?.revision]);

  if (!task) {
    return (
      <SidebarInset className="h-dvh min-h-0 bg-background text-foreground">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading task workspace…
        </div>
      </SidebarInset>
    );
  }

  const linkedSession =
    task.sessions.find((session) => session.stage === stage && session.role === "primary") ?? null;
  const buildItem = task.build.phases[0]?.workItems[0] ?? null;
  const verificationResult = task.verification.results.find(
    (result) => result.criterionId === task.verification.criteria[0]?.id,
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="border-b border-border px-3 py-2 sm:px-5 sm:py-3">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="size-7 shrink-0 md:hidden" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{task.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                Standard · {task.versions.workflowDefinition} · before-build
              </p>
            </div>
            <Badge variant={stage === "verified" ? "success" : "secondary"}>
              {statusLabel(stage)}
            </Badge>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-5">
            <ol className="grid grid-cols-5 overflow-hidden rounded-xl border border-border bg-card">
              {STAGES.map((entry, index) => {
                const complete = index < stageIndex(stage) || stage === "verified";
                const active = entry.id === stage;
                return (
                  <li
                    key={entry.id}
                    className="flex min-w-0 items-center gap-2 border-r border-border px-2 py-3 text-xs last:border-r-0 sm:px-3"
                    data-active={active || undefined}
                  >
                    {complete ? (
                      <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />
                    ) : active ? (
                      <Loader2Icon className="size-4 shrink-0 animate-spin text-primary" />
                    ) : (
                      <CircleIcon className="size-4 shrink-0 text-muted-foreground/50" />
                    )}
                    <span
                      className={
                        active ? "truncate font-semibold" : "truncate text-muted-foreground"
                      }
                    >
                      {entry.label}
                    </span>
                  </li>
                );
              })}
            </ol>

            <section className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Repository
                </p>
                <p className="mt-1 truncate text-sm font-medium">{repository?.workspaceRoot}</p>
                <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <GitBranchIcon className="size-3.5" />
                  {repository?.branch ?? repository?.baseRef}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Worktree
                </p>
                <p data-testid="task-worktree-path" className="mt-1 truncate text-sm">
                  {repository?.worktreePath ?? "Provisioned after Plan approval"}
                </p>
                <Badge
                  className="mt-2"
                  size="sm"
                  variant={repository?.provisioningStatus === "provisioned" ? "success" : "outline"}
                >
                  {repository?.provisioningStatus}
                </Badge>
              </div>
            </section>

            {stage !== "verified" ? (
              <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold">{statusLabel(stage)} session</h2>
                    <p className="text-xs text-muted-foreground">
                      Link an existing repository thread as this stage's agent session.
                    </p>
                  </div>
                  {linkedSession && primaryEnvironmentId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <Link
                          to="/$environmentId/$threadId"
                          params={{
                            environmentId: primaryEnvironmentId,
                            threadId: linkedSession.threadId,
                          }}
                        />
                      }
                    >
                      Open linked session
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Link a primary session from the Sessions panel below.
                    </p>
                  )}
                </div>
              </section>
            ) : null}

            {stage === "questions" ? (
              <section className="space-y-4 rounded-xl border border-border bg-card p-4">
                <div>
                  <h2 className="font-semibold">Questions artifact</h2>
                  <p className="text-sm text-muted-foreground">
                    Record clarified requirements and constraints from the linked session.
                  </p>
                </div>
                <Textarea
                  data-testid="task-questions-editor"
                  className="min-h-56 font-mono text-xs"
                  value={questionsMarkdown}
                  onChange={(event) => setQuestionsMarkdown(event.currentTarget.value)}
                  placeholder="# Questions\n\n- What should the fixture prove?"
                />
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Revision {questionsArtifact?.revision ?? 0}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      data-testid="task-save-questions"
                      size="sm"
                      variant="outline"
                      disabled={!questionsMarkdown.trim() || isBusy}
                      onClick={() =>
                        void dispatch(
                          {
                            ...commandBase("task.artifact.upsert"),
                            kind: "questions",
                            title: "Questions",
                            markdown: questionsMarkdown,
                            sourceSessionId: linkedSession?.id ?? null,
                          },
                          "save-questions",
                        )
                      }
                    >
                      Save revision
                    </Button>
                    <Button
                      data-testid="task-complete-questions"
                      size="sm"
                      disabled={!questionsArtifact || isBusy}
                      onClick={() =>
                        void dispatch(
                          { ...commandBase("task.questions.complete") },
                          "complete-questions",
                        )
                      }
                    >
                      Complete Questions
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}

            {stage === "plan" ? (
              <section className="space-y-4 rounded-xl border border-border bg-card p-4">
                <div>
                  <h2 className="font-semibold">Plan artifact</h2>
                  <p className="text-sm text-muted-foreground">
                    Slice 1 uses one phase, one work item, and one acceptance criterion.
                  </p>
                </div>
                <Textarea
                  data-testid="task-plan-editor"
                  className="min-h-72 font-mono text-xs"
                  value={planMarkdown}
                  onChange={(event) => setPlanMarkdown(event.currentTarget.value)}
                />
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    Revision {planArtifact?.revision ?? 0}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      data-testid="task-save-plan"
                      size="sm"
                      variant="outline"
                      disabled={!planMarkdown.trim() || isBusy}
                      onClick={() =>
                        void dispatch(
                          {
                            ...commandBase("task.artifact.upsert"),
                            kind: "plan",
                            title: "Implementation plan",
                            markdown: planMarkdown,
                            sourceSessionId: linkedSession?.id ?? null,
                          },
                          "save-plan",
                        )
                      }
                    >
                      Save revision
                    </Button>
                    <Button
                      data-testid="task-approve-plan"
                      size="sm"
                      disabled={!planArtifact || isBusy}
                      onClick={() =>
                        void dispatch({ ...commandBase("task.plan.approve") }, "approve-plan")
                      }
                    >
                      {pendingAction === "approve-plan" ? "Provisioning…" : "Approve Plan"}
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}

            {stage === "build" ? (
              <section className="space-y-4 rounded-xl border border-border bg-card p-4">
                <div>
                  <h2 className="font-semibold">Build progress</h2>
                  <p className="text-sm text-muted-foreground">
                    Work-item status is owned by the task service. The fixture action writes and
                    commits the planned change.
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{buildItem?.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {buildItem?.summary ?? "Not started"}
                      </p>
                    </div>
                    <Badge variant={buildItem?.status === "completed" ? "success" : "outline"}>
                      {buildItem?.status}
                    </Badge>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={buildItem?.status === "running" || isBusy}
                    onClick={() =>
                      void dispatch(
                        {
                          ...commandBase("task.build.work-item.set-status"),
                          workItemId: buildItem?.id ?? "work-item-1",
                          status: "running",
                        },
                        "start-build",
                      )
                    }
                  >
                    Start work
                  </Button>
                  <Button
                    data-testid="task-apply-fixture"
                    size="sm"
                    disabled={isBusy}
                    onClick={() =>
                      void dispatch({ ...commandBase("task.fixture.apply") }, "apply-fixture")
                    }
                  >
                    {pendingAction === "apply-fixture" ? "Committing…" : "Apply fixture build"}
                  </Button>
                </div>
              </section>
            ) : null}

            {stage === "verify" ? (
              <section className="space-y-4 rounded-xl border border-border bg-card p-4">
                <div>
                  <h2 className="font-semibold">Commit-specific verification</h2>
                  <p className="text-sm text-muted-foreground">
                    Verification is bound to the exact resulting commit.
                  </p>
                </div>
                <div className="rounded-lg border border-border/70 p-4 text-sm">
                  <p className="font-medium">{task.verification.criteria[0]?.description}</p>
                  <p
                    data-testid="task-resulting-commit"
                    className="mt-2 break-all font-mono text-xs text-muted-foreground"
                  >
                    {task.build.resultingCommitSha}
                  </p>
                  {verificationResult ? (
                    <div className="mt-3 flex items-start gap-2">
                      <Badge variant={verificationResult.status === "pass" ? "success" : "error"}>
                        {verificationResult.status.toUpperCase()}
                      </Badge>
                      <p className="text-xs text-muted-foreground">{verificationResult.summary}</p>
                    </div>
                  ) : null}
                </div>
                {verificationArtifact ? (
                  <pre className="overflow-auto rounded-lg bg-muted/35 p-3 text-xs whitespace-pre-wrap">
                    {verificationArtifact.markdown}
                  </pre>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    data-testid="task-run-verification"
                    size="sm"
                    variant="outline"
                    disabled={isBusy}
                    onClick={() =>
                      void dispatch(
                        {
                          ...commandBase("task.verification.run"),
                          criterionId: task.verification.criteria[0]?.id ?? "criterion-1",
                        },
                        "run-verification",
                      )
                    }
                  >
                    {pendingAction === "run-verification" ? "Verifying…" : "Run verification"}
                  </Button>
                  <Button
                    data-testid="task-signoff"
                    size="sm"
                    disabled={verificationResult?.status !== "pass" || isBusy}
                    onClick={() =>
                      void dispatch(
                        { ...commandBase("task.verification.signoff") },
                        "verification-signoff",
                      )
                    }
                  >
                    Sign off
                  </Button>
                </div>
              </section>
            ) : null}

            {stage === "verified" ? (
              <section
                data-testid="task-verified-state"
                className="rounded-xl border border-success/35 bg-success/8 p-6"
              >
                <div className="flex items-start gap-3">
                  <CheckCircle2Icon className="mt-0.5 size-6 text-success-foreground" />
                  <div>
                    <h2 className="text-lg font-semibold">Task verified</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      All criteria passed at {task.build.resultingCommitSha?.slice(0, 12)} and
                      Verify signoff is recorded.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}

            {error ? (
              <p
                data-testid="task-command-error"
                className="rounded-lg border border-destructive/35 bg-destructive/8 p-3 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            <ArtifactsPanel task={task} commands={commands} />
            <SessionsPanel
              task={task}
              commands={commands}
              availableThreads={availableThreads}
              primaryEnvironmentId={primaryEnvironmentId}
              stage={stage}
            />
            <CommentsPanel task={task} commands={commands} currentUser={currentUser} />

            <section className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div>
                <h2 className="text-sm font-semibold">Deliver</h2>
                <p className="text-xs text-muted-foreground">
                  Draft-PR delivery arrives in Slice 7 and remains unavailable here.
                </p>
              </div>
              <Button disabled variant="outline" size="sm">
                Deliver unavailable
              </Button>
            </section>
          </div>
        </main>
      </div>
    </SidebarInset>
  );
}
