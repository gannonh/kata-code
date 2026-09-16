import {
  RoutineDraft,
  RoutineDraftModelOutput,
  RoutineError,
  previewRoutineSchedule,
  type ModelSelection,
  type OrchestrationProjectShell,
  type RoutineDraftGenerationInput,
  type RoutineDraftGenerationResult,
} from "@kata-sh/code-contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import {
  buildRoutineDraftPrompt,
  type RoutineDraftPromptModel,
} from "../textGeneration/TextGenerationPrompts.ts";
import type { RoutineDraftGenerationInput as GenerationInput } from "../textGeneration/TextGeneration.ts";

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

/** Drafting deliberately has no store, scheduler, or conversation dependencies. */
export function makeRoutineDraftGeneration(dependencies: {
  readonly projects: Effect.Effect<readonly Project[], RoutineError>;
  readonly models: Effect.Effect<readonly RoutineDraftPromptModel[], RoutineError>;
  readonly generate: (input: GenerationInput) => Effect.Effect<unknown, RoutineError>;
}) {
  const generate = (
    input: RoutineDraftGenerationInput,
  ): Effect.Effect<RoutineDraftGenerationResult, RoutineError> =>
    Effect.gen(function* () {
      const projects = yield* dependencies.projects;
      const models = yield* dependencies.models;
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
      const { prompt } = buildRoutineDraftPrompt({ ...input, projects, availableModels: models });
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
      // Revalidate after generation: projects and provider settings may have changed in flight.
      const currentProjects = yield* dependencies.projects;
      const currentModels = yield* dependencies.models;
      const target = currentProjects.find((candidate) => candidate.id === output.draft!.projectId);
      if (!target)
        return {
          draft: null,
          draftRevision: input.draftRevision,
          assistantMessage:
            "The proposed project is unavailable. Which existing project should this routine use?",
        };
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
        return {
          draft: null,
          draftRevision: input.draftRevision,
          assistantMessage:
            "The proposed execution model is unavailable. Which enabled provider and model should this routine use?",
        };
      const now = DateTime.toDateUtc(yield* DateTime.now);
      yield* Effect.try({
        try: () => previewRoutineSchedule(output.draft!.trigger, now),
        catch: (cause) => failure(String(cause)),
      });
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
