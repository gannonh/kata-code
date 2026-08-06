import type { TaskWorkspaceStage } from "@kata-sh/code-contracts";
import { CheckCircle2Icon, CircleIcon, Loader2Icon } from "lucide-react";

import type { TaskShellStage } from "../../taskWorkspace/taskShellModel";
import { Badge } from "../ui/badge";

function StageIcon({ status }: { readonly status: TaskShellStage["status"] }) {
  if (status === "completed") {
    return <CheckCircle2Icon className="size-4 shrink-0 text-success-foreground" />;
  }
  if (status === "active") return <Loader2Icon className="size-4 shrink-0 text-primary" />;
  return <CircleIcon className="size-4 shrink-0 text-muted-foreground/50" />;
}

/**
 * Vertical stage navigation for the Task panel.
 *
 * Selecting a stage only changes what the user is looking at. The rail shows
 * both facts at once: which stage the workflow is in (`data-active`) and which
 * one is being viewed (`data-selected`).
 */
export function TaskStageRail({
  stages,
  selectedStage,
  needsUpgradeStage,
  onSelectStage,
}: {
  readonly stages: ReadonlyArray<TaskShellStage>;
  readonly selectedStage: TaskWorkspaceStage;
  /** Stage that is gated behind a workflow-definition upgrade, if any. */
  readonly needsUpgradeStage?: TaskWorkspaceStage | null;
  readonly onSelectStage: (stage: TaskWorkspaceStage) => void;
}) {
  // A deferred stage the task has not reached yet is not navigation; it is a
  // promise this build cannot keep.
  const visible = stages.filter((stage) => stage.isAvailable || stage.status !== "upcoming");
  if (visible.length === 0) return null;

  return (
    <nav aria-label="Task stages" data-testid="guided-stage-rail">
      <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Workflow
      </p>
      <ol className="grid gap-0.5">
        {visible.map((stage) => {
          const isSelected = stage.stage === selectedStage;
          return (
            <li key={stage.stage}>
              <button
                type="button"
                data-testid={`guided-stage-${stage.stage}`}
                data-active={stage.status === "active" || undefined}
                data-selected={isSelected || undefined}
                aria-current={stage.status === "active" ? "step" : undefined}
                aria-pressed={isSelected}
                disabled={!stage.isSelectable}
                onClick={() => onSelectStage(stage.stage)}
                className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors ${
                  isSelected
                    ? "border-border/60 bg-accent font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                } disabled:cursor-default disabled:opacity-55 disabled:hover:bg-transparent`}
              >
                <StageIcon status={stage.status} />
                <span className="min-w-0 flex-1 truncate">{stage.label}</span>
                {stage.stage === needsUpgradeStage ? (
                  <Badge size="sm" variant="outline">
                    upgrade
                  </Badge>
                ) : stage.status === "active" ? (
                  <Badge size="sm" variant="secondary">
                    current
                  </Badge>
                ) : stage.occurrences.length > 1 ? (
                  <Badge
                    size="sm"
                    variant="outline"
                    data-testid={`guided-stage-occurrence-count-${stage.stage}`}
                  >
                    {stage.occurrences.length}
                  </Badge>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
