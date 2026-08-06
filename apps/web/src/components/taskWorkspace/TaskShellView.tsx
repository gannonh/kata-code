import type {
  TaskWorkspace,
  TaskWorkspaceCommentAuthor,
  TaskWorkspaceStage,
} from "@kata-sh/code-contracts";
import { taskWorkspaceCatalogEntryForVersion } from "@kata-sh/code-shared/taskWorkspacePresets";
import { PanelRightIcon } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";

import {
  resolveTaskShellView,
  taskShellRevisionImpact,
  type TaskShellContentView,
  type TaskShellSelection,
} from "../../taskWorkspace/taskShellModel";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { useStore } from "../../store";
import { createThreadSelectorByRef } from "../../storeSelectors";
import type { TaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Sheet, SheetDescription, SheetPopup, SheetTitle } from "../ui/sheet";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { GuidedTaskPanel } from "./GuidedTaskPanel";
import { TaskReviseDialog } from "./TaskReviseDialog";
import { TaskStageCanvas } from "./TaskStageCanvas";
import { TaskStageRail } from "./TaskStageRail";

const TaskChatView = lazy(() => import("../ChatView"));

function operationKey(commandId: string, action: string): string {
  return `task-${action}-${commandId}`;
}

/**
 * The production Task shell: one conversation canvas, one persistent panel.
 *
 * The Task is the navigation unit. Stage conversations stay inside this route,
 * the active stage conversation owns the canvas, and the panel owns progress,
 * stage navigation, outcomes, history, and human actions. Selecting a stage
 * changes only what is displayed; every workflow transition still goes through
 * a server command.
 */
export function TaskShellView({
  task,
  commands,
  currentUser,
}: {
  readonly task: TaskWorkspace;
  readonly commands: TaskWorkspaceCommands;
  readonly currentUser: TaskWorkspaceCommentAuthor;
}) {
  const [selection, setSelection] = useState<TaskShellSelection | null>(null);
  const [contentView, setContentView] = useState<TaskShellContentView | null>(null);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isReviseOpen, setIsReviseOpen] = useState(false);
  const [reviseFeedback, setReviseFeedback] = useState("");
  // The panel is docked beside the conversation at desktop widths and moves
  // behind a header trigger below them. It is mounted once either way, so the
  // panel never exists twice in the accessibility tree.
  const isPanelDocked = useMediaQuery("lg");

  const view = useMemo(() => resolveTaskShellView(task, selection), [task, selection]);
  const impact = useMemo(
    () => taskShellRevisionImpact(task, view.selectedStage.stage),
    [task, view.selectedStage.stage],
  );
  const catalogEntry = taskWorkspaceCatalogEntryForVersion(task.versions.workflowDefinition);
  const effectiveContentView = contentView ?? view.defaultView;

  // A stage can be linked to a thread before that thread has reached this
  // client. Rendering a conversation for a thread the store has never seen
  // would show an empty transcript as if it were the stage's real content.
  const threadRef = useMemo(
    () =>
      task.environmentId && view.conversationThreadId
        ? { environmentId: task.environmentId, threadId: view.conversationThreadId }
        : null,
    [task.environmentId, view.conversationThreadId],
  );
  const thread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const hasConversation = threadRef !== null && thread !== undefined && "id" in thread;

  // Revision is only offered where an existing workflow command can honor it:
  // the open Plan gate. Rendering it anywhere else would be an inert control.
  const canRevise =
    view.isViewingCurrent &&
    view.selectedStage.stage === "plan" &&
    task.planGate?.status === "open";

  const selectStage = (stage: TaskWorkspaceStage) => {
    setSelection({ stage, occurrenceId: null });
    setContentView(null);
    setIsPanelOpen(false);
  };

  const selectOccurrence = (occurrenceId: string) => {
    setSelection({ stage: view.selectedStage.stage, occurrenceId });
    setContentView(null);
  };

  const returnToCurrent = () => {
    setSelection(null);
    setContentView(null);
  };

  const confirmRevise = async () => {
    const feedback = reviseFeedback.trim();
    if (!feedback) return;
    const base = commands.commandBase("task.stage.request-changes");
    const accepted = await commands.dispatch(
      {
        ...base,
        expectedTaskRevision: task.taskRevision,
        operationKey: operationKey(base.commandId, "revise-from-here"),
        feedback,
      },
      "revise-from-here",
    );
    // A rejected revision keeps the dialog and the feedback, so the failure is
    // reported next to the action that produced it and can be retried.
    if (!accepted) return;
    setIsReviseOpen(false);
    setReviseFeedback("");
    returnToCurrent();
  };

  const panel = (
    <GuidedTaskPanel
      task={task}
      commands={commands}
      currentUser={currentUser}
      stageRail={
        <TaskStageRail
          stages={view.stages}
          selectedStage={view.selectedStage.stage}
          needsUpgradeStage={task.versions.workflowDefinition === "guided@0.2.0" ? "build" : null}
          onSelectStage={selectStage}
        />
      }
      isViewingCurrent={view.isViewingCurrent}
      onReturnToCurrent={returnToCurrent}
    />
  );

  const conversation =
    hasConversation && threadRef ? (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading conversation…
          </div>
        }
      >
        <TaskChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          routeKind="server"
          reserveTitleBarControlInset={false}
          readOnly={view.isReadOnly}
          readOnlyNotice={`${view.selectedOccurrence?.label ?? view.selectedStage.label} is read-only history.`}
        />
      </Suspense>
    ) : (
      <div
        data-testid="task-conversation-starting"
        className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
      >
        {view.isViewingCurrent
          ? `Preparing the ${view.selectedStage.label} conversation…`
          : `${view.selectedOccurrence?.label ?? view.selectedStage.label} kept no conversation.`}
      </div>
    );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-3 py-2 sm:px-5 sm:py-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <div className="min-w-0 flex-1">
          <p data-testid="task-shell-title" className="truncate text-sm font-semibold">
            {task.title}
          </p>
          <p data-testid="task-shell-subtitle" className="truncate text-xs text-muted-foreground">
            {catalogEntry?.label ?? "Task"} · {view.activeStage.label}
          </p>
        </div>
        <Badge className="hidden sm:inline-flex" size="sm" variant="secondary">
          {view.activeStage.label}
        </Badge>
        <Button
          className="lg:hidden"
          data-testid="task-shell-panel-trigger"
          size="icon"
          variant="ghost"
          aria-label="Open task panel"
          aria-expanded={isPanelOpen}
          onClick={() => setIsPanelOpen(true)}
        >
          <PanelRightIcon className="size-4" />
        </Button>
      </header>

      <main className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <TaskStageCanvas
          view={view}
          contentView={effectiveContentView}
          revisionLabel={canRevise ? `Start ${impact.nextOccurrenceLabel}` : null}
          conversation={conversation}
          onSetContentView={setContentView}
          onSelectOccurrence={selectOccurrence}
          onReturnToCurrent={returnToCurrent}
          onRevise={() => setIsReviseOpen(true)}
        />
        {isPanelDocked ? (
          <aside
            data-testid="task-shell-panel"
            className="min-h-0 min-w-0 overflow-auto border-l border-border bg-card"
          >
            {panel}
          </aside>
        ) : null}
      </main>

      <Sheet open={isPanelOpen && !isPanelDocked} onOpenChange={setIsPanelOpen}>
        <SheetPopup className="w-[22rem] p-0" data-testid="task-shell-panel-sheet">
          <SheetTitle className="sr-only">Task panel</SheetTitle>
          <SheetDescription className="sr-only">
            Task progress, stages, outcomes, and actions.
          </SheetDescription>
          <div className="min-h-0 overflow-auto">{isPanelDocked ? null : panel}</div>
        </SheetPopup>
      </Sheet>

      <TaskReviseDialog
        isOpen={isReviseOpen}
        view={view}
        impact={impact}
        feedback={reviseFeedback}
        isBusy={commands.isBusy}
        error={commands.error}
        onFeedbackChange={setReviseFeedback}
        onOpenChange={setIsReviseOpen}
        onConfirm={() => void confirmRevise()}
      />
    </SidebarInset>
  );
}
