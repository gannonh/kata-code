import type { TaskWorkspacePreset, TaskWorkspaceStage } from "@kata-sh/code-contracts";

export const TASK_WORKSPACE_STAGE_LABELS: Readonly<Record<TaskWorkspaceStage, string>> = {
  questions: "Questions",
  research: "Research",
  design: "Design",
  plan: "Plan",
  build: "Build",
  verify: "Verify",
  verified: "Verified",
};

export type TaskWorkspacePresetCatalogEntry = {
  readonly preset: TaskWorkspacePreset;
  readonly label: string;
  readonly description: string;
  readonly currentVersion: string;
  readonly stages: ReadonlyArray<TaskWorkspaceStage>;
  readonly explicitEntryStages: ReadonlyArray<TaskWorkspaceStage>;
  readonly automaticCompletionStages: ReadonlyArray<TaskWorkspaceStage>;
};

/**
 * Client projection of built-in workflow metadata and UI capabilities.
 *
 * Workflow behavior remains server-owned. This runtime projection belongs in
 * shared rather than the schema-only contracts package.
 */
export const TASK_WORKSPACE_PRESET_CATALOG: ReadonlyArray<TaskWorkspacePresetCatalogEntry> = [
  {
    preset: "standard",
    label: "Standard",
    description:
      "Questions, then Plan, Build, and Verify. Approval before Build. The default for well-understood work.",
    currentVersion: "standard@0.1.0",
    stages: ["questions", "plan", "build", "verify", "verified"],
    explicitEntryStages: [],
    automaticCompletionStages: ["questions"],
  },
  {
    preset: "guided",
    label: "Guided",
    description:
      "Adds Research and Design between Questions and Plan, each producing its own artifact and a budgeted context manifest for the next stage.",
    currentVersion: "guided@0.1.0",
    stages: ["questions", "research", "design", "plan", "build", "verify", "verified"],
    explicitEntryStages: [],
    automaticCompletionStages: ["questions", "research", "design"],
  },
  {
    preset: "freeform",
    label: "Freeform",
    description:
      "No automatic rail. Accumulate sessions and artifacts, then explicitly start a stage when you are ready. Converges on the usual Plan, Build, Verify path.",
    currentVersion: "freeform@0.1.0",
    stages: ["questions", "research", "design", "plan", "build", "verify", "verified"],
    explicitEntryStages: ["questions", "research", "design", "plan", "verify"],
    automaticCompletionStages: [],
  },
];

export function taskWorkspacePresetCatalogEntry(
  preset: TaskWorkspacePreset,
): TaskWorkspacePresetCatalogEntry {
  const entry = TASK_WORKSPACE_PRESET_CATALOG.find((candidate) => candidate.preset === preset);
  if (!entry) throw new Error(`No catalog entry for workflow preset '${preset}'.`);
  return entry;
}

export function taskWorkspaceCatalogEntryForVersion(
  definitionVersion: string,
): TaskWorkspacePresetCatalogEntry | null {
  return (
    TASK_WORKSPACE_PRESET_CATALOG.find(
      (candidate) => candidate.currentVersion === definitionVersion,
    ) ?? null
  );
}
