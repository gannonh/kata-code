import { describe, expect, it } from "@effect/vitest";

import {
  artifactKindForStage,
  BUILT_IN_WORKFLOW_DEFINITIONS,
  CURRENT_STANDARD_WORKFLOW_VERSION,
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
    { command: "task.questions.complete", from: "questions", to: "build", requiresArtifact: null },
    ...STANDARD_WORKFLOW_V0_1_0.transitions.filter(
      (transition) => transition.command !== "task.questions.complete",
    ),
  ],
};

describe("workflowDefinitions", () => {
  it("ships Standard 0.1.0 as the version new tasks pin", () => {
    expect(CURRENT_STANDARD_WORKFLOW_VERSION).toBe("standard@0.1.0");
    expect(resolveWorkflowDefinition(CURRENT_STANDARD_WORKFLOW_VERSION)).toBe(
      STANDARD_WORKFLOW_V0_1_0,
    );
    expect(BUILT_IN_WORKFLOW_DEFINITIONS.get("standard@0.1.0")).toBe(STANDARD_WORKFLOW_V0_1_0);
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
    expect(transitionFor(latest, "task.questions.complete")?.to).toBe("build");
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

  it("returns null for a transition the definition does not declare", () => {
    expect(transitionFor(STANDARD_WORKFLOW_V0_1_0, "task.plan.approve")).not.toBeNull();
    expect(
      transitionFor({ ...STANDARD_WORKFLOW_V0_1_0, transitions: [] }, "task.plan.approve"),
    ).toBeNull();
  });
});
