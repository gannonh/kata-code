import {
  RoutineDraft,
  RoutineDraftModelOutput,
  RoutineError,
  isScheduleTrigger,
  previewRoutineSchedule,
  type LinearEventTrigger,
  type ModelSelection,
  type OrchestrationProjectShell,
  type RoutineDraftGenerationInput,
  type RoutineDraftGenerationResult,
  type RoutineTrigger,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import {
  buildRoutineDraftPrompt,
  type RoutineDraftPromptEventSource,
  type RoutineDraftPromptModel,
} from "../textGeneration/TextGenerationPrompts.ts";
import type { RoutineDraftGenerationInput as GenerationInput } from "../textGeneration/TextGeneration.ts";

export type RoutineDraftEventSource = RoutineDraftPromptEventSource;

type Project = Pick<
  OrchestrationProjectShell,
  "id" | "title" | "workspaceRoot" | "repositoryIdentity"
>;
const decodeModelOutput = Schema.decodeUnknownEffect(RoutineDraftModelOutput, {
  onExcessProperty: "error",
});
const decodeDraft = Schema.decodeUnknownEffect(RoutineDraft);
const failure = (message: string) => new RoutineError({ code: "validation", message });
const permittedModel = (models: readonly RoutineDraftPromptModel[], selection: ModelSelection) =>
  models.some(
    (model) => model.instanceId === selection.instanceId && model.model === selection.model,
  );

/**
 * Models occasionally merge the list's `instanceId:model: Name` format into a
 * colon-joined instance id or copy the display name into the model field.
 * Re-identify the intended model from the allowed list; anything ambiguous
 * stays unpermitted and becomes a clarification turn.
 */
const repairGeneratedModelSelection = (
  selection: { readonly instanceId: string; readonly model: string },
  models: readonly RoutineDraftPromptModel[],
): { readonly instanceId: string; readonly model: string } => {
  if (permittedModel(models, selection as ModelSelection)) return selection;
  const [head, ...rest] = selection.instanceId.split(":");
  if (head !== undefined && rest.length > 0) {
    const joinedModel = rest.join(":");
    if (permittedModel(models, { instanceId: head, model: joinedModel } as ModelSelection)) {
      return { instanceId: head, model: joinedModel };
    }
  }
  if (selection.model.trim().length > 0) {
    const byName = models.filter(
      (model) => model.name.toLowerCase() === selection.model.trim().toLowerCase(),
    );
    const intended = byName.length === 1 ? byName[0] : undefined;
    if (
      intended !== undefined &&
      selection.instanceId.toLowerCase().includes(intended.instanceId.toLowerCase())
    ) {
      return { instanceId: intended.instanceId, model: intended.model };
    }
  }
  return selection;
};

/**
 * A Linear trigger is actionable only when every id it names still exists on
 * the verified connection. Each failure names the unavailable resource so the
 * next turn can ask one concrete clarification instead of saving a dead filter.
 */
const linearTriggerClarification = (
  trigger: LinearEventTrigger,
  sources: readonly RoutineDraftEventSource[],
): string | null => {
  const source = sources.find((candidate) => candidate.connectionId === trigger.connectionId);
  if (!source)
    return `The Linear connection "${trigger.connectionId}" is unavailable. Which connected workspace should this routine use?`;
  if (trigger.workspaceId !== source.workspaceId)
    return `The Linear workspace "${trigger.workspaceId}" is unavailable for connection "${trigger.connectionId}". Which connected workspace should this routine use?`;
  if (trigger.teamId !== undefined && !source.teams.some((team) => team.id === trigger.teamId))
    return `The Linear team "${trigger.teamId}" is unavailable for connection "${trigger.connectionId}". Which team should this routine use?`;
  if (trigger.projectId !== undefined) {
    const project = source.projects.find((candidate) => candidate.id === trigger.projectId);
    if (!project)
      return `The Linear project "${trigger.projectId}" is unavailable for connection "${trigger.connectionId}". Which project should this routine use?`;
    if (trigger.teamId !== undefined && !project.teamIds.includes(trigger.teamId))
      return `The Linear project "${trigger.projectId}" is not in team "${trigger.teamId}". Which project should this routine use?`;
  }
  if (trigger.event === "status_changed") {
    const state = source.states.find((candidate) => candidate.id === trigger.stateId);
    if (!state)
      return `The Linear state "${trigger.stateId}" is unavailable for connection "${trigger.connectionId}". Which state should trigger this routine?`;
    if (trigger.teamId !== undefined && state.teamId !== trigger.teamId)
      return `The Linear state "${trigger.stateId}" is not in team "${trigger.teamId}". Which state should trigger this routine?`;
  }
  if (trigger.event === "label_added") {
    const label = source.labels.find((candidate) => candidate.id === trigger.labelId);
    if (!label)
      return `The Linear label "${trigger.labelId}" is unavailable for connection "${trigger.connectionId}". Which label should trigger this routine?`;
    if (label.teamId !== null && trigger.teamId !== undefined && label.teamId !== trigger.teamId)
      return `The Linear label "${trigger.labelId}" is not in team "${trigger.teamId}". Which label should trigger this routine?`;
  }
  return null;
};

/** Drafting deliberately has no store, scheduler, or conversation dependencies. */
export function makeRoutineDraftGeneration(dependencies: {
  readonly projects: Effect.Effect<readonly Project[], RoutineError>;
  readonly models: Effect.Effect<readonly RoutineDraftPromptModel[], RoutineError>;
  readonly eventSources: Effect.Effect<readonly RoutineDraftEventSource[], RoutineError>;
  readonly generate: (input: GenerationInput) => Effect.Effect<unknown, RoutineError>;
}) {
  const clarify = (input: RoutineDraftGenerationInput, assistantMessage: string) => ({
    draft: null,
    assistantMessage,
    draftRevision: input.draftRevision,
  });
  const generate = (
    input: RoutineDraftGenerationInput,
  ): Effect.Effect<RoutineDraftGenerationResult, RoutineError> =>
    Effect.gen(function* () {
      const projects = yield* dependencies.projects;
      const models = yield* dependencies.models;
      const eventSources = yield* dependencies.eventSources;
      const project = projects.find((candidate) => candidate.id === input.projectId);
      if (!project)
        return yield* Effect.fail(
          failure("The selected project is unavailable. Choose an existing project."),
        );
      if (!permittedModel(models, input.generationModelSelection)) {
        return yield* Effect.fail(
          failure(
            "The selected generation model is unavailable. Choose an enabled provider and model.",
          ),
        );
      }
      const { prompt } = buildRoutineDraftPrompt({
        ...input,
        projects,
        availableModels: models,
        eventSources,
      });
      const raw = yield* dependencies.generate({
        cwd: project.workspaceRoot,
        prompt,
        modelSelection: input.generationModelSelection,
      });
      const output = yield* decodeModelOutput(raw).pipe(
        Effect.mapError(() =>
          failure("The provider returned an invalid routine draft. Retry or clarify your request."),
        ),
      );
      if (!output.draft)
        return {
          draft: null,
          assistantMessage: output.assistantMessage,
          draftRevision: input.draftRevision,
        };
      // Revalidate after generation: projects, provider settings, and connections may have changed in flight.
      const currentProjects = yield* dependencies.projects;
      const currentModels = yield* dependencies.models;
      const currentEventSources = yield* dependencies.eventSources;
      const target = currentProjects.find((candidate) => candidate.id === output.draft!.projectId);
      if (!target)
        return clarify(
          input,
          "The proposed project is unavailable. Which existing project should this routine use?",
        );
      if (!permittedModel(currentModels, input.generationModelSelection)) {
        return yield* failure(
          "The selected generation model is unavailable. Choose an enabled provider and model.",
        );
      }
      const repairedModelSelection = repairGeneratedModelSelection(
        output.draft.modelSelection,
        currentModels,
      );
      if (!permittedModel(currentModels, repairedModelSelection as ModelSelection))
        return clarify(
          input,
          "The proposed execution model is unavailable. Which enabled provider and model should this routine use?",
        );
      const trigger: RoutineTrigger = output.draft.trigger;
      if (isScheduleTrigger(trigger)) {
        const now = DateTime.toDateUtc(yield* DateTime.now);
        yield* Effect.try({
          try: () => previewRoutineSchedule(trigger, now),
          catch: (cause) => failure(String(cause)),
        });
      } else if (trigger.kind === "linear") {
        const assistantMessage = linearTriggerClarification(trigger, currentEventSources);
        if (assistantMessage !== null) return clarify(input, assistantMessage);
      } else {
        return clarify(
          input,
          "Only schedules and Linear issue events are supported. Which schedule or Linear event should trigger this routine?",
        );
      }
      const draft = yield* decodeDraft({
        ...output.draft,
        modelSelection:
          input.currentDraft?.modelSelection.instanceId === repairedModelSelection.instanceId &&
          input.currentDraft.modelSelection.model === repairedModelSelection.model
            ? input.currentDraft.modelSelection
            : {
                instanceId: repairedModelSelection.instanceId,
                model: repairedModelSelection.model,
              },
        runtimeMode: input.currentDraft?.runtimeMode ?? "approval-required",
        workspace:
          input.currentDraft?.projectId === target.id
            ? input.currentDraft.workspace
            : target.repositoryIdentity != null
              ? {
                  kind: "worktree",
                  baseBranch: "main",
                  startFromOrigin: true,
                  runSetupScript: true,
                }
              : { kind: "shared", directory: target.workspaceRoot },
      }).pipe(Effect.mapError(() => failure("The generated routine could not be validated.")));
      return {
        draft,
        assistantMessage: output.assistantMessage,
        draftRevision: input.draftRevision,
      };
    });
  return { generate };
}
