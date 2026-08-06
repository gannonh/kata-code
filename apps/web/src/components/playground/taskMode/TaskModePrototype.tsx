import {
  ClipboardListIcon,
  GitBranchIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { Sheet, SheetDescription, SheetPopup, SheetTitle } from "../../ui/sheet";
import { TaskModeBranchDialog } from "./TaskModeBranchDialog";
import { CurrentLayoutPanel, TaskModeDetails } from "./TaskModeDetails";
import type {
  TaskModePrototypeOccurrence,
  TaskModePrototypeScenario,
  TaskModePrototypeStage,
  TaskModePrototypeStageId,
  TaskModePrototypeStageStatus,
} from "./taskModePlaygroundFixtures";
import {
  TASK_MODE_PROTOTYPE_STAGES,
  nextOccurrenceLabel,
  nextOccurrenceVersion,
} from "./taskModePlaygroundFixtures";
import { TaskModePrototypeSidebar } from "./TaskModePrototypeSidebar";
import { TaskModeStageCanvas, type TaskModeStageView } from "./TaskModeStageCanvas";
import { HorizontalStageRail } from "./TaskModeStageNavigation";

export type TaskModePrototypeLayout = "current-refined" | "horizontal-stages";

function taskStatusVariant(
  taskStatus: TaskModePrototypeScenario["taskStatus"],
): "info" | "warning" | "error" {
  switch (taskStatus) {
    case "working":
      return "info";
    case "waiting":
      return "warning";
    case "blocked":
      return "error";
  }
}

function branchedStageStatus(
  stageIndex: number,
  branchIndex: number,
  previousStatus: TaskModePrototypeStageStatus,
): TaskModePrototypeStageStatus {
  if (stageIndex < branchIndex) return "completed";
  if (stageIndex === branchIndex) return "running";
  return previousStatus === "upcoming" ? "upcoming" : "historical";
}

function requireStage(
  stages: readonly TaskModePrototypeStage[],
  stageId: TaskModePrototypeStageId,
): TaskModePrototypeStage {
  const stage = stages.find((candidate) => candidate.id === stageId);
  if (!stage) throw new Error(`Task mode prototype stage '${stageId}' is missing.`);
  return stage;
}

function defaultOccurrence(stage: TaskModePrototypeStage): TaskModePrototypeOccurrence {
  const occurrence =
    stage.occurrences.find((candidate) => candidate.isCurrent) ?? stage.occurrences[0];
  if (!occurrence) {
    throw new Error(`Task mode prototype stage '${stage.id}' has no occurrence.`);
  }
  return occurrence;
}

function TaskHeader({
  activeStage,
  taskStatus,
  isInspectorOpen,
  canToggleInspector,
  onOpenNavigation,
  onToggleInspector,
}: {
  readonly activeStage: TaskModePrototypeStage;
  readonly taskStatus: TaskModePrototypeScenario["taskStatus"];
  readonly isInspectorOpen: boolean;
  readonly canToggleInspector: boolean;
  readonly onOpenNavigation: () => void;
  readonly onToggleInspector: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-5">
      <Button
        className="md:hidden"
        data-testid="task-mode-mobile-navigation-trigger"
        size="icon"
        variant="ghost"
        aria-label="Open navigation"
        onClick={onOpenNavigation}
      >
        <ClipboardListIcon className="size-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold">Refine Task mode UX</h1>
          <Badge size="sm" variant="outline">
            Guided
          </Badge>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <GitBranchIcon className="size-3" />
          <span>task/refine-task-mode-ux</span>
          <span>·</span>
          <span>{activeStage.label}</span>
        </div>
      </div>
      <Badge className="hidden sm:inline-flex" size="sm" variant={taskStatusVariant(taskStatus)}>
        {taskStatus}
      </Badge>
      {canToggleInspector ? (
        <Button
          className="hidden lg:inline-flex"
          data-testid="task-mode-inspector-toggle"
          size="icon"
          variant="ghost"
          aria-expanded={isInspectorOpen}
          aria-label={isInspectorOpen ? "Close details" : "Open details"}
          onClick={onToggleInspector}
        >
          {isInspectorOpen ? (
            <PanelRightCloseIcon className="size-4" />
          ) : (
            <PanelRightOpenIcon className="size-4" />
          )}
        </Button>
      ) : null}
    </header>
  );
}

function withBranch(
  stages: readonly TaskModePrototypeStage[],
  branchStageId: TaskModePrototypeStageId | null,
): readonly TaskModePrototypeStage[] {
  if (branchStageId === null) return stages;
  const branchIndex = TASK_MODE_PROTOTYPE_STAGES.indexOf(branchStageId);
  return stages.map((stage) => {
    const stageIndex = TASK_MODE_PROTOTYPE_STAGES.indexOf(stage.id);
    const status = branchedStageStatus(stageIndex, branchIndex, stage.status);
    if (stage.id !== branchStageId) return { ...stage, status };
    const nextVersion = nextOccurrenceVersion(stage);
    const branchOccurrence: TaskModePrototypeOccurrence = {
      id: `${stage.id}-v${nextVersion}`,
      label: nextOccurrenceLabel(stage),
      createdAt: "New active path",
      summary: `Revising ${stage.outcomeTitle.toLowerCase()} from the selected outcome.`,
      isCurrent: true,
    };
    return {
      ...stage,
      status,
      occurrenceLabel: branchOccurrence.label,
      occurrences: [
        ...stage.occurrences.map((occurrence) => ({ ...occurrence, isCurrent: false })),
        branchOccurrence,
      ],
    };
  });
}

export function TaskModePrototype({
  scenario,
  layout,
}: {
  readonly scenario: TaskModePrototypeScenario;
  readonly layout: TaskModePrototypeLayout;
}) {
  const [selectedStageId, setSelectedStageId] = useState(scenario.initialSelectedStageId);
  const [selectedOccurrenceId, setSelectedOccurrenceId] = useState("");
  const [view, setView] = useState<TaskModeStageView>(
    scenario.initialSelectedStageId === scenario.activeStageId ? "conversation" : "outcome",
  );
  const [isInspectorOpen, setIsInspectorOpen] = useState(true);
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [isBranchDialogOpen, setIsBranchDialogOpen] = useState(false);
  const [branchStageId, setBranchStageId] = useState<TaskModePrototypeStageId | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const stages = useMemo(
    () => withBranch(scenario.stages, branchStageId),
    [branchStageId, scenario.stages],
  );
  const activeStageId = branchStageId ?? scenario.activeStageId;
  const activeStage = requireStage(stages, activeStageId);
  const selectedStage = stages.find((stage) => stage.id === selectedStageId) ?? activeStage;
  const selectedOccurrence =
    selectedStage.occurrences.find((occurrence) => occurrence.id === selectedOccurrenceId) ??
    defaultOccurrence(selectedStage);
  const effectiveOccurrenceId = selectedOccurrence.id;
  const viewedStage = selectedOccurrence.isCurrent
    ? selectedStage
    : {
        ...selectedStage,
        status: "historical" as const,
        occurrenceLabel: selectedOccurrence.label,
        outcomeSummary: selectedOccurrence.summary,
      };
  const activeOccurrence = defaultOccurrence(activeStage);
  const isViewingActiveOccurrence =
    selectedStage.id === activeStage.id && selectedOccurrence.id === activeOccurrence.id;
  const selectedIndex = TASK_MODE_PROTOTYPE_STAGES.indexOf(selectedStage.id);
  const activeIndex = TASK_MODE_PROTOTYPE_STAGES.indexOf(activeStage.id);
  const affectedStages = stages.filter((stage) => {
    const stageIndex = TASK_MODE_PROTOTYPE_STAGES.indexOf(stage.id);
    return stageIndex > selectedIndex && stageIndex <= activeIndex && stage.status !== "upcoming";
  });

  const selectStage = (stageId: TaskModePrototypeStageId) => {
    const stage = stages.find((candidate) => candidate.id === stageId);
    if (!stage || stage.status === "upcoming") return;
    setSelectedStageId(stageId);
    setSelectedOccurrenceId("");
    setView(stageId === activeStage.id ? "conversation" : "outcome");
    setActionFeedback(null);
  };

  const selectOccurrence = (occurrenceId: string) => {
    const occurrence = selectedStage.occurrences.find((candidate) => candidate.id === occurrenceId);
    if (!occurrence) return;
    setSelectedOccurrenceId(occurrenceId);
    setView(
      occurrence.isCurrent && selectedStage.id === activeStage.id ? "conversation" : "outcome",
    );
    setActionFeedback(null);
  };

  const confirmBranch = () => {
    setBranchStageId(selectedStage.id);
    setSelectedOccurrenceId("");
    setView("conversation");
    setActionFeedback(
      `New ${selectedStage.label} occurrence created. The previous path remains in History.`,
    );
    setIsBranchDialogOpen(false);
  };

  const taskStatus = branchStageId ? "working" : scenario.taskStatus;
  const stageCanvas = (
    <TaskModeStageCanvas
      scenario={scenario}
      selectedStage={viewedStage}
      activeStage={activeStage}
      isViewingActiveOccurrence={isViewingActiveOccurrence}
      selectedOccurrenceId={effectiveOccurrenceId}
      view={view}
      actionFeedback={actionFeedback}
      onSelectOccurrence={selectOccurrence}
      onSetView={setView}
      onReturnToCurrent={() => selectStage(activeStage.id)}
      onOpenBranch={() => setIsBranchDialogOpen(true)}
      onAction={setActionFeedback}
    />
  );

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 overflow-hidden"
      data-testid={`task-mode-layout-${layout}`}
    >
      <TaskModePrototypeSidebar activeStage={activeStage} taskStatus={taskStatus} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TaskHeader
          activeStage={activeStage}
          taskStatus={taskStatus}
          isInspectorOpen={isInspectorOpen}
          canToggleInspector={layout === "horizontal-stages"}
          onOpenNavigation={() => setIsMobileNavigationOpen(true)}
          onToggleInspector={() => setIsInspectorOpen((current) => !current)}
        />
        {layout === "horizontal-stages" ? (
          <HorizontalStageRail
            stages={stages}
            activeStageId={activeStage.id}
            selectedStageId={selectedStage.id}
            onSelectStage={selectStage}
          />
        ) : null}
        {layout === "current-refined" ? (
          <div
            data-testid="task-mode-layout-content"
            className="min-h-0 flex-1 overflow-auto lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden"
          >
            <div className="flex min-h-[34rem] min-w-0 lg:min-h-0">{stageCanvas}</div>
            <CurrentLayoutPanel
              stages={stages}
              activeStage={activeStage}
              selectedStage={viewedStage}
              onSelectStage={selectStage}
            />
          </div>
        ) : (
          <div data-testid="task-mode-layout-content" className="flex min-h-0 flex-1">
            {stageCanvas}
            {isInspectorOpen ? (
              <aside
                data-testid="task-mode-horizontal-inspector"
                className="hidden min-h-0 w-80 shrink-0 overflow-auto border-l border-border bg-card p-4 lg:block"
              >
                <TaskModeDetails selectedStage={viewedStage} activeStage={activeStage} />
              </aside>
            ) : null}
          </div>
        )}
      </div>
      <TaskModeBranchDialog
        isOpen={isBranchDialogOpen}
        selectedStage={viewedStage}
        activeStage={activeStage}
        affectedStages={affectedStages}
        onOpenChange={setIsBranchDialogOpen}
        onConfirm={confirmBranch}
      />
      <Sheet open={isMobileNavigationOpen} onOpenChange={setIsMobileNavigationOpen}>
        <SheetPopup className="p-0 md:hidden" data-testid="task-mode-mobile-navigation" side="left">
          <SheetTitle className="sr-only">Task navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Tasks and regular conversations in this environment.
          </SheetDescription>
          <TaskModePrototypeSidebar
            activeStage={activeStage}
            taskStatus={taskStatus}
            variant="mobile"
          />
        </SheetPopup>
      </Sheet>
    </div>
  );
}
