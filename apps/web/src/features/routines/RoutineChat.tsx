import type {
  EnvironmentId,
  ModelSelection,
  RoutineDraft,
  RoutineDraftGenerationResult,
  RoutineId,
  ServerProvider,
} from "@kata-sh/code-contracts";
import { ModelSelection as ModelSelectionSchema } from "@kata-sh/code-contracts";
import {
  executeAtomQuery,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@kata-sh/code-client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SendIcon, SquareIcon, WandSparklesIcon } from "lucide-react";

import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { routineEnvironment } from "../../state/routines";
import {
  applyRoutineDraftGenerationResponse,
  mergeRoutineDraftGeneratedFields,
  routineDraftForGenerationInput,
  routineDraftChatHistoryAfterTurn,
  routineDraftChatHistoryForRequest,
  type RoutineDraftChatTurn,
  type RoutineEditorDraft,
} from "./RoutinesPage.logic";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelectionSchema);

type RoutineChatDraft = {
  readonly id: RoutineId;
  readonly environmentId: EnvironmentId;
  readonly configuration: RoutineEditorDraft;
};

type GenerationModel = {
  readonly instanceId: string;
  readonly model: string;
  readonly label: string;
  readonly unavailableReason: string | null;
  readonly canAttempt: boolean;
};

function errorMessage(value: unknown): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = (value as { readonly message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The routine assistant request failed. Try again.";
}

const generationModelKey = (instanceId: string, model: string): string =>
  JSON.stringify([instanceId, model]);

function modelsForGeneration(providers: readonly ServerProvider[]): readonly GenerationModel[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter((model) => !model.isLegacy)
      .map((model) => ({
        instanceId: provider.instanceId,
        model: model.slug,
        label: `${provider.displayName ?? provider.instanceId} · ${model.name}`,
        unavailableReason:
          provider.supportsTextGeneration === false
            ? `${provider.displayName ?? provider.instanceId} does not support routine draft generation.`
            : provider.availability === "unavailable"
              ? (provider.unavailableReason ?? "This provider is unavailable.")
              : !provider.enabled || provider.status === "disabled"
                ? "This provider is disabled."
                : null,
        canAttempt:
          provider.enabled &&
          provider.status !== "disabled" &&
          provider.availability !== "unavailable",
      })),
  );
}

export function RoutineChat({
  draft,
  draftRevision,
  providers,
  generationModelSelection,
  onGenerationModelChange,
  onDraftChange,
  onCancel,
}: {
  readonly draft: RoutineChatDraft;
  readonly draftRevision: number;
  readonly providers: readonly ServerProvider[];
  readonly generationModelSelection: ModelSelection | null;
  readonly onGenerationModelChange: (selection: ModelSelection) => void;
  readonly onDraftChange: (configuration: RoutineEditorDraft) => void;
  readonly onCancel: () => void;
}) {
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<readonly RoutineDraftChatTurn[]>([]);
  const turnIdRef = useRef(0);
  const nextTurnId = () => ++turnIdRef.current;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewDraft, setReviewDraft] = useState<RoutineDraft | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestTokenRef = useRef(0);
  const latestDraftRef = useRef(draft);
  const latestRevisionRef = useRef(draftRevision);
  const initializedRef = useRef(false);
  useLayoutEffect(() => {
    latestDraftRef.current = draft;
    latestRevisionRef.current = draftRevision;
    if (draftRevision > 0) initializedRef.current = true;
  }, [draft, draftRevision]);
  const generationModels = useMemo(() => modelsForGeneration(providers), [providers]);
  const selectedGenerationKey = generationModelSelection
    ? generationModelKey(generationModelSelection.instanceId, generationModelSelection.model)
    : "";
  const selectedGenerationModel = generationModels.find(
    (candidate) =>
      candidate.instanceId === generationModelSelection?.instanceId &&
      candidate.model === generationModelSelection?.model,
  );

  useEffect(() => {
    return () => {
      requestTokenRef.current += 1;
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  const submit = useCallback(async () => {
    const trimmed = message.trim();
    if (
      !trimmed ||
      pending ||
      generationModelSelection === null ||
      generationModelSelection.model.trim().length === 0
    ) {
      return;
    }
    const requestState = latestDraftRef.current;
    const requestDraft = requestState.configuration;
    const requestRevision = latestRevisionRef.current;
    const initialized = initializedRef.current || requestRevision > 0;
    const controller = new AbortController();
    const token = requestTokenRef.current + 1;
    requestTokenRef.current = token;
    requestRef.current = controller;
    setPending(true);
    setError(null);
    setReviewDraft(null);
    const result = await executeAtomQuery(
      appAtomRegistry,
      routineEnvironment.draft({
        environmentId: requestState.environmentId,
        input: {
          message: trimmed,
          currentDraft: routineDraftForGenerationInput(requestDraft, initialized),
          draftRevision: requestRevision,
          history: routineDraftChatHistoryForRequest(history),
          projectId: requestDraft.projectId,
          generationModelSelection,
        },
      }),
      {
        signal: controller.signal,
        refresh: true,
        reportDefect: false,
        reportFailure: false,
      },
    );
    if (requestTokenRef.current !== token) return;
    requestRef.current = null;
    setPending(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        setError(errorMessage(squashAtomCommandFailure(result)));
      }
      return;
    }

    const response: RoutineDraftGenerationResult = result.value;
    setMessage("");
    setHistory((previous) =>
      routineDraftChatHistoryAfterTurn(previous, trimmed, response.assistantMessage, nextTurnId),
    );
    const applied = applyRoutineDraftGenerationResponse(
      latestDraftRef.current.configuration,
      latestRevisionRef.current,
      response,
    );
    if (applied.status !== "clarification") initializedRef.current = true;
    if (applied.status === "applied") {
      onDraftChange(applied.draft);
    } else if (applied.status === "stale") {
      setReviewDraft(response.draft);
    }
  }, [generationModelSelection, history, message, onDraftChange, pending]);

  const cancel = () => {
    requestTokenRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
    setPending(false);
    onCancel();
  };

  const applyReview = () => {
    if (reviewDraft === null) return;
    onDraftChange(
      mergeRoutineDraftGeneratedFields(latestDraftRef.current.configuration, reviewDraft),
    );
    setReviewDraft(null);
  };

  const chooseGenerationModel = (value: string) => {
    if (!value) return;
    const candidate = generationModels.find(
      (entry) => generationModelKey(entry.instanceId, entry.model) === value,
    );
    if (!candidate) return;
    onGenerationModelChange(
      decodeModelSelection({
        instanceId: candidate.instanceId,
        model: candidate.model,
        options: undefined,
      }),
    );
  };

  return (
    <section
      className="min-w-0 rounded-xl border border-border/60 bg-card/30 p-4"
      aria-label="Create routine in chat"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <WandSparklesIcon className="size-4 text-primary" /> Create in chat
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Describe the schedule and instruction. Review the fields before saving.
          </p>
        </div>
        <div className="grid min-w-48 gap-1.5">
          <label
            htmlFor="routine-generation-model"
            className="text-xs font-medium text-muted-foreground"
          >
            Generation model
          </label>
          <select
            id="routine-generation-model"
            className="h-8 min-w-0 max-w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={selectedGenerationKey}
            onChange={(event) => chooseGenerationModel(event.target.value)}
            disabled={pending}
          >
            <option value="">Select a generation model</option>
            {generationModels.map((candidate) => (
              <option
                key={generationModelKey(candidate.instanceId, candidate.model)}
                value={generationModelKey(candidate.instanceId, candidate.model)}
                disabled={!candidate.canAttempt}
              >
                {candidate.label}
                {candidate.unavailableReason ? ` (${candidate.unavailableReason})` : ""}
              </option>
            ))}
          </select>
          {generationModelSelection &&
          generationModelSelection.model &&
          !generationModels.some(
            (candidate) =>
              candidate.instanceId === generationModelSelection.instanceId &&
              candidate.model === generationModelSelection.model,
          ) ? (
            <p className="text-xs text-warning-foreground">
              The selected generation model is unavailable.
            </p>
          ) : null}
          {selectedGenerationModel?.unavailableReason ? (
            <p className="text-xs text-warning-foreground">
              {selectedGenerationModel.unavailableReason}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2" aria-live="polite">
        {history.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-xs text-muted-foreground">
            Try “Every weekday at 9 AM, summarize the latest project changes.”
          </p>
        ) : (
          history.map((entry) => (
            <div
              key={entry.id}
              className={
                entry.role === "user"
                  ? "ml-8 rounded-lg bg-primary/10 px-3 py-2 text-sm"
                  : "mr-8 rounded-lg bg-muted/40 px-3 py-2 text-sm"
              }
            >
              <span className="mb-1 block text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                {entry.role === "user" ? "You" : "Assistant"}
              </span>
              <p className="whitespace-pre-wrap">{entry.content}</p>
            </div>
          ))
        )}
      </div>

      {reviewDraft ? (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/8 px-3 py-3 text-xs">
          <p className="font-medium text-warning-foreground">
            Your editor changed while this response was generating.
          </p>
          <p className="mt-1 text-muted-foreground">
            Review the generated fields before applying them.
          </p>
          <Button className="mt-2" size="sm" variant="outline" onClick={applyReview}>
            Review generated changes
          </Button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          {error}
          <Button
            className="ml-2"
            size="xs"
            variant="outline"
            onClick={() => void submit()}
            disabled={pending}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2">
        <Textarea
          aria-label="Routine chat message"
          rows={3}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="Describe what this routine should do and when it should run."
          disabled={pending}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs text-muted-foreground">Ctrl/⌘ + Enter to send</p>
          {pending ? (
            <Button size="sm" variant="outline" onClick={cancel}>
              <SquareIcon className="size-3.5" /> Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={
                message.trim().length === 0 ||
                generationModelSelection === null ||
                generationModelSelection.model.trim().length === 0
              }
            >
              <SendIcon className="size-3.5" /> Generate draft
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
