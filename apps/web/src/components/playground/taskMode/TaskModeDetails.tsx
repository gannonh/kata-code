import { HistoryIcon } from "lucide-react";

import { Badge } from "../../ui/badge";
import type {
  TaskModePrototypeStage,
  TaskModePrototypeStageId,
} from "./taskModePlaygroundFixtures";
import { statusBadgeVariant, statusLabel } from "./taskModePrototypePresentation";
import { VerticalStageRail } from "./TaskModeStageNavigation";

export function TaskModeDetails({
  selectedStage,
  activeStage,
}: {
  readonly selectedStage: TaskModePrototypeStage;
  readonly activeStage: TaskModePrototypeStage;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border bg-background p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Selected stage
            </p>
            <p className="mt-1 text-sm font-semibold">{selectedStage.occurrenceLabel}</p>
          </div>
          <Badge size="sm" variant={statusBadgeVariant(selectedStage.status)}>
            {statusLabel(selectedStage.status)}
          </Badge>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {selectedStage.outcomeSummary}
        </p>
        {selectedStage.occurrences.length > 1 ? (
          <div className="mt-3 border-t border-border pt-3">
            <div className="flex items-center gap-1.5 text-xs font-medium">
              <HistoryIcon className="size-3.5" />
              {selectedStage.occurrences.length} outcomes
            </div>
            <ul className="mt-2 space-y-1.5">
              {selectedStage.occurrences.map((occurrence) => (
                <li key={occurrence.id} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{occurrence.label}</span> ·{" "}
                  {occurrence.summary}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-border bg-background p-3.5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Task
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Prototype a coherent Task-first workspace without giving up fresh context between stages.
        </p>
        <dl className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Current stage</dt>
            <dd className="font-medium">{activeStage.label}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Repository</dt>
            <dd className="font-medium">kata-code</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Base</dt>
            <dd className="font-mono text-[11px]">main</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

export function CurrentLayoutPanel({
  stages,
  activeStage,
  selectedStage,
  onSelectStage,
}: {
  readonly stages: readonly TaskModePrototypeStage[];
  readonly activeStage: TaskModePrototypeStage;
  readonly selectedStage: TaskModePrototypeStage;
  readonly onSelectStage: (stageId: TaskModePrototypeStageId) => void;
}) {
  return (
    <aside
      className="min-h-0 w-full shrink-0 overflow-auto border-t border-border bg-card p-4 lg:w-[22rem] lg:border-l lg:border-t-0"
      data-testid="task-mode-current-layout-panel"
    >
      <div className="space-y-5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Task
          </p>
          <h2 className="mt-1 text-base font-semibold">Refine Task mode UX</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            One Task workspace, with fresh stage context kept inside it.
          </p>
        </div>
        <VerticalStageRail
          stages={stages}
          activeStageId={activeStage.id}
          selectedStageId={selectedStage.id}
          onSelectStage={onSelectStage}
        />
        <TaskModeDetails selectedStage={selectedStage} activeStage={activeStage} />
      </div>
    </aside>
  );
}
