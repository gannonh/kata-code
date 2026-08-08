import { GitBranchIcon } from "lucide-react";

import type { TaskShellRevisionImpact, TaskShellView } from "../../taskWorkspace/taskShellModel";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Textarea } from "../ui/textarea";

/**
 * Explicit revision confirmation.
 *
 * Revision is append-only: it opens a new occurrence and leaves every existing
 * outcome inspectable. The dialog states the branch point, what must settle,
 * and what is preserved before anything is dispatched, so a revision is never a
 * silent reopen of settled work.
 */
export function TaskReviseDialog({
  isOpen,
  view,
  impact,
  feedback,
  isBusy,
  error,
  onFeedbackChange,
  onOpenChange,
  onConfirm,
}: {
  readonly isOpen: boolean;
  readonly view: TaskShellView;
  readonly impact: TaskShellRevisionImpact;
  readonly feedback: string;
  readonly isBusy: boolean;
  readonly error: string | null;
  readonly onFeedbackChange: (feedback: string) => void;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onConfirm: () => void;
}) {
  const branchPoint = view.selectedOccurrence?.label ?? view.selectedStage.label;
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogPopup data-testid="task-revise-dialog">
        <DialogHeader>
          <DialogTitle>Revise from {branchPoint}?</DialogTitle>
          <DialogDescription>
            This starts {impact.nextOccurrenceLabel} as the only active path. Existing outcomes stay
            inspectable.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/25 p-3 text-sm">
            <p className="font-medium">Branch point</p>
            <p data-testid="task-revise-branch-point" className="mt-1 text-muted-foreground">
              {branchPoint}
              {view.outcome ? ` — ${view.outcome.title}` : ""}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Current work</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {view.activeStage.label} stops at this occurrence before {impact.nextOccurrenceLabel}{" "}
              starts.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Preserved as history</p>
            <p data-testid="task-revise-preserved" className="mt-1 text-sm text-muted-foreground">
              {impact.preservedStageLabels.length > 0
                ? `${branchPoint} and every ${impact.preservedStageLabels.join(", ")} outcome remain inspectable.`
                : `${branchPoint} remains inspectable. No downstream outcomes yet.`}
            </p>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="task-revise-feedback">
              What should change?
            </label>
            <Textarea
              id="task-revise-feedback"
              data-testid="task-revise-feedback"
              className="mt-2 min-h-20 text-sm"
              value={feedback}
              placeholder={`Tell the ${view.activeStage.label} conversation what to do differently.`}
              onChange={(event) => onFeedbackChange(event.currentTarget.value)}
            />
          </div>
          {error ? (
            <p
              role="alert"
              data-testid="task-revise-error"
              className="rounded-md border border-destructive/35 bg-destructive/8 p-3 text-xs text-destructive"
            >
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep current path
          </Button>
          <Button
            data-testid="task-revise-confirm"
            disabled={isBusy || !feedback.trim()}
            title={!feedback.trim() ? "Describe what should change first." : undefined}
            onClick={onConfirm}
          >
            <GitBranchIcon className="size-4" />
            Start {impact.nextOccurrenceLabel}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
