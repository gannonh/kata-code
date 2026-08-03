import { describe, expect, it } from "@effect/vitest";
import {
  TASK_WORKSPACE_PRESET_CATALOG,
  taskWorkspacePresetCatalogEntry,
} from "@kata-sh/code-shared/taskWorkspacePresets";
import { TASK_WORKSPACE_WORKFLOW_CATALOG } from "@kata-sh/code-shared/taskWorkspaceCatalog";

import {
  allowsExplicitEntry,
  artifactKindForStage,
  BUILT_IN_WORKFLOW_DEFINITIONS,
  currentVersionForPreset,
  CURRENT_STANDARD_WORKFLOW_VERSION,
  FREEFORM_WORKFLOW_V0_1_0,
  GUIDED_WORKFLOW_V0_1_0,
  legacyVersionForPreset,
  makeWorkflowDefinitionRegistry,
  resolveWorkflowDefinition,
  STANDARD_WORKFLOW_V0_1_0,
  transitionFor,
  type WorkflowDefinition,
} from "./workflowDefinitions.ts";

/** A hypothetical next version of Standard that reshapes the rail. */
const STANDARD_WORKFLOW_V0_2_0: WorkflowDefinition = {
  ...STANDARD_WORKFLOW_V0_1_0,
  version: "standard@0.2.0",
  // Drops the questions gate: plan may be written from the first stage.
  stageArtifactKinds: { questions: "plan", plan: "plan", verify: "verification" },
  transitions: [
    { command: "task.questions.complete", from: "questions", to: "plan", requiresArtifact: null },
    ...STANDARD_WORKFLOW_V0_1_0.transitions.filter(
      (transition) => transition.command !== "task.questions.complete",
    ),
  ],
};

describe("workflowDefinitions", () => {
  it("ships Standard 0.1.0 as the legacy definition and Standard 0.2.0 as the first-slice shell", () => {
    expect(CURRENT_STANDARD_WORKFLOW_VERSION).toBe("standard@0.1.0");
    expect(resolveWorkflowDefinition(CURRENT_STANDARD_WORKFLOW_VERSION)).toBe(
      STANDARD_WORKFLOW_V0_1_0,
    );
    expect(BUILT_IN_WORKFLOW_DEFINITIONS.get("standard@0.1.0")).toBe(STANDARD_WORKFLOW_V0_1_0);
    expect(BUILT_IN_WORKFLOW_DEFINITIONS.get("standard@0.2.0")?.availableInFirstSlice).toBe(false);
  });

  it("reproduces the Slice 1 / Slice 2 Standard rail exactly", () => {
    expect(STANDARD_WORKFLOW_V0_1_0.initialStage).toBe("questions");
    expect(STANDARD_WORKFLOW_V0_1_0.terminalStage).toBe("verified");
    expect(
      STANDARD_WORKFLOW_V0_1_0.transitions.map((transition) => [
        transition.command,
        transition.from,
        transition.to,
        transition.requiresArtifact,
      ]),
    ).toEqual([
      ["task.questions.complete", "questions", "plan", "questions"],
      ["task.plan.approve", "plan", "build", "plan"],
      ["task.fixture.apply", "build", "verify", null],
      ["task.verification.signoff", "verify", "verified", null],
    ]);
    expect(artifactKindForStage(STANDARD_WORKFLOW_V0_1_0, "questions")).toBe("questions");
    expect(artifactKindForStage(STANDARD_WORKFLOW_V0_1_0, "plan")).toBe("plan");
    expect(artifactKindForStage(STANDARD_WORKFLOW_V0_1_0, "verify")).toBe("verification");
    expect(artifactKindForStage(STANDARD_WORKFLOW_V0_1_0, "build")).toBeNull();
    expect(artifactKindForStage(STANDARD_WORKFLOW_V0_1_0, "verified")).toBeNull();
  });

  // The negative proof the parent spec asks for: registering a newer version of a
  // preset must not change how a task pinned to the older version behaves.
  it("keeps a pinned version resolving its original definition after a newer one is registered", () => {
    const registry = makeWorkflowDefinitionRegistry([
      STANDARD_WORKFLOW_V0_1_0,
      STANDARD_WORKFLOW_V0_2_0,
    ]);

    const pinned = resolveWorkflowDefinition("standard@0.1.0", registry);

    expect(pinned).toBe(STANDARD_WORKFLOW_V0_1_0);
    expect(transitionFor(pinned, "task.questions.complete")).toEqual({
      command: "task.questions.complete",
      from: "questions",
      to: "plan",
      requiresArtifact: "questions",
    });
    expect(artifactKindForStage(pinned, "questions")).toBe("questions");

    // The newer version really is different, so the assertions above are load-bearing.
    const latest = resolveWorkflowDefinition("standard@0.2.0", registry);
    expect(transitionFor(latest, "task.questions.complete")?.requiresArtifact).toBeNull();
    expect(artifactKindForStage(latest, "questions")).toBe("plan");
  });

  it("names the missing version when a task pins a definition this build does not ship", () => {
    const registry = makeWorkflowDefinitionRegistry([STANDARD_WORKFLOW_V0_1_0]);

    expect(() => resolveWorkflowDefinition("guided@9.9.9", registry)).toThrow("guided@9.9.9");
  });

  it("rejects registering the same version twice", () => {
    expect(() =>
      makeWorkflowDefinitionRegistry([STANDARD_WORKFLOW_V0_1_0, STANDARD_WORKFLOW_V0_1_0]),
    ).toThrow("standard@0.1.0");
  });

  it("rejects duplicate transition commands within one definition", () => {
    expect(() =>
      makeWorkflowDefinitionRegistry([
        {
          ...STANDARD_WORKFLOW_V0_1_0,
          version: "standard@duplicate-command",
          transitions: [
            ...STANDARD_WORKFLOW_V0_1_0.transitions,
            {
              command: "task.questions.complete",
              from: "plan",
              to: "verify",
              requiresArtifact: null,
            },
          ],
        },
      ]),
    ).toThrow(
      "Workflow definition 'standard@duplicate-command' declares duplicate transition command 'task.questions.complete'.",
    );
  });

  it("rejects transitions that enter Build without the provisioning command", () => {
    expect(() =>
      makeWorkflowDefinitionRegistry([
        {
          ...STANDARD_WORKFLOW_V0_1_0,
          version: "standard@unprovisioned-build",
          transitions: [
            {
              command: "task.questions.complete",
              from: "questions",
              to: "build",
              requiresArtifact: null,
            },
          ],
        },
      ]),
    ).toThrow(
      "Workflow definition 'standard@unprovisioned-build' enters Build through 'task.questions.complete', but only 'task.plan.approve' provisions the worktree.",
    );
  });

  it("rejects lifecycle and transition stages outside the definition's stage set", () => {
    const cases: ReadonlyArray<{
      definition: WorkflowDefinition;
      message: string;
    }> = [
      {
        definition: {
          ...STANDARD_WORKFLOW_V0_1_0,
          version: "standard@undeclared-initial",
          stages: ["plan", "build", "verify", "verified"],
        },
        message:
          "Workflow definition 'standard@undeclared-initial' has undeclared initial stage 'questions'.",
      },
      {
        definition: {
          ...STANDARD_WORKFLOW_V0_1_0,
          version: "standard@undeclared-terminal",
          stages: ["questions", "plan", "build", "verify"],
        },
        message:
          "Workflow definition 'standard@undeclared-terminal' has undeclared terminal stage 'verified'.",
      },
      {
        definition: {
          ...STANDARD_WORKFLOW_V0_1_0,
          version: "standard@undeclared-transition-source",
          stages: ["questions", "plan", "verify", "verified"],
          transitions: [
            {
              command: "task.fixture.apply",
              from: "build",
              to: "verify",
              requiresArtifact: null,
            },
          ],
        },
        message:
          "Workflow definition 'standard@undeclared-transition-source' transition 'task.fixture.apply' starts from undeclared stage 'build'.",
      },
      {
        definition: {
          ...STANDARD_WORKFLOW_V0_1_0,
          version: "standard@undeclared-transition-destination",
          stages: ["questions", "build", "verify", "verified"],
          stageArtifactKinds: {
            questions: "questions",
            verify: "verification",
          },
          transitions: [
            {
              command: "task.questions.complete",
              from: "questions",
              to: "plan",
              requiresArtifact: "questions",
            },
          ],
        },
        message:
          "Workflow definition 'standard@undeclared-transition-destination' transition 'task.questions.complete' ends at undeclared stage 'plan'.",
      },
    ];

    for (const testCase of cases) {
      expect(() => makeWorkflowDefinitionRegistry([testCase.definition])).toThrow(testCase.message);
    }
  });

  it("rejects artifact mappings for undeclared stages", () => {
    expect(() =>
      makeWorkflowDefinitionRegistry([
        {
          ...STANDARD_WORKFLOW_V0_1_0,
          version: "standard@undeclared-artifact-stage",
          stageArtifactKinds: {
            ...STANDARD_WORKFLOW_V0_1_0.stageArtifactKinds,
            retired: "plan",
          } as WorkflowDefinition["stageArtifactKinds"],
        },
      ]),
    ).toThrow(
      "Workflow definition 'standard@undeclared-artifact-stage' maps an artifact kind for undeclared stage 'retired'.",
    );
  });

  it("returns null for a transition the definition does not declare", () => {
    expect(transitionFor(STANDARD_WORKFLOW_V0_1_0, "task.plan.approve")).not.toBeNull();
    expect(
      transitionFor({ ...STANDARD_WORKFLOW_V0_1_0, transitions: [] }, "task.plan.approve"),
    ).toBeNull();
  });

  it("runs Guided through Questions, Research, Design, and Plan with an artifact per stage", () => {
    expect(GUIDED_WORKFLOW_V0_1_0.initialStage).toBe("questions");
    expect(
      GUIDED_WORKFLOW_V0_1_0.transitions.map((transition) => [
        transition.command,
        transition.from,
        transition.to,
        transition.requiresArtifact,
      ]),
    ).toEqual([
      ["task.questions.complete", "questions", "research", "questions"],
      ["task.research.complete", "research", "design", "research"],
      ["task.design.complete", "design", "plan", "design"],
      ["task.plan.approve", "plan", "build", "plan"],
      ["task.fixture.apply", "build", "verify", null],
      ["task.verification.signoff", "verify", "verified", null],
    ]);
    // Each reasoning stage writes its own kind, which is what lets the next
    // stage start from a selection of blocks rather than the prior transcript.
    expect(artifactKindForStage(GUIDED_WORKFLOW_V0_1_0, "research")).toBe("research");
    expect(artifactKindForStage(GUIDED_WORKFLOW_V0_1_0, "design")).toBe("design");
    // Guided is a rail, so nothing may be entered out of order.
    expect(GUIDED_WORKFLOW_V0_1_0.explicitEntryStages).toEqual([]);
  });

  it("gives Freeform no rail out of its initial stage, only explicit entries", () => {
    expect(FREEFORM_WORKFLOW_V0_1_0.initialStage).toBe("questions");
    expect(
      FREEFORM_WORKFLOW_V0_1_0.transitions.some((transition) => transition.from === "questions"),
    ).toBe(false);
    expect(transitionFor(FREEFORM_WORKFLOW_V0_1_0, "task.questions.complete")).toBeNull();

    for (const stage of ["questions", "research", "design", "plan", "verify"] as const) {
      expect(allowsExplicitEntry(FREEFORM_WORKFLOW_V0_1_0, stage)).toBe(true);
    }
    // Build is reached by approving a plan and Verified by signoff, never
    // explicitly — that is what keeps Freeform on the same delivery path.
    expect(allowsExplicitEntry(FREEFORM_WORKFLOW_V0_1_0, "build")).toBe(false);
    expect(allowsExplicitEntry(FREEFORM_WORKFLOW_V0_1_0, "verified")).toBe(false);
    expect(FREEFORM_WORKFLOW_V0_1_0.transitions.map((transition) => transition.command)).toEqual([
      "task.plan.approve",
      "task.fixture.apply",
      "task.verification.signoff",
    ]);
  });

  // `transitionFor` resolves a command by first match, so a definition that
  // declared the same command twice would silently strand the later one. No
  // built-in does, and Slice 3b adds two more definitions, so lock it here.
  // (The registry does not yet reject this at registration time — that is
  // tracked on the Slice 3a PR; this test protects the shipped definitions
  // either way.)
  it("declares each transition command at most once per definition", () => {
    for (const definition of BUILT_IN_WORKFLOW_DEFINITIONS.values()) {
      const commands = definition.transitions.map((transition) => transition.command);
      expect(new Set(commands).size, `${definition.version} has a duplicated command`).toBe(
        commands.length,
      );
      // Every declared transition is therefore reachable by lookup.
      for (const transition of definition.transitions) {
        expect(transitionFor(definition, transition.command)).toBe(transition);
      }
    }
  });

  it("pins the matching current version for every preset", () => {
    expect(currentVersionForPreset("standard")).toBe("standard@0.2.0");
    expect(currentVersionForPreset("guided")).toBe("guided@0.3.0");
    expect(currentVersionForPreset("freeform")).toBe("freeform@0.2.0");
    for (const preset of ["standard", "guided", "freeform"] as const) {
      expect(resolveWorkflowDefinition(currentVersionForPreset(preset)).preset).toBe(preset);
    }
  });

  it("compiles first-slice definitions from the shared workflow catalog", () => {
    expect(resolveWorkflowDefinition("guided@0.2.0").availableInFirstSlice).toBe(true);
    expect(resolveWorkflowDefinition("guided@0.2.0").completionTransportRequired).toBe(true);
    expect(resolveWorkflowDefinition("guided@0.2.0").autoAdvanceStages).toEqual([
      "questions",
      "research",
      "design",
    ]);
    expect(resolveWorkflowDefinition("guided@0.2.0").humanGateStages).toEqual(["plan"]);
    expect(
      resolveWorkflowDefinition("guided@0.2.0").transitions.map((transition) => transition.command),
    ).toEqual(["task.questions.complete", "task.research.complete", "task.design.complete"]);
    expect(resolveWorkflowDefinition("guided@0.2.0").explicitEntryStages).toEqual([]);
    expect(resolveWorkflowDefinition("standard@0.2.0").transitions).toEqual([]);
    expect(resolveWorkflowDefinition("freeform@0.2.0").transitions).toEqual([]);
  });

  // Clients cannot execute a workflow, but they do render its rail. The legacy
  // preset catalog in shared is that display projection for @0.1.0 tasks; this
  // stops it drifting away from the definitions it claims to describe.
  it("keeps the shared legacy preset catalog in sync with the @0.1.0 definitions", () => {
    expect(TASK_WORKSPACE_PRESET_CATALOG.map((entry) => entry.preset)).toEqual([
      "standard",
      "guided",
      "freeform",
    ]);

    for (const entry of TASK_WORKSPACE_PRESET_CATALOG) {
      const definition = resolveWorkflowDefinition(entry.currentVersion);
      expect(entry.currentVersion).toBe(legacyVersionForPreset(entry.preset));
      expect(definition.preset).toBe(entry.preset);
      expect(entry.stages).toEqual(definition.stages);
      expect(entry.explicitEntryStages).toEqual(definition.explicitEntryStages);
      expect(entry.automaticCompletionStages).toEqual(
        definition.transitions
          .filter((transition) =>
            ["task.questions.complete", "task.research.complete", "task.design.complete"].includes(
              transition.command,
            ),
          )
          .map((transition) => transition.from),
      );
      expect(taskWorkspacePresetCatalogEntry(entry.preset)).toBe(entry);
    }
  });

  // The first-slice workflow catalog is the single source for @0.2.0+: every
  // catalog entry must project identically to its server definition and to the
  // version new tasks pin.
  it("keeps the first-slice workflow catalog in sync with server definitions and new creates", () => {
    for (const entry of TASK_WORKSPACE_WORKFLOW_CATALOG) {
      const definition = resolveWorkflowDefinition(entry.version);
      expect(definition.version).toBe(entry.version);
      expect(definition.promptBundleRef).toBe(entry.promptBundleVersion);
      expect(definition.initialStage).toBe(entry.initialStage);
      expect(definition.terminalStage).toBe(entry.terminalStage);
      expect(definition.availableInFirstSlice).toBe(entry.availableInFirstSlice);
      expect(definition.completionTransportRequired).toBe(entry.completionTransportRequired);
      expect(definition.stages).toEqual(entry.stages.map((stage) => stage.stage));
      expect(definition.autoAdvanceStages).toEqual(
        entry.stages.filter((stage) => stage.autoAdvance).map((stage) => stage.stage),
      );
      expect(definition.humanGateStages).toEqual(
        entry.stages.filter((stage) => stage.humanGate).map((stage) => stage.stage),
      );
      expect(definition.explicitEntryStages).toEqual(
        entry.stages.filter((stage) => stage.explicitEntry).map((stage) => stage.stage),
      );
      expect(definition.transitions).toEqual(entry.transitions);
      if (entry.version === currentVersionForPreset(entry.preset)) {
        expect(currentVersionForPreset(entry.preset)).toBe(entry.version);
      }
    }

    // Every @0.1.0 definition remains registered and unmodified.
    for (const version of ["standard@0.1.0", "guided@0.1.0", "freeform@0.1.0"]) {
      expect(BUILT_IN_WORKFLOW_DEFINITIONS.get(version)).toBeDefined();
    }
  });
});
