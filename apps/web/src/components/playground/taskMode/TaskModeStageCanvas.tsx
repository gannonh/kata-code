import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  GitBranchIcon,
  HistoryIcon,
  Loader2Icon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  SparklesIcon,
} from "lucide-react";

import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import type {
  TaskModePrototypeScenario,
  TaskModePrototypeStage,
} from "./taskModePlaygroundFixtures";
import { statusBadgeVariant, statusLabel } from "./taskModePrototypePresentation";

export type TaskModeStageView = "conversation" | "outcome";

function composerPlaceholder(stage: TaskModePrototypeStage, canCompose: boolean): string {
  if (canCompose) return `Message the ${stage.label} stage…`;
  if (stage.status === "completed" || stage.status === "historical") {
    return "Completed stages are read-only";
  }
  return "This stage is waiting for an action";
}

function HistoricalStageBanner({
  selectedStage,
  activeStage,
  onReturn,
}: {
  readonly selectedStage: TaskModePrototypeStage;
  readonly activeStage: TaskModePrototypeStage;
  readonly onReturn: () => void;
}) {
  return (
    <div
      data-testid="task-mode-historical-banner"
      className="flex flex-wrap items-center gap-2 border-b border-info/25 bg-info/8 px-4 py-2.5 text-xs"
    >
      <HistoryIcon className="size-4 text-info-foreground" />
      <span className="font-medium">Viewing {selectedStage.occurrenceLabel}</span>
      <span className="text-muted-foreground">
        {activeStage.label} is {statusLabel(activeStage.status).toLowerCase()}.
      </span>
      <Button className="ml-auto" size="xs" variant="outline" onClick={onReturn}>
        <ArrowLeftIcon className="size-3.5" />
        Return to current
      </Button>
    </div>
  );
}

function ConversationView({
  stage,
  isActive,
  actionFeedback,
}: {
  readonly stage: TaskModePrototypeStage;
  readonly isActive: boolean;
  readonly actionFeedback: string | null;
}) {
  const canCompose = isActive && stage.status === "running";
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="task-mode-conversation-view">
      <div className="flex-1 space-y-6 overflow-auto px-5 py-6 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-3xl space-y-6">
          {stage.messages.map((message) => (
            <article key={message.id} className="flex gap-3">
              <div
                className={`grid size-7 shrink-0 place-items-center rounded-full ${
                  message.author === "agent" ? "bg-foreground text-background" : "bg-muted"
                }`}
              >
                {message.author === "agent" ? (
                  <SparklesIcon className="size-3.5" />
                ) : (
                  <span className="text-[10px] font-semibold">You</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{message.author === "agent" ? "Kata" : "You"}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground/90">
                  {message.body}
                </p>
              </div>
            </article>
          ))}
          {isActive && stage.status === "running" ? (
            <div className="flex items-center gap-2 pl-10 text-xs text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" />
              Working in {stage.label}…
            </div>
          ) : null}
          {actionFeedback ? (
            <div className="rounded-lg border border-success/25 bg-success/8 p-3 text-xs text-success-foreground">
              {actionFeedback}
            </div>
          ) : null}
        </div>
      </div>
      <div className="border-t border-border bg-background p-3 sm:p-4">
        <div
          className={`mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-border bg-card p-2 ${
            canCompose ? "" : "opacity-65"
          }`}
        >
          <textarea
            aria-label={`Message ${stage.label}`}
            className="min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none"
            placeholder={composerPlaceholder(stage, canCompose)}
            disabled={!canCompose}
          />
          <Button size="icon" disabled={!canCompose} aria-label="Send message">
            <SendIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function OutcomeView({ stage }: { readonly stage: TaskModePrototypeStage }) {
  return (
    <div
      className="min-h-0 flex-1 overflow-auto px-5 py-6 sm:px-8 lg:px-12"
      data-testid="task-mode-outcome-view"
    >
      <article className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {stage.label} outcome
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">{stage.outcomeTitle}</h2>
          </div>
          <Badge size="sm" variant={statusBadgeVariant(stage.status)}>
            {stage.occurrenceLabel}
          </Badge>
        </div>
        <p className="mt-5 text-sm leading-6 text-foreground/90">{stage.outcomeSummary}</p>
        <h3 className="mt-6 text-sm font-semibold">Decisions and findings</h3>
        <ul className="mt-3 space-y-2">
          {stage.outcomeItems.map((item) => (
            <li key={item} className="flex gap-2 text-sm leading-6 text-muted-foreground">
              <CheckCircle2Icon className="mt-1 size-4 shrink-0 text-success-foreground" />
              {item}
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}

function StageActionCard({
  scenario,
  selectedStage,
  isSelectedActive,
  onAction,
}: {
  readonly scenario: TaskModePrototypeScenario;
  readonly selectedStage: TaskModePrototypeStage;
  readonly isSelectedActive: boolean;
  readonly onAction: (feedback: string) => void;
}) {
  if (!isSelectedActive) return null;

  if (scenario.failure && selectedStage.status === "failed") {
    return (
      <div
        className="border-b border-destructive/25 bg-destructive/8 px-4 py-3"
        data-testid="task-mode-failure-card"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
          <AlertTriangleIcon className="size-4 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">{scenario.failure.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{scenario.failure.summary}</p>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onAction("Retry queued for the same Design occurrence.")}
          >
            <RotateCcwIcon className="size-3.5" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (scenario.planReview && selectedStage.id === "plan") {
    return (
      <div
        className="border-b border-warning/25 bg-warning/8 px-4 py-3"
        data-testid="task-mode-plan-review-card"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Plan ready for review</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{scenario.planReview.summary}</p>
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onAction("Plan feedback opened for a new Plan occurrence.")}
          >
            Request changes
          </Button>
          <Button size="xs" onClick={() => onAction("Plan approved in the prototype.")}>
            Approve plan
          </Button>
        </div>
      </div>
    );
  }

  if (scenario.checkpoint && selectedStage.id === "implement") {
    return (
      <div
        className="border-b border-info/25 bg-info/8 px-4 py-3"
        data-testid="task-mode-checkpoint-card"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3">
          <PlayIcon className="size-4 text-info-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">{scenario.checkpoint.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {scenario.checkpoint.completedItems}/{scenario.checkpoint.totalItems} items ·{" "}
              {scenario.checkpoint.summary}
            </p>
          </div>
          <Button size="xs" onClick={() => onAction("Checkpoint continued in the prototype.")}>
            Continue
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

export function TaskModeStageCanvas({
  scenario,
  selectedStage,
  activeStage,
  isViewingActiveOccurrence,
  selectedOccurrenceId,
  view,
  actionFeedback,
  onSelectOccurrence,
  onSetView,
  onReturnToCurrent,
  onOpenBranch,
  onAction,
}: {
  readonly scenario: TaskModePrototypeScenario;
  readonly selectedStage: TaskModePrototypeStage;
  readonly activeStage: TaskModePrototypeStage;
  readonly isViewingActiveOccurrence: boolean;
  readonly selectedOccurrenceId: string;
  readonly view: TaskModeStageView;
  readonly actionFeedback: string | null;
  readonly onSelectOccurrence: (occurrenceId: string) => void;
  readonly onSetView: (view: TaskModeStageView) => void;
  readonly onReturnToCurrent: () => void;
  readonly onOpenBranch: () => void;
  readonly onAction: (feedback: string) => void;
}) {
  const canBranch =
    !isViewingActiveOccurrence &&
    (selectedStage.status === "completed" || selectedStage.status === "historical");
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {!isViewingActiveOccurrence ? (
        <HistoricalStageBanner
          selectedStage={selectedStage}
          activeStage={activeStage}
          onReturn={onReturnToCurrent}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold">{selectedStage.label}</h2>
            <Badge size="sm" variant={statusBadgeVariant(selectedStage.status)}>
              {statusLabel(selectedStage.status)}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {selectedStage.occurrenceLabel}
            {isViewingActiveOccurrence ? " · current workflow stage" : " · historical stage"}
          </p>
        </div>
        {selectedStage.occurrences.length > 1 ? (
          <label className="relative">
            <span className="sr-only">Stage occurrence</span>
            <select
              data-testid="task-mode-occurrence-select"
              className="h-8 appearance-none rounded-lg border border-input bg-background py-1 pl-2.5 pr-8 text-xs"
              value={selectedOccurrenceId}
              onChange={(event) => onSelectOccurrence(event.currentTarget.value)}
            >
              {selectedStage.occurrences.map((occurrence) => (
                <option key={occurrence.id} value={occurrence.id}>
                  {occurrence.label}
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
          <button
            type="button"
            aria-pressed={view === "conversation"}
            data-testid="task-mode-view-conversation"
            data-active={view === "conversation" || undefined}
            className={`rounded-md px-2.5 py-1 text-xs ${
              view === "conversation"
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground"
            }`}
            onClick={() => onSetView("conversation")}
          >
            Conversation
          </button>
          <button
            type="button"
            aria-pressed={view === "outcome"}
            data-testid="task-mode-view-outcome"
            data-active={view === "outcome" || undefined}
            className={`rounded-md px-2.5 py-1 text-xs ${
              view === "outcome" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"
            }`}
            onClick={() => onSetView("outcome")}
          >
            Outcome
          </button>
        </div>
        {canBranch ? (
          <Button
            data-testid="task-mode-open-branch"
            size="xs"
            variant="outline"
            onClick={onOpenBranch}
          >
            <GitBranchIcon className="size-3.5" />
            Revise from here
          </Button>
        ) : null}
      </div>

      <StageActionCard
        scenario={scenario}
        selectedStage={selectedStage}
        isSelectedActive={isViewingActiveOccurrence}
        onAction={onAction}
      />

      {view === "conversation" ? (
        <ConversationView
          stage={selectedStage}
          isActive={isViewingActiveOccurrence}
          actionFeedback={actionFeedback}
        />
      ) : (
        <OutcomeView stage={selectedStage} />
      )}
    </section>
  );
}
