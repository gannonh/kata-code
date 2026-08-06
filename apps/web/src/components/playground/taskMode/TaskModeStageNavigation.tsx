import { Badge } from "../../ui/badge";
import type {
  TaskModePrototypeStage,
  TaskModePrototypeStageId,
} from "./taskModePlaygroundFixtures";
import { StageStatusIcon, statusBadgeVariant, statusLabel } from "./taskModePrototypePresentation";

function StageButton({
  stage,
  isActive,
  isSelected,
  orientation,
  onSelect,
}: {
  readonly stage: TaskModePrototypeStage;
  readonly isActive: boolean;
  readonly isSelected: boolean;
  readonly orientation: "horizontal" | "vertical";
  readonly onSelect: () => void;
}) {
  const isAvailable = stage.status !== "upcoming";
  return (
    <button
      type="button"
      aria-current={isActive ? "step" : undefined}
      data-testid={`task-mode-stage-${stage.id}`}
      data-active={isActive || undefined}
      data-selected={isSelected || undefined}
      disabled={!isAvailable}
      onClick={onSelect}
      className={
        orientation === "vertical"
          ? `flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
              isSelected
                ? "border-foreground/20 bg-accent text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            } disabled:cursor-default disabled:opacity-55`
          : `relative flex min-w-28 flex-1 items-center gap-2 border-r border-border px-3 py-3 text-left transition-colors last:border-r-0 ${
              isSelected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/55"
            } disabled:cursor-default disabled:opacity-55`
      }
    >
      <StageStatusIcon status={stage.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{stage.label}</span>
        {orientation === "horizontal" ? (
          <span className="block truncate text-[10px] text-muted-foreground">
            {isActive ? statusLabel(stage.status) : stage.occurrenceLabel}
          </span>
        ) : null}
      </span>
      {isActive && orientation === "vertical" ? (
        <Badge size="sm" variant={statusBadgeVariant(stage.status)}>
          current
        </Badge>
      ) : stage.occurrences.length > 1 && orientation === "vertical" ? (
        <Badge size="sm" variant="outline">
          {stage.occurrences.length}
        </Badge>
      ) : null}
      {isSelected && orientation === "horizontal" ? (
        <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />
      ) : null}
    </button>
  );
}

export function VerticalStageRail({
  stages,
  activeStageId,
  selectedStageId,
  onSelectStage,
}: {
  readonly stages: readonly TaskModePrototypeStage[];
  readonly activeStageId: TaskModePrototypeStageId;
  readonly selectedStageId: TaskModePrototypeStageId;
  readonly onSelectStage: (stageId: TaskModePrototypeStageId) => void;
}) {
  return (
    <section className="space-y-2" data-testid="task-mode-vertical-stage-rail">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Workflow
        </h2>
        <span className="text-[10px] text-muted-foreground">Guided</span>
      </div>
      <ol className="space-y-0.5">
        {stages.map((stage) => (
          <li key={stage.id}>
            <StageButton
              stage={stage}
              isActive={stage.id === activeStageId}
              isSelected={stage.id === selectedStageId}
              orientation="vertical"
              onSelect={() => onSelectStage(stage.id)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function HorizontalStageRail({
  stages,
  activeStageId,
  selectedStageId,
  onSelectStage,
}: {
  readonly stages: readonly TaskModePrototypeStage[];
  readonly activeStageId: TaskModePrototypeStageId;
  readonly selectedStageId: TaskModePrototypeStageId;
  readonly onSelectStage: (stageId: TaskModePrototypeStageId) => void;
}) {
  return (
    <div
      className="overflow-x-auto border-b border-border bg-card"
      data-testid="task-mode-horizontal-stage-rail"
    >
      <ol className="flex min-w-max xl:min-w-0">
        {stages.map((stage) => (
          <li key={stage.id} className="flex min-w-28 flex-1">
            <StageButton
              stage={stage}
              isActive={stage.id === activeStageId}
              isSelected={stage.id === selectedStageId}
              orientation="horizontal"
              onSelect={() => onSelectStage(stage.id)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
