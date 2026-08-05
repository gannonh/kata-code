import type {
  TaskWorkspaceArtifactKind,
  TaskWorkspacePreset,
  TaskWorkspaceStage,
} from "@kata-sh/code-contracts";

/**
 * Presentation vocabulary for the task workflow reset. Stored stage values
 * stay `questions | research | design | plan | build | verify | verified`;
 * this map supplies the product-facing labels.
 */
export const TASK_WORKSPACE_STAGE_PRESENTATION: Readonly<Record<TaskWorkspaceStage, string>> = {
  questions: "Clarify",
  research: "Research",
  design: "Design",
  plan: "Plan",
  build: "Implement",
  verify: "Verify",
  verified: "Done",
};

export const TASK_WORKSPACE_ARTIFACT_PRESENTATION: Readonly<
  Partial<Record<TaskWorkspaceArtifactKind, string>>
> = {
  questions: "Clarification",
  plan: "Plan",
  verification: "Verification",
  // `summary` stays internal; amendments remain internal tooling.
};

export type TaskWorkspaceStageCapabilityStatus = "available" | "preview" | "deferred";

export type TaskWorkspaceTransitionCommand =
  | "task.questions.complete"
  | "task.research.complete"
  | "task.design.complete"
  | "task.plan.approve"
  | "task.fixture.apply"
  | "task.verification.signoff";

export type TaskWorkspaceCatalogStage = {
  readonly stage: TaskWorkspaceStage;
  readonly presentation: string;
  readonly status: TaskWorkspaceStageCapabilityStatus;
  readonly artifactKind: TaskWorkspaceArtifactKind | null;
  /** The stage advances automatically when its completion is committed. */
  readonly autoAdvance: boolean;
  /** Completion opens a human approval gate instead of advancing. */
  readonly humanGate: boolean;
  /** The stage can be entered explicitly via `task.stage.start`. */
  readonly explicitEntry: boolean;
};

export type TaskWorkspaceCatalogTransition = {
  readonly command: TaskWorkspaceTransitionCommand;
  readonly from: TaskWorkspaceStage;
  readonly to: TaskWorkspaceStage;
  readonly requiresArtifact: TaskWorkspaceArtifactKind | null;
};

/**
 * One versioned built-in workflow catalog entry. The same entry feeds the
 * server's compiled transitions and the web's capability labels, so a parity
 * test can reject any projection that drifts.
 */
export type TaskWorkspaceCatalogEntry = {
  readonly preset: TaskWorkspacePreset;
  /** Registry key, `"<preset>@<semver>"`. Pinned onto the task at creation. */
  readonly version: string;
  readonly promptBundleVersion: string;
  readonly label: string;
  readonly description: string;
  /** True when the template is complete through approved Plan in this slice. */
  readonly availableInFirstSlice: boolean;
  /** True when Guided selection requires a provider task-stage bridge. */
  readonly completionTransportRequired: boolean;
  readonly initialStage: TaskWorkspaceStage;
  readonly terminalStage: TaskWorkspaceStage;
  readonly stages: ReadonlyArray<TaskWorkspaceCatalogStage>;
  readonly transitions: ReadonlyArray<TaskWorkspaceCatalogTransition>;
  readonly contextTokenBudget: number;
};

export const TASK_WORKSPACE_GUIDED_CATALOG_ENTRY_V0_2_0: TaskWorkspaceCatalogEntry = {
  preset: "guided",
  version: "guided@0.2.0",
  promptBundleVersion: "task-workspace-guided@0.2.0",
  label: "Guided",
  description:
    "Discover, research, and design before planning. Kata runs Clarify, Research, and Design conversations automatically and pauses at the Plan for your approval.",
  availableInFirstSlice: true,
  completionTransportRequired: true,
  initialStage: "questions",
  terminalStage: "verified",
  stages: [
    {
      stage: "questions",
      presentation: "Clarify",
      status: "available",
      artifactKind: "questions",
      autoAdvance: true,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "research",
      presentation: "Research",
      status: "available",
      artifactKind: "research",
      autoAdvance: true,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "design",
      presentation: "Design",
      status: "available",
      artifactKind: "design",
      autoAdvance: true,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "plan",
      presentation: "Plan",
      status: "available",
      artifactKind: "plan",
      autoAdvance: false,
      humanGate: true,
      explicitEntry: false,
    },
    {
      stage: "build",
      presentation: "Implement",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "verify",
      presentation: "Verify",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "verified",
      presentation: "Done",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
  ],
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
    {
      command: "task.design.complete",
      from: "design",
      to: "plan",
      requiresArtifact: "design",
    },
  ],
  contextTokenBudget: 32_000,
};

export const TASK_WORKSPACE_GUIDED_CATALOG_ENTRY_V0_3_0: TaskWorkspaceCatalogEntry = {
  ...TASK_WORKSPACE_GUIDED_CATALOG_ENTRY_V0_2_0,
  version: "guided@0.3.0",
  promptBundleVersion: "task-workspace-guided@0.3.0",
  description:
    "Discover, research, and design before planning, then implement the approved Plan in the managed task worktree.",
  stages: TASK_WORKSPACE_GUIDED_CATALOG_ENTRY_V0_2_0.stages.map((stage) =>
    stage.stage === "build" ? { ...stage, status: "available", explicitEntry: false } : stage,
  ),
  transitions: [
    ...TASK_WORKSPACE_GUIDED_CATALOG_ENTRY_V0_2_0.transitions,
    { command: "task.plan.approve", from: "plan", to: "build", requiresArtifact: "plan" },
  ],
};

export const TASK_WORKSPACE_STANDARD_CATALOG_ENTRY_V0_2_0: TaskWorkspaceCatalogEntry = {
  preset: "standard",
  version: "standard@0.2.0",
  promptBundleVersion: "task-workspace-standard@0.2.0",
  label: "Standard",
  description:
    "A single conversation shell for well-understood work. Automatic Clarify completion and the Plan, Implement, Verify stages arrive with the Standard slice.",
  availableInFirstSlice: false,
  completionTransportRequired: false,
  initialStage: "questions",
  terminalStage: "verified",
  stages: [
    {
      stage: "questions",
      presentation: "Clarify",
      status: "preview",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "plan",
      presentation: "Plan",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "build",
      presentation: "Implement",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "verify",
      presentation: "Verify",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "verified",
      presentation: "Done",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
  ],
  transitions: [],
  contextTokenBudget: 32_000,
};

export const TASK_WORKSPACE_FREEFORM_CATALOG_ENTRY_V0_2_0: TaskWorkspaceCatalogEntry = {
  preset: "freeform",
  version: "freeform@0.2.0",
  promptBundleVersion: "task-workspace-freeform@0.2.0",
  label: "Freeform",
  description:
    "A task-owned conversation without a required stage rail. Explicit stage entry and structured artifact actions arrive with the Freeform slice.",
  availableInFirstSlice: false,
  completionTransportRequired: false,
  initialStage: "questions",
  terminalStage: "verified",
  stages: [
    {
      stage: "questions",
      presentation: "Clarify",
      status: "preview",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "research",
      presentation: "Research",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "design",
      presentation: "Design",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "plan",
      presentation: "Plan",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "build",
      presentation: "Implement",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "verify",
      presentation: "Verify",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
    {
      stage: "verified",
      presentation: "Done",
      status: "deferred",
      artifactKind: null,
      autoAdvance: false,
      humanGate: false,
      explicitEntry: false,
    },
  ],
  transitions: [],
  contextTokenBudget: 32_000,
};

/**
 * Versioned built-in workflow catalog. New versions are appended, never edited
 * in place; a task's pinned version keeps resolving the same entry.
 */
export const TASK_WORKSPACE_WORKFLOW_CATALOG: ReadonlyArray<TaskWorkspaceCatalogEntry> = [
  TASK_WORKSPACE_GUIDED_CATALOG_ENTRY_V0_3_0,
  TASK_WORKSPACE_GUIDED_CATALOG_ENTRY_V0_2_0,
  TASK_WORKSPACE_STANDARD_CATALOG_ENTRY_V0_2_0,
  TASK_WORKSPACE_FREEFORM_CATALOG_ENTRY_V0_2_0,
];

export function taskWorkspaceCatalogEntryForVersion(
  version: string,
): TaskWorkspaceCatalogEntry | null {
  return TASK_WORKSPACE_WORKFLOW_CATALOG.find((entry) => entry.version === version) ?? null;
}

/** The catalog entry new tasks pin when they select a preset. */
export function currentCatalogEntryForPreset(
  preset: TaskWorkspacePreset,
): TaskWorkspaceCatalogEntry {
  const entry = TASK_WORKSPACE_WORKFLOW_CATALOG.find((candidate) => candidate.preset === preset);
  if (!entry) {
    throw new Error(`No catalog entry for workflow preset '${preset}'.`);
  }
  return entry;
}
