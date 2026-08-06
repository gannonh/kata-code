import { ArrowLeftIcon, ChevronDownIcon, GitBranchIcon, HistoryIcon } from "lucide-react";
import type { ReactNode } from "react";

import type {
  TaskShellContentView,
  TaskShellOccurrence,
  TaskShellView,
} from "../../taskWorkspace/taskShellModel";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

function occurrenceStatusVariant(
  status: TaskShellOccurrence["status"],
): "success" | "error" | "warning" | "secondary" | "outline" {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "blocked":
    case "awaiting-approval":
      return "warning";
    case "running":
    case "finalizing":
      return "secondary";
    default:
      return "outline";
  }
}

function HistoricalBanner({
  view,
  onReturnToCurrent,
}: {
  readonly view: TaskShellView;
  readonly onReturnToCurrent: () => void;
}) {
  return (
    <div
      data-testid="task-stage-historical-banner"
      className="flex flex-wrap items-center gap-2 border-b border-info/25 bg-info/8 px-4 py-2.5 text-xs"
    >
      <HistoryIcon className="size-4 shrink-0 text-info-foreground" />
      <span className="font-medium">
        Viewing {view.selectedOccurrence?.label ?? view.selectedStage.label}
      </span>
      <span className="text-muted-foreground">
        This is read-only history. {view.activeStage.label} is the current stage.
      </span>
      <Button
        className="ml-auto"
        data-testid="task-stage-return-to-current"
        size="xs"
        variant="outline"
        onClick={onReturnToCurrent}
      >
        <ArrowLeftIcon className="size-3.5" />
        Return to current
      </Button>
    </div>
  );
}

function OutcomeView({ view }: { readonly view: TaskShellView }) {
  const outcome = view.outcome;
  return (
    <div
      data-testid="task-stage-outcome-view"
      className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-8"
    >
      <article className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {view.selectedStage.label} outcome
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">
              {outcome?.title ?? `${view.selectedStage.label} has no recorded outcome`}
            </h2>
          </div>
          {view.selectedOccurrence ? (
            <Badge size="sm" variant={occurrenceStatusVariant(view.selectedOccurrence.status)}>
              {view.selectedOccurrence.label}
            </Badge>
          ) : null}
        </div>
        {outcome ? (
          <pre className="mt-5 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
            {outcome.markdown}
          </pre>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            This occurrence did not publish an artifact. Open the conversation to inspect what
            happened.
          </p>
        )}
      </article>
    </div>
  );
}

/**
 * The primary Task canvas: one stage occurrence, as a conversation or as its
 * recorded outcome.
 *
 * Completed work opens on its outcome and stays read-only. Nothing in this
 * component moves the workflow; the only mutating affordance it offers is the
 * explicit revision hand-off, which the shell confirms before dispatching.
 */
export function TaskStageCanvas({
  view,
  contentView,
  revisionLabel,
  conversation,
  onSetContentView,
  onSelectOccurrence,
  onReturnToCurrent,
  onRevise,
}: {
  readonly view: TaskShellView;
  readonly contentView: TaskShellContentView;
  /** Label for the revision action, or `null` when revision is unavailable. */
  readonly revisionLabel: string | null;
  readonly conversation: ReactNode;
  readonly onSetContentView: (contentView: TaskShellContentView) => void;
  readonly onSelectOccurrence: (occurrenceId: string) => void;
  readonly onReturnToCurrent: () => void;
  readonly onRevise: () => void;
}) {
  const occurrences = view.selectedStage.occurrences;
  return (
    <section
      data-testid="task-stage-canvas"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-background"
    >
      {view.isReadOnly ? (
        <HistoricalBanner view={view} onReturnToCurrent={onReturnToCurrent} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 data-testid="task-stage-title" className="truncate text-sm font-semibold">
              {view.selectedStage.label}
            </h2>
            {view.selectedOccurrence ? (
              <Badge size="sm" variant={occurrenceStatusVariant(view.selectedOccurrence.status)}>
                {view.selectedOccurrence.status}
              </Badge>
            ) : null}
          </div>
          <p data-testid="task-stage-subtitle" className="mt-0.5 text-[11px] text-muted-foreground">
            {view.selectedOccurrence?.label ?? view.selectedStage.label} ·{" "}
            {view.isViewingCurrent ? "current stage" : "read-only history"}
          </p>
        </div>

        {occurrences.length > 1 ? (
          <label className="relative">
            <span className="sr-only">Stage occurrence</span>
            <select
              data-testid="task-stage-occurrence-select"
              className="h-8 appearance-none rounded-lg border border-input bg-background py-1 pl-2.5 pr-8 text-xs"
              value={view.selectedOccurrence?.id ?? ""}
              onChange={(event) => onSelectOccurrence(event.currentTarget.value)}
            >
              {occurrences.map((occurrence) => (
                <option key={occurrence.id} value={occurrence.id}>
                  {occurrence.label}
                  {occurrence.isCurrent ? " · current" : ""}
                </option>
              ))}
            </select>
            <ChevronDownIcon className="pointer-events-none absolute right-2 top-2 size-4 text-muted-foreground" />
          </label>
        ) : null}

        <div
          className="flex rounded-lg border border-border bg-muted/30 p-0.5"
          role="group"
          aria-label="Stage view"
        >
          {(["conversation", "outcome"] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={contentView === candidate}
              data-testid={`task-stage-view-${candidate}`}
              data-active={contentView === candidate || undefined}
              className={`rounded-md px-2.5 py-1 text-xs capitalize ${
                contentView === candidate
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground"
              }`}
              onClick={() => onSetContentView(candidate)}
            >
              {candidate}
            </button>
          ))}
        </div>

        {revisionLabel ? (
          <Button
            data-testid="task-stage-revise"
            size="xs"
            variant="outline"
            onClick={onRevise}
            title={revisionLabel}
          >
            <GitBranchIcon className="size-3.5" />
            Revise from here
          </Button>
        ) : null}
      </div>

      {contentView === "conversation" ? conversation : <OutcomeView view={view} />}
    </section>
  );
}
