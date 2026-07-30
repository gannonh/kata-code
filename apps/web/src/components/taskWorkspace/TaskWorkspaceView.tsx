import {
  TASK_WORKSPACE_STAGE_LABELS,
  type TaskWorkspace,
  type TaskWorkspaceArtifactKind,
  type TaskWorkspaceCommentAuthor,
  taskWorkspaceCatalogEntryForVersion,
  type TaskWorkspacePresetCatalogEntry,
  type TaskWorkspaceStage,
} from "@kata-sh/code-contracts";
import { useClerk } from "@clerk/react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2Icon, CircleIcon, GitBranchIcon, Loader2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { hasCloudPublicConfig } from "../../cloud/publicConfig";
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
import { ContextManifestPanel } from "./ContextManifestPanel";
import { SessionsPanel } from "./SessionsPanel";

/**
 * Rail shown when a task pins a definition version this build has no catalog
 * entry for. Rendering the Standard ladder would be a guess; showing only the
 * stage the task is actually in is honest.
 */
const UNKNOWN_DEFINITION_STAGES: ReadonlyArray<TaskWorkspaceStage> = [];

/** Reasoning stages that write their own artifact and complete with their own command. */
const REASONING_STAGES = [
  { stage: "research", kind: "research", label: "Research", command: "task.research.complete" },
  { stage: "design", kind: "design", label: "Design", command: "task.design.complete" },
] as const satisfies ReadonlyArray<{
  stage: TaskWorkspaceStage;
  kind: TaskWorkspaceArtifactKind;
  label: string;
  command: "task.research.complete" | "task.design.complete";
}>;

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

function statusLabel(stage: TaskWorkspaceStage): string {
  return TASK_WORKSPACE_STAGE_LABELS[stage];
}

/**
 * Progress rail for a preset that advances automatically (Standard, Guided).
 *
 * The stage order comes from the task's *pinned* definition, so a task created
 * against an older version keeps rendering that version's shape.
 */
function WorkflowRail({
  stages,
  stage,
}: {
  stages: ReadonlyArray<TaskWorkspaceStage>;
  stage: TaskWorkspaceStage;
}) {
  const currentIndex = stages.indexOf(stage);
  return (
    <ol
      data-testid="task-workflow-rail"
      className="grid overflow-hidden rounded-xl border border-border bg-card"
      style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
    >
      {stages.map((entry, index) => {
        const complete = index < currentIndex || stage === "verified";
        const active = entry === stage;
        return (
          <li
            key={entry}
            data-testid={`task-workflow-rail-${entry}`}
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
            <span className={active ? "truncate font-semibold" : "truncate text-muted-foreground"}>
              {TASK_WORKSPACE_STAGE_LABELS[entry]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Timeline for a preset with no automatic rail (Freeform).
 *
 * There is no "progress" to show, because nothing advances on its own — so this
 * renders the stages the definition permits entering and lets the person start
 * one explicitly. Build and Verified are absent by design: they are reached by
 * approving a plan and signing off, the same as every other preset.
 */
function WorkflowTimeline({
  catalogEntry,
  stage,
  commands,
}: {
  catalogEntry: TaskWorkspacePresetCatalogEntry;
  stage: TaskWorkspaceStage;
  commands: ReturnType<typeof useTaskWorkspaceCommands>;
}) {
  const isTerminal = stage === "verified";
  return (
    <section
      data-testid="task-workflow-timeline"
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">Timeline</h2>
        <p className="text-xs text-muted-foreground">
          Freeform does not advance on its own. Accumulate sessions and artifacts, then start a
          stage when you are ready.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {catalogEntry.stages.map((entry) => {
          const active = entry === stage;
          const canStart =
            !active && !isTerminal && catalogEntry.explicitEntryStages.includes(entry);
          return (
            <div
              key={entry}
              data-testid={`task-timeline-stage-${entry}`}
              data-active={active || undefined}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                active ? "border-primary bg-primary/5 font-semibold" : "border-border/70"
              }`}
            >
              <span className={active ? "" : "text-muted-foreground"}>
                {TASK_WORKSPACE_STAGE_LABELS[entry]}
              </span>
              {active ? (
                <Badge size="sm" variant="secondary">
                  current
                </Badge>
              ) : canStart ? (
                <Button
                  data-testid={`task-start-stage-${entry}`}
                  size="xs"
                  variant="outline"
                  disabled={commands.isBusy}
                  onClick={() =>
                    void commands.dispatch(
                      { ...commands.commandBase("task.stage.start"), stage: entry },
                      `start-stage-${entry}`,
                    )
                  }
                >
                  Start
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Editor for a Guided reasoning stage (Research, Design).
 *
 * Each reasoning stage owns one artifact kind and one completion command, so
 * the two stages differ only by data — the rail they belong to is the
 * definition's business, not this component's.
 */
function ReasoningStageSection({
  task,
  entry,
  commands,
  linkedSessionId,
}: {
  task: TaskWorkspace;
  entry: (typeof REASONING_STAGES)[number];
  commands: ReturnType<typeof useTaskWorkspaceCommands>;
  linkedSessionId: string | null;
}) {
  const artifact = latestArtifact(task, entry.kind);
  const [markdown, setMarkdown] = useState(artifact?.markdown ?? "");

  useEffect(() => {
    if (artifact) setMarkdown(artifact.markdown);
  }, [artifact?.id, artifact?.revision]);

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="font-semibold">{entry.label} artifact</h2>
        <p className="text-sm text-muted-foreground">
          Guided records {entry.label.toLowerCase()} as its own artifact so the next stage can start
          from a selection of its blocks rather than the whole transcript.
        </p>
      </div>
      <Textarea
        data-testid={`task-${entry.kind}-editor`}
        className="min-h-56 font-mono text-xs"
        value={markdown}
        onChange={(event) => setMarkdown(event.currentTarget.value)}
      />
      <div className="flex flex-wrap justify-between gap-2">
        <span className="text-xs text-muted-foreground">Revision {artifact?.revision ?? 0}</span>
        <div className="flex gap-2">
          <Button
            data-testid={`task-save-${entry.kind}`}
            size="sm"
            variant="outline"
            disabled={!markdown.trim() || commands.isBusy}
            onClick={() =>
              void commands.dispatch(
                {
                  ...commands.commandBase("task.artifact.upsert"),
                  kind: entry.kind,
                  title: entry.label,
                  markdown,
                  sourceSessionId: linkedSessionId,
                },
                `save-${entry.kind}`,
              )
            }
          >
            Save revision
          </Button>
          <Button
            data-testid={`task-complete-${entry.kind}`}
            size="sm"
            disabled={!artifact || commands.isBusy}
            onClick={() =>
              void commands.dispatch(
                { ...commands.commandBase(entry.command) },
                `complete-${entry.kind}`,
              )
            }
          >
            Complete {entry.label}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function TaskWorkspaceView({ taskId }: { taskId: string }) {
  return hasCloudPublicConfig() ? (
    <ClerkTaskWorkspaceView taskId={taskId} />
  ) : (
    <TaskWorkspaceViewContent
      taskId={taskId}
      currentUser={{ kind: "user", id: "local-user", displayName: "You" }}
    />
  );
}

function ClerkTaskWorkspaceView({ taskId }: { taskId: string }) {
  const { user } = useClerk();
  const currentUser = useMemo<TaskWorkspaceCommentAuthor>(
    () => ({
      kind: "user",
      id: user?.id ?? "local-user",
      displayName:
        user?.fullName?.trim() || user?.primaryEmailAddress?.emailAddress.trim() || "You",
    }),
    [user],
  );

  return <TaskWorkspaceViewContent taskId={taskId} currentUser={currentUser} />;
}

function TaskWorkspaceViewContent({
  taskId,
  currentUser,
}: {
  taskId: string;
  currentUser: TaskWorkspaceCommentAuthor;
}) {
  const task = useTaskWorkspaceStore((state) => state.taskById[taskId] ?? null);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const [questionsMarkdown, setQuestionsMarkdown] = useState("");
  const [planMarkdown, setPlanMarkdown] = useState(DEFAULT_PLAN);
  const commands = useTaskWorkspaceCommands(taskId);
  const { dispatch, commandBase, pendingAction, isBusy, error } = commands;

  const questionsArtifact = task ? latestArtifact(task, "questions") : null;
  const planArtifact = task ? latestArtifact(task, "plan") : null;
  const verificationArtifact = task ? latestArtifact(task, "verification") : null;
  const stage = task ? currentTaskStage(task) : "questions";
  const repository = task?.workspace.repositories[0] ?? null;
  // Rendered from the task's pinned definition version, so bumping a built-in
  // definition does not reshape a task that was created against the old one.
  const catalogEntry = task
    ? taskWorkspaceCatalogEntryForVersion(task.versions.workflowDefinition)
    : null;
  const railStages = catalogEntry?.stages ?? UNKNOWN_DEFINITION_STAGES;
  const isFreeform = (catalogEntry?.explicitEntryStages.length ?? 0) > 0;
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
              <p
                data-testid="task-workflow-summary"
                className="truncate text-xs text-muted-foreground"
              >
                {catalogEntry?.label ?? "Unknown workflow"} · {task.versions.workflowDefinition} ·
                before-build
              </p>
            </div>
            <Badge variant={stage === "verified" ? "success" : "secondary"}>
              {statusLabel(stage)}
            </Badge>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
          <div className="mx-auto max-w-5xl space-y-5">
            {railStages.length > 0 ? <WorkflowRail stages={railStages} stage={stage} /> : null}

            {isFreeform && catalogEntry ? (
              <WorkflowTimeline catalogEntry={catalogEntry} stage={stage} commands={commands} />
            ) : null}

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

            {REASONING_STAGES.filter((entry) => entry.stage === stage).map((entry) => (
              <ReasoningStageSection
                key={entry.stage}
                task={task}
                entry={entry}
                commands={commands}
                linkedSessionId={linkedSession?.id ?? null}
              />
            ))}

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
            <ContextManifestPanel task={task} />
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
