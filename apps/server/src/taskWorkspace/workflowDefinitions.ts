import type {
  TaskWorkspaceArtifactKind,
  TaskWorkspacePreset,
  TaskWorkspaceStage,
} from "@kata-sh/code-contracts";

/** Budget applied to a context manifest when the command does not name one. */
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 32_000;

/**
 * Command types that move a task from one workflow stage to another.
 *
 * Stage *guards* (for example `task.build.work-item.set-status`, which requires
 * `build` but does not leave it) are deliberately absent: only transitions are
 * table-driven, because only transitions encode workflow shape.
 */
export type WorkflowTransitionCommandType =
  | "task.questions.complete"
  | "task.research.complete"
  | "task.design.complete"
  | "task.plan.approve"
  | "task.fixture.apply"
  | "task.verification.signoff";

export type WorkflowStageTransition = {
  readonly command: WorkflowTransitionCommandType;
  readonly from: TaskWorkspaceStage;
  readonly to: TaskWorkspaceStage;
  /** Artifact kind that must exist at `from` before the transition is legal. */
  readonly requiresArtifact: TaskWorkspaceArtifactKind | null;
};

export type WorkflowDefinition = {
  readonly preset: TaskWorkspacePreset;
  /** Registry key, `"<preset>@<semver>"`. Pinned onto the task at creation. */
  readonly version: string;
  readonly initialStage: TaskWorkspaceStage;
  readonly terminalStage: TaskWorkspaceStage;
  readonly stages: ReadonlyArray<TaskWorkspaceStage>;
  /** Artifact kind a stage may write, or `null` where the stage writes none. */
  readonly stageArtifactKinds: Readonly<
    Partial<Record<TaskWorkspaceStage, TaskWorkspaceArtifactKind>>
  >;
  readonly transitions: ReadonlyArray<WorkflowStageTransition>;
  /**
   * Stages `task.stage.start` may enter directly.
   *
   * This is what gives Freeform a rail-less timeline without a special code
   * path: it declares explicit entries where Standard and Guided declare
   * transitions. Empty means the preset has no explicit entry points.
   */
  readonly explicitEntryStages: ReadonlyArray<TaskWorkspaceStage>;
  readonly approvalPolicy: "before-build";
  readonly promptBundleRef: string;
  /** Default token budget for context manifests created under this workflow. */
  readonly contextTokenBudget: number;
};

/**
 * Standard workflow, version 0.1.0.
 *
 * This table reproduces the transitions that Slice 1 and Slice 2 hardcoded in
 * the reducer. The Slice 1 / Slice 2 regression suite is the proof that it is
 * faithful: if a Standard test needs editing to accommodate the engine, the
 * table is wrong, not the test.
 */
export const STANDARD_WORKFLOW_V0_1_0: WorkflowDefinition = {
  preset: "standard",
  version: "standard@0.1.0",
  initialStage: "questions",
  terminalStage: "verified",
  stages: ["questions", "plan", "build", "verify", "verified"],
  stageArtifactKinds: {
    questions: "questions",
    plan: "plan",
    verify: "verification",
  },
  transitions: [
    {
      command: "task.questions.complete",
      from: "questions",
      to: "plan",
      requiresArtifact: "questions",
    },
    { command: "task.plan.approve", from: "plan", to: "build", requiresArtifact: "plan" },
    { command: "task.fixture.apply", from: "build", to: "verify", requiresArtifact: null },
    {
      command: "task.verification.signoff",
      from: "verify",
      to: "verified",
      requiresArtifact: null,
    },
  ],
  explicitEntryStages: [],
  approvalPolicy: "before-build",
  promptBundleRef: "task-workspace-slice-1@0.1.0",
  contextTokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET,
};

/**
 * Guided workflow, version 0.1.0.
 *
 * Adds the Research and Design reasoning stages between Questions and Plan.
 * Each reasoning stage writes its own artifact so the next stage can start
 * from a compact selection of blocks rather than the prior transcript.
 */
export const GUIDED_WORKFLOW_V0_1_0: WorkflowDefinition = {
  preset: "guided",
  version: "guided@0.1.0",
  initialStage: "questions",
  terminalStage: "verified",
  stages: ["questions", "research", "design", "plan", "build", "verify", "verified"],
  stageArtifactKinds: {
    questions: "questions",
    research: "research",
    design: "design",
    plan: "plan",
    verify: "verification",
  },
  transitions: [
    {
      command: "task.questions.complete",
      from: "questions",
      to: "research",
      requiresArtifact: "questions",
    },
    {
      command: "task.research.complete",
      from: "research",
      to: "design",
      requiresArtifact: "research",
    },
    { command: "task.design.complete", from: "design", to: "plan", requiresArtifact: "design" },
    { command: "task.plan.approve", from: "plan", to: "build", requiresArtifact: "plan" },
    { command: "task.fixture.apply", from: "build", to: "verify", requiresArtifact: null },
    {
      command: "task.verification.signoff",
      from: "verify",
      to: "verified",
      requiresArtifact: null,
    },
  ],
  explicitEntryStages: [],
  approvalPolicy: "before-build",
  promptBundleRef: "task-workspace-guided@0.1.0",
  contextTokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET,
};

/**
 * Freeform workflow, version 0.1.0.
 *
 * Declares no automatic transitions out of its initial stage: a Freeform task
 * accumulates sessions and artifacts until someone explicitly enters Plan or
 * Verify with `task.stage.start`. Once in Plan, the usual approve/build/verify
 * transitions apply, so Freeform converges on the same delivery path.
 */
export const FREEFORM_WORKFLOW_V0_1_0: WorkflowDefinition = {
  preset: "freeform",
  version: "freeform@0.1.0",
  initialStage: "questions",
  terminalStage: "verified",
  stages: ["questions", "research", "design", "plan", "build", "verify", "verified"],
  stageArtifactKinds: {
    questions: "questions",
    research: "research",
    design: "design",
    plan: "plan",
    verify: "verification",
  },
  transitions: [
    { command: "task.plan.approve", from: "plan", to: "build", requiresArtifact: "plan" },
    { command: "task.fixture.apply", from: "build", to: "verify", requiresArtifact: null },
    {
      command: "task.verification.signoff",
      from: "verify",
      to: "verified",
      requiresArtifact: null,
    },
  ],
  // `questions` is an explicit entry too, not just the initial stage: artifact
  // writes are gated on the current stage, so without a way back a Freeform task
  // could never amend its questions artifact after moving on. A preset whose
  // point is having no rail should not have a one-way door in it.
  explicitEntryStages: ["questions", "research", "design", "plan", "verify"],
  approvalPolicy: "before-build",
  promptBundleRef: "task-workspace-freeform@0.1.0",
  contextTokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET,
};

export type WorkflowDefinitionRegistry = ReadonlyMap<string, WorkflowDefinition>;

export function makeWorkflowDefinitionRegistry(
  definitions: ReadonlyArray<WorkflowDefinition>,
): WorkflowDefinitionRegistry {
  const entries = new Map<string, WorkflowDefinition>();
  for (const definition of definitions) {
    if (entries.has(definition.version)) {
      throw new Error(`Duplicate workflow definition version '${definition.version}'.`);
    }
    const stages = new Set(definition.stages);
    if (!stages.has(definition.initialStage)) {
      throw new Error(
        `Workflow definition '${definition.version}' has undeclared initial stage '${definition.initialStage}'.`,
      );
    }
    if (!stages.has(definition.terminalStage)) {
      throw new Error(
        `Workflow definition '${definition.version}' has undeclared terminal stage '${definition.terminalStage}'.`,
      );
    }
    for (const stage of Object.keys(definition.stageArtifactKinds)) {
      if (!stages.has(stage as TaskWorkspaceStage)) {
        throw new Error(
          `Workflow definition '${definition.version}' maps an artifact kind for undeclared stage '${stage}'.`,
        );
      }
    }
    const transitionCommands = new Set<WorkflowTransitionCommandType>();
    for (const transition of definition.transitions) {
      if (!stages.has(transition.from)) {
        throw new Error(
          `Workflow definition '${definition.version}' transition '${transition.command}' starts from undeclared stage '${transition.from}'.`,
        );
      }
      if (!stages.has(transition.to)) {
        throw new Error(
          `Workflow definition '${definition.version}' transition '${transition.command}' ends at undeclared stage '${transition.to}'.`,
        );
      }
      if (transitionCommands.has(transition.command)) {
        throw new Error(
          `Workflow definition '${definition.version}' declares duplicate transition command '${transition.command}'.`,
        );
      }
      transitionCommands.add(transition.command);
      if (transition.to === "build" && transition.command !== "task.plan.approve") {
        throw new Error(
          `Workflow definition '${definition.version}' enters Build through '${transition.command}', but only 'task.plan.approve' provisions the worktree.`,
        );
      }
    }
    entries.set(definition.version, definition);
  }
  return entries;
}

/**
 * Append-only registry of built-in workflow definitions.
 *
 * Superseded versions are never removed. A task pins `definitionVersion` at
 * creation and every later reducer decision resolves that exact key, so adding
 * a newer version of a preset cannot change how an existing task behaves.
 */
export const BUILT_IN_WORKFLOW_DEFINITIONS: WorkflowDefinitionRegistry =
  makeWorkflowDefinitionRegistry([
    STANDARD_WORKFLOW_V0_1_0,
    GUIDED_WORKFLOW_V0_1_0,
    FREEFORM_WORKFLOW_V0_1_0,
  ]);

/** The version new tasks pin when they select the Standard preset. */
export const CURRENT_STANDARD_WORKFLOW_VERSION = STANDARD_WORKFLOW_V0_1_0.version;

/** Version a newly created task pins for each preset. */
const CURRENT_VERSION_BY_PRESET: Readonly<Record<TaskWorkspacePreset, string>> = {
  standard: STANDARD_WORKFLOW_V0_1_0.version,
  guided: GUIDED_WORKFLOW_V0_1_0.version,
  freeform: FREEFORM_WORKFLOW_V0_1_0.version,
};

export function currentVersionForPreset(preset: TaskWorkspacePreset): string {
  return CURRENT_VERSION_BY_PRESET[preset];
}

export function allowsExplicitEntry(
  definition: WorkflowDefinition,
  stage: TaskWorkspaceStage,
): boolean {
  return definition.explicitEntryStages.includes(stage);
}

export function resolveWorkflowDefinition(
  version: string,
  registry: WorkflowDefinitionRegistry = BUILT_IN_WORKFLOW_DEFINITIONS,
): WorkflowDefinition {
  const definition = registry.get(version);
  if (!definition) {
    throw new Error(
      `Workflow definition '${version}' is not registered. A task pinned to a definition that this build no longer ships cannot be advanced.`,
    );
  }
  return definition;
}

export function transitionFor(
  definition: WorkflowDefinition,
  command: WorkflowTransitionCommandType,
): WorkflowStageTransition | null {
  return definition.transitions.find((transition) => transition.command === command) ?? null;
}

export function artifactKindForStage(
  definition: WorkflowDefinition,
  stage: TaskWorkspaceStage,
): TaskWorkspaceArtifactKind | null {
  return definition.stageArtifactKinds[stage] ?? null;
}
