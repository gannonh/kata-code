import { describe, expect } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  ProjectId,
  RoutineError,
  type ModelSelection,
  type RoutineDraftGenerationInput,
} from "@kata-sh/code-contracts";
import {
  makeRoutineDraftGeneration,
  type RoutineDraftEventSource,
} from "./RoutineDraftGeneration.ts";

const projectId = ProjectId.make("project");
const modelSelection = { instanceId: "codex", model: "model" } as ModelSelection;
const fields = {
  name: "Review",
  instruction: "Review changes",
  projectId,
  modelSelection,
  trigger: { kind: "weekdays", time: "09:00", timezone: "UTC" },
} as const;
const input: RoutineDraftGenerationInput = {
  message: "Review each weekday at 9 UTC",
  projectId,
  currentDraft: null,
  history: [],
  draftRevision: 3,
  generationModelSelection: modelSelection,
};
const projects = [
  { id: projectId, title: "Project", workspaceRoot: "/project", repositoryIdentity: null },
];
const models = [{ ...modelSelection, name: "Model" }];
const linearEventSource: RoutineDraftEventSource = {
  connectionId: "linear-connection-1",
  provider: "linear",
  workspaceId: "workspace-uuid",
  workspaceName: "Acme",
  teams: [{ id: "team-uuid", name: "Engineering", key: "ENG" }],
  projects: [{ id: "project-uuid", name: "Roadmap", teamIds: ["team-uuid"] }],
  states: [{ id: "state-uuid", name: "In Progress", teamId: "team-uuid", type: "started" }],
  labels: [{ id: "label-uuid", name: "Bug", teamId: "team-uuid" }],
};
function service(
  output: unknown,
  allowedModels = models,
  eventSources: ReadonlyArray<RoutineDraftEventSource> = [],
) {
  return makeRoutineDraftGeneration({
    projects: Effect.succeed(projects),
    models: Effect.succeed(allowedModels),
    eventSources: Effect.succeed(eventSources),
    generate: () => Effect.succeed(output),
  });
}

describe("routine draft generation", () => {
  it.effect(
    "returns a validated supervised draft with manual workspace defaults and revision",
    () =>
      Effect.gen(function* () {
        const result = yield* service({
          draft: fields,
          assistantMessage: "Ready to review",
        }).generate(input);
        expect(result).toEqual({
          draft: {
            ...fields,
            runtimeMode: "approval-required",
            workspace: { kind: "shared", directory: "/project" },
          },
          assistantMessage: "Ready to review",
          draftRevision: 3,
        });
      }),
  );
  it.effect("preserves manually selected runtime and workspace during refinement", () =>
    Effect.gen(function* () {
      const currentDraft = {
        ...fields,
        runtimeMode: "full-access" as const,
        workspace: { kind: "shared" as const, directory: "/manual" },
      };
      const result = yield* service({ draft: fields, assistantMessage: "Updated" }).generate({
        ...input,
        currentDraft,
      });
      expect(result.draft).toEqual(currentDraft);
    }),
  );
  it.effect("carries a mid-edit draft with blank name and instruction through refinement", () =>
    Effect.gen(function* () {
      const currentDraft = {
        ...fields,
        name: "",
        instruction: "",
        runtimeMode: "auto-accept-edits" as const,
        workspace: {
          kind: "worktree" as const,
          baseBranch: "trunk",
          startFromOrigin: true,
          runSetupScript: false,
        },
      };
      const result = yield* service({ draft: fields, assistantMessage: "Moved to 3pm" }).generate({
        ...input,
        currentDraft,
      });
      expect(result.draft).toEqual({
        ...fields,
        runtimeMode: "auto-accept-edits",
        workspace: currentDraft.workspace,
      });
    }),
  );
  it.effect("propagates a provider failure without returning a draft", () =>
    Effect.gen(function* () {
      const generator = makeRoutineDraftGeneration({
        projects: Effect.succeed(projects),
        models: Effect.succeed(models),
        eventSources: Effect.succeed([]),
        generate: () =>
          Effect.fail(new RoutineError({ code: "blocked", message: "unsupported by Grok" })),
      });
      const error = yield* Effect.flip(generator.generate(input));
      expect(error.code).toBe("blocked");
      expect(error.message).toBe("unsupported by Grok");
    }),
  );
  it.effect("interrupts provider work without producing a draft", () =>
    Effect.gen(function* () {
      const generator = makeRoutineDraftGeneration({
        projects: Effect.succeed(projects),
        models: Effect.succeed(models),
        eventSources: Effect.succeed([]),
        generate: () => Effect.interrupt,
      });
      const exit = yield* Effect.exit(generator.generate(input));
      expect(exit._tag).not.toBe("Success");
    }),
  );
  it.effect.each([
    { ...fields, runtimeMode: "full-access" },
    { ...fields, modelSelection: { ...modelSelection, provider: "codex" } },
    { ...fields, workspace: { kind: "shared", directory: "/other" } },
    { ...fields, trigger: { kind: "cron", expression: "invalid", timezone: "UTC" } },
    { ...fields, trigger: { kind: "daily", time: "09:00", timezone: "not-a-zone" } },
    { name: "incomplete" },
  ])("rejects invalid or unauthorized generated fields: %j", (draft) =>
    Effect.gen(function* () {
      const result = yield* Effect.flip(
        service({ draft, assistantMessage: "Ready" }).generate(input),
      );
      expect(result.code).toBe("validation");
    }),
  );
  it.effect("returns clarification without inventing a draft", () =>
    Effect.gen(function* () {
      expect(
        yield* service({ draft: null, assistantMessage: "Which schedule?" }).generate(input),
      ).toEqual({ draft: null, assistantMessage: "Which schedule?", draftRevision: 3 });
    }),
  );
  it.effect("resolves a generated Linear issue_created trigger against the event sources", () =>
    Effect.gen(function* () {
      const trigger = {
        kind: "linear",
        connectionId: "linear-connection-1",
        workspaceId: "workspace-uuid",
        event: "issue_created",
      } as const;
      const result = yield* service(
        {
          draft: { ...fields, trigger },
          assistantMessage: "Ready to triage",
        },
        models,
        [linearEventSource],
      ).generate({ ...input, message: "When a Linear issue is created, triage it" });
      expect(result.draft).toEqual({
        ...fields,
        trigger,
        runtimeMode: "approval-required",
        workspace: { kind: "shared", directory: "/project" },
      });
    }),
  );
  it.effect("clarifies a status_changed trigger naming an unknown state", () =>
    Effect.gen(function* () {
      const result = yield* service(
        {
          draft: {
            ...fields,
            trigger: {
              kind: "linear",
              connectionId: "linear-connection-1",
              workspaceId: "workspace-uuid",
              event: "status_changed",
              stateId: "missing-state",
            },
          },
          assistantMessage: "Ready",
        },
        models,
        [linearEventSource],
      ).generate({ ...input, message: "When a Linear issue moves to Review" });
      expect(result.draft).toBeNull();
      expect(result.assistantMessage).toMatch(/state.*unavailable/i);
    }),
  );
  it.effect("clarifies a Linear trigger whose connection disappears after generation", () =>
    Effect.gen(function* () {
      let active = true;
      const generator = makeRoutineDraftGeneration({
        projects: Effect.succeed(projects),
        models: Effect.succeed(models),
        eventSources: Effect.sync(() => (active ? [linearEventSource] : [])),
        generate: () =>
          Effect.sync(() => {
            active = false;
            return {
              draft: {
                ...fields,
                trigger: {
                  kind: "linear",
                  connectionId: "linear-connection-1",
                  workspaceId: "workspace-uuid",
                  event: "issue_created",
                },
              },
              assistantMessage: "Ready",
            };
          }),
      });
      const result = yield* generator.generate(input);
      expect(result.draft).toBeNull();
      expect(result.assistantMessage).toMatch(/connection.*unavailable/i);
    }),
  );
  it.effect("rejects missing generation model before invoking the provider", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(service(null, []).generate(input));
      expect(error.message).toMatch(/model/i);
    }),
  );
  it.effect("revalidates a project removed while the model is responding", () =>
    Effect.gen(function* () {
      let active = true;
      const generator = makeRoutineDraftGeneration({
        projects: Effect.sync(() => (active ? projects : [])),
        models: Effect.succeed(models),
        eventSources: Effect.succeed([]),
        generate: () =>
          Effect.sync(() => {
            active = false;
            return { draft: fields, assistantMessage: "Ready" };
          }),
      });
      const result = yield* generator.generate(input);
      expect(result.draft).toBeNull();
      expect(result.assistantMessage).toMatch(/project.*unavailable/i);
    }),
  );
  it.effect("revalidates a provider disabled while the model is responding", () =>
    Effect.gen(function* () {
      let active = true;
      const generator = makeRoutineDraftGeneration({
        projects: Effect.succeed(projects),
        models: Effect.sync(() => (active ? models : [])),
        eventSources: Effect.succeed([]),
        generate: () =>
          Effect.sync(() => {
            active = false;
            return { draft: fields, assistantMessage: "Ready" };
          }),
      });
      const error = yield* Effect.flip(generator.generate(input));
      expect(error.message).toMatch(/model.*unavailable/i);
    }),
  );
  it.effect.each([
    { ...fields, projectId: "unknown" },
    { ...fields, modelSelection: { instanceId: "other", model: "model" } },
  ])("clarifies unavailable proposed identities without returning a draft", (draft) =>
    Effect.gen(function* () {
      const result = yield* service({ draft, assistantMessage: "Ready" }).generate(input);
      expect(result.draft).toBeNull();
      expect(result.assistantMessage).toMatch(/unavailable/i);
    }),
  );
  it.effect("repairs a colon-joined model selection into the allowed model", () =>
    Effect.gen(function* () {
      const result = yield* service({
        draft: {
          ...fields,
          modelSelection: { instanceId: "codex:model", model: "Model" },
        },
        assistantMessage: "Ready",
      }).generate(input);
      expect(result.draft?.modelSelection).toEqual(modelSelection);
    }),
  );
  it.effect("clarifies an unrepairable model selection without returning a draft", () =>
    Effect.gen(function* () {
      const result = yield* service({
        draft: {
          ...fields,
          modelSelection: { instanceId: "unknown provider", model: "Unknown" },
        },
        assistantMessage: "Ready",
      }).generate(input);
      expect(result.draft).toBeNull();
      expect(result.assistantMessage).toMatch(/execution model/i);
    }),
  );
  it.effect(
    "repairs a display-name model selection when the evidence matches one allowed model",
    () =>
      Effect.gen(function* () {
        const result = yield* service({
          draft: {
            ...fields,
            modelSelection: { instanceId: "codex", model: "Model" },
          },
          assistantMessage: "Ready",
        }).generate(input);
        expect(result.draft?.modelSelection).toEqual(modelSelection);
      }),
  );
});
