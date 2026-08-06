export const TASK_MODE_PROTOTYPE_STAGES = [
  "clarify",
  "research",
  "design",
  "plan",
  "implement",
  "verify",
  "done",
] as const;

export type TaskModePrototypeStageId = (typeof TASK_MODE_PROTOTYPE_STAGES)[number];
export type TaskModePrototypeStageStatus =
  | "completed"
  | "running"
  | "waiting"
  | "failed"
  | "historical"
  | "upcoming";

export type TaskModePrototypeMessage = {
  readonly id: string;
  readonly author: "user" | "agent";
  readonly body: string;
};

export type TaskModePrototypeOccurrence = {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly summary: string;
  readonly isCurrent: boolean;
};

export type TaskModePrototypeStage = {
  readonly id: TaskModePrototypeStageId;
  readonly label: string;
  readonly status: TaskModePrototypeStageStatus;
  readonly occurrenceLabel: string;
  readonly outcomeTitle: string;
  readonly outcomeSummary: string;
  readonly outcomeItems: readonly string[];
  readonly messages: readonly TaskModePrototypeMessage[];
  readonly occurrences: readonly TaskModePrototypeOccurrence[];
};

export type TaskModePrototypeScenarioId =
  | "design-running"
  | "inspect-research"
  | "plan-review"
  | "implement-checkpoint"
  | "branch-history"
  | "failed-stage";

export type TaskModePrototypeScenario = {
  readonly id: TaskModePrototypeScenarioId;
  readonly label: string;
  readonly description: string;
  readonly activeStageId: TaskModePrototypeStageId;
  readonly initialSelectedStageId: TaskModePrototypeStageId;
  readonly taskStatus: "working" | "waiting" | "blocked";
  readonly stages: readonly TaskModePrototypeStage[];
  readonly planReview?: {
    readonly summary: string;
  };
  readonly checkpoint?: {
    readonly title: string;
    readonly summary: string;
    readonly completedItems: number;
    readonly totalItems: number;
  };
  readonly failure?: {
    readonly title: string;
    readonly summary: string;
  };
};

const STAGE_LABELS: Record<TaskModePrototypeStageId, string> = {
  clarify: "Clarify",
  research: "Research",
  design: "Design",
  plan: "Plan",
  implement: "Implement",
  verify: "Verify",
  done: "Done",
};

const OUTCOMES: Record<
  TaskModePrototypeStageId,
  Pick<TaskModePrototypeStage, "outcomeTitle" | "outcomeSummary" | "outcomeItems">
> = {
  clarify: {
    outcomeTitle: "Problem framing",
    outcomeSummary:
      "The Task experience should feel like one durable workspace even though each stage gets fresh agent context.",
    outcomeItems: [
      "Keep fresh stage sessions for context quality.",
      "Remove stage sessions from peer chat navigation.",
      "Preserve an inspectable history of stage outcomes.",
    ],
  },
  research: {
    outcomeTitle: "Navigation findings",
    outcomeSummary:
      "The current split navigation makes sessions look independent from their owning Task and hides workflow context.",
    outcomeItems: [
      "The Task should own attention and navigation state.",
      "Viewing history must not interrupt active work.",
      "Stage outcome and stage conversation need distinct affordances.",
    ],
  },
  design: {
    outcomeTitle: "Task-first interaction model",
    outcomeSummary:
      "Treat the Task as the shell, distinguish active from viewed stages, and make earlier-stage revision explicit.",
    outcomeItems: [
      "Roll stage-session activity into one Task sidebar row.",
      "Keep a visible return path while inspecting history.",
      "Preview downstream impact before creating a new path.",
    ],
  },
  plan: {
    outcomeTitle: "UX implementation plan",
    outcomeSummary:
      "Prototype the current panel layout and a horizontal-stage workspace against the same fixture catalog.",
    outcomeItems: [
      "Build a dev-only full-shell Playground route.",
      "Compare both layouts at the same workflow states.",
      "Record UAT decisions before changing production contracts.",
    ],
  },
  implement: {
    outcomeTitle: "Prototype progress",
    outcomeSummary:
      "The fixture catalog and shared stage canvas are complete; interaction and responsive checks remain.",
    outcomeItems: [
      "Shared shell and Task-only sidebar complete.",
      "Current-layout refinement complete.",
      "Horizontal-stage workspace in review.",
    ],
  },
  verify: {
    outcomeTitle: "UX evidence",
    outcomeSummary:
      "Verification will capture comprehension, navigation, branch safety, and responsive behavior.",
    outcomeItems: [
      "Identify active and viewed stages without explanation.",
      "Inspect and return without changing workflow state.",
      "Understand branch consequences before confirmation.",
    ],
  },
  done: {
    outcomeTitle: "Decision record",
    outcomeSummary:
      "The accepted shell and rejected aspects will be recorded before runtime convergence resumes.",
    outcomeItems: [
      "Preferred layout recorded.",
      "Production child plan written.",
      "Runtime UX rebased.",
    ],
  },
};

function statusFor(
  stageId: TaskModePrototypeStageId,
  activeStageId: TaskModePrototypeStageId,
  activeStatus: TaskModePrototypeStageStatus,
): TaskModePrototypeStageStatus {
  const stageIndex = TASK_MODE_PROTOTYPE_STAGES.indexOf(stageId);
  const activeIndex = TASK_MODE_PROTOTYPE_STAGES.indexOf(activeStageId);
  if (stageIndex < activeIndex) return "completed";
  if (stageIndex > activeIndex) return "upcoming";
  return activeStatus;
}

function messagesFor(stageId: TaskModePrototypeStageId): readonly TaskModePrototypeMessage[] {
  const label = STAGE_LABELS[stageId];
  const outcome = OUTCOMES[stageId];
  return [
    {
      id: `${stageId}-user`,
      author: "user",
      body:
        stageId === "clarify"
          ? "The workflow feels fragmented. I lose the Task context when a new stage session appears in Chats."
          : `Continue the ${label} stage using the accepted outcomes from earlier stages.`,
    },
    {
      id: `${stageId}-agent`,
      author: "agent",
      body: `${outcome.outcomeSummary}\n\nI am keeping the durable Task as the authority while treating this conversation as the ${label} execution context.`,
    },
  ];
}

function buildStages(
  activeStageId: TaskModePrototypeStageId,
  activeStatus: TaskModePrototypeStageStatus,
  withDesignHistory = false,
): readonly TaskModePrototypeStage[] {
  return TASK_MODE_PROTOTYPE_STAGES.map((stageId) => {
    const outcome = OUTCOMES[stageId];
    const occurrences: readonly TaskModePrototypeOccurrence[] =
      stageId === "design" && withDesignHistory
        ? [
            {
              id: "design-v1",
              label: "Design v1",
              createdAt: "Earlier path",
              summary: "Persistent right panel with clearer hierarchy.",
              isCurrent: false,
            },
            {
              id: "design-v2",
              label: "Design v2",
              createdAt: "Current path",
              summary: "Horizontal stage rail with a collapsible inspector.",
              isCurrent: true,
            },
          ]
        : [
            {
              id: `${stageId}-v1`,
              label: `${STAGE_LABELS[stageId]} v1`,
              createdAt: "Current path",
              summary: outcome.outcomeSummary,
              isCurrent: true,
            },
          ];
    return {
      id: stageId,
      label: STAGE_LABELS[stageId],
      status: statusFor(stageId, activeStageId, activeStatus),
      occurrenceLabel:
        occurrences.find((occurrence) => occurrence.isCurrent)?.label ??
        `${STAGE_LABELS[stageId]} v1`,
      ...outcome,
      messages: messagesFor(stageId),
      occurrences,
    };
  });
}

function buildFailedDesignStages(): readonly TaskModePrototypeStage[] {
  return buildStages("design", "failed").map((stage) =>
    stage.id === "design"
      ? {
          ...stage,
          outcomeTitle: "No Design outcome",
          outcomeSummary:
            "The provider session stopped before publishing a durable Design outcome.",
          outcomeItems: [],
          messages: [
            {
              id: "design-user",
              author: "user" as const,
              body: "Continue the Design stage using the accepted Research outcome.",
            },
          ],
        }
      : stage,
  );
}

const SCENARIOS: Record<TaskModePrototypeScenarioId, TaskModePrototypeScenario> = {
  "design-running": {
    id: "design-running",
    label: "Design running",
    description: "Current work in Design with completed Clarify and Research outcomes.",
    activeStageId: "design",
    initialSelectedStageId: "design",
    taskStatus: "working",
    stages: buildStages("design", "running"),
  },
  "inspect-research": {
    id: "inspect-research",
    label: "Inspect history",
    description: "Research is selected while the current Design stage keeps running.",
    activeStageId: "design",
    initialSelectedStageId: "research",
    taskStatus: "working",
    stages: buildStages("design", "running"),
  },
  "plan-review": {
    id: "plan-review",
    label: "Plan review",
    description: "Plan output is ready for an explicit human approval decision.",
    activeStageId: "plan",
    initialSelectedStageId: "plan",
    taskStatus: "waiting",
    stages: buildStages("plan", "waiting"),
    planReview: {
      summary:
        "The plan keeps stage sessions internal, compares both shells using identical fixtures, and delays production contract changes until UAT.",
    },
  },
  "implement-checkpoint": {
    id: "implement-checkpoint",
    label: "Implement checkpoint",
    description: "Implementation is paused for review after the first prototype milestone.",
    activeStageId: "implement",
    initialSelectedStageId: "implement",
    taskStatus: "waiting",
    stages: buildStages("implement", "waiting"),
    checkpoint: {
      title: "Review navigation behavior",
      summary:
        "Confirm that Task-owned sessions stay out of Chats and that historical inspection keeps a clear return path.",
      completedItems: 3,
      totalItems: 5,
    },
  },
  "branch-history": {
    id: "branch-history",
    label: "Branch history",
    description: "Inspect an earlier Design outcome and preview creating a new active path.",
    activeStageId: "plan",
    initialSelectedStageId: "design",
    taskStatus: "waiting",
    stages: buildStages("plan", "waiting", true),
    planReview: {
      summary: "Plan v1 remains available if the user starts another Design occurrence.",
    },
  },
  "failed-stage": {
    id: "failed-stage",
    label: "Failed stage",
    description: "Design failed visibly and can be retried without losing prior outcomes.",
    activeStageId: "design",
    initialSelectedStageId: "design",
    taskStatus: "blocked",
    stages: buildFailedDesignStages(),
    failure: {
      title: "Design conversation stopped",
      summary:
        "The provider session ended before publishing a Design outcome. Clarify and Research remain available.",
    },
  },
};

export const TASK_MODE_PROTOTYPE_SCENARIO_IDS = Object.keys(
  SCENARIOS,
) as TaskModePrototypeScenarioId[];

export function listTaskModePrototypeScenarios(): readonly TaskModePrototypeScenario[] {
  return TASK_MODE_PROTOTYPE_SCENARIO_IDS.map((id) => SCENARIOS[id]);
}

export function getTaskModePrototypeScenario(
  id: TaskModePrototypeScenarioId,
): TaskModePrototypeScenario {
  return SCENARIOS[id];
}
