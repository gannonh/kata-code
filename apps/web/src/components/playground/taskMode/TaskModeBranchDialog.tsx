import { GitBranchIcon } from "lucide-react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import type { TaskModePrototypeStage } from "./taskModePlaygroundFixtures";
import { nextOccurrenceLabel } from "./taskModePlaygroundFixtures";

export function TaskModeBranchDialog({
  isOpen,
  selectedStage,
  activeStage,
  affectedStages,
  onOpenChange,
  onConfirm,
}: {
  readonly isOpen: boolean;
  readonly selectedStage: TaskModePrototypeStage;
  readonly activeStage: TaskModePrototypeStage;
  readonly affectedStages: readonly TaskModePrototypeStage[];
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogPopup data-testid="task-mode-branch-dialog">
        <DialogHeader>
          <DialogTitle>Revise from {selectedStage.occurrenceLabel}?</DialogTitle>
          <DialogDescription>
            This starts {nextOccurrenceLabel(selectedStage)} as the single active path. Existing
            work remains inspectable.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="rounded-xl border border-border bg-muted/25 p-3 text-sm">
            <p className="font-medium">Branch point</p>
            <p className="mt-1 text-muted-foreground">{selectedStage.outcomeTitle}</p>
          </div>
          <div>
            <p className="text-sm font-medium">Current work</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeStage.label} must settle or stop before the new occurrence starts.
            </p>
          </div>
          <div>
            <p className="text-sm font-medium">Preserved as history</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {affectedStages.length > 0
                ? affectedStages.map((stage) => stage.occurrenceLabel).join(", ")
                : "No downstream outcomes yet."}
            </p>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep current path
          </Button>
          <Button data-testid="task-mode-confirm-branch" onClick={onConfirm}>
            <GitBranchIcon className="size-4" />
            Stop and create branch
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
