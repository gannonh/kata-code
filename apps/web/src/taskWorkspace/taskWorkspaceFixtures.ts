import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type TaskWorkspace,
  type TaskWorkspaceArtifact,
  type TaskWorkspaceSession,
  type TaskWorkspaceStage,
  type TaskWorkspaceStageOccurrence,
} from "@kata-sh/code-contracts";

const DEFAULT_TIMESTAMP = "2026-08-06T18:00:00.000Z";

/**
 * Task fixture builder shared by the task workspace unit and browser suites.
 *
 * Tests describe only the fields they assert on; everything else is a valid
 * default so a schema addition is fixed in one place instead of every suite.
 */
export function makeTaskWorkspace(overrides: Partial<TaskWorkspace> = {}): TaskWorkspace {
  const timestamp = overrides.updatedAt ?? DEFAULT_TIMESTAMP;
  return {
    id: "task-fixture",
    environmentId: EnvironmentId.make("environment-local"),
    title: "Refine Task mode UX",
    versions: {
      taskContract: "task-workspace@0.3.0",
      artifactContract: "task-artifact@0.3.0",
      workflowDefinition: "guided@0.3.0",
      prompt: "task-workspace-guided@0.3.0",
    },
    intake: { brief: "Refine the Task shell.", source: { kind: "inline", body: "" } },
    preferences: {
      worktreePolicy: "later",
      modelSelection: null,
      executionProfile: "planning",
      runtimeMode: "full-access",
    },
    bootstrap: null,
    occurrences: [],
    planGate: null,
    gateHistory: [],
    taskRevision: 0,
    workspace: {
      repositories: [
        {
          id: "primary",
          projectId: ProjectId.make("project-1"),
          workspaceRoot: "/repo/project",
          baseRef: "main",
          branch: "task/refine-task-mode-ux",
          worktreePath: null,
          provisioningStatus: "pending",
          baseCommitSha: null,
          planningRootFingerprint: null,
        },
      ],
    },
    workflowRuns: [
      {
        id: "guided-run-1",
        preset: "guided",
        definitionVersion: "guided@0.3.0",
        currentStage: "questions",
        approvalPolicy: "before-build",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    sessions: [],
    artifacts: [],
    comments: [],
    contextManifests: [],
    build: {
      phases: [],
      resultingCommitSha: null,
      activePhaseId: null,
      activeWorkItemId: null,
      checks: [],
      checkpoints: [],
      amendments: [],
      checkAttempts: [],
      currentPlanRevisionId: null,
      amendmentGateId: null,
      continuationSessionIds: [],
    },
    verification: { criteria: [], results: [], signedOffAt: null },
    sourceLinks: [],
    delivery: { state: "unavailable" },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

/** Puts the task's single workflow run into `stage`. */
export function atStage(task: TaskWorkspace, stage: TaskWorkspaceStage): TaskWorkspace {
  return {
    ...task,
    workflowRuns: task.workflowRuns.map((run, index) =>
      index === task.workflowRuns.length - 1 ? { ...run, currentStage: stage } : run,
    ),
  };
}

export function makeOccurrence(
  overrides: Partial<TaskWorkspaceStageOccurrence> & { readonly stage: TaskWorkspaceStage },
): TaskWorkspaceStageOccurrence {
  const ordinal = overrides.ordinal ?? 0;
  return {
    id: `${overrides.stage}-${ordinal}`,
    ordinal,
    status: "completed",
    sessionId: null,
    threadId: ThreadId.make(`thread-${overrides.stage}-${ordinal}`),
    contextManifestId: null,
    artifactRevisionId: null,
    completionProposalId: null,
    gateOutcome: null,
    feedback: null,
    supersedesOccurrenceId: null,
    createdAt: DEFAULT_TIMESTAMP,
    completedAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

export function makeSession(
  overrides: Partial<TaskWorkspaceSession> & { readonly threadId: ThreadId },
): TaskWorkspaceSession {
  return {
    id: `session-${overrides.threadId}`,
    stage: null,
    role: "primary",
    provider: null,
    status: "active",
    parentSessionId: null,
    contextManifestId: null,
    forkPoint: null,
    createdAt: DEFAULT_TIMESTAMP,
    ...overrides,
  };
}

/**
 * One artifact holding the given revisions. `currentRevision` defaults to the
 * last revision in the list.
 */
export function makeArtifact(input: {
  readonly kind: TaskWorkspaceArtifact["kind"];
  readonly revisions: ReadonlyArray<{
    readonly id: string;
    readonly revision: number;
    readonly title: string;
    readonly markdown: string;
  }>;
  readonly currentRevision?: number;
}): TaskWorkspaceArtifact {
  const revisions = input.revisions.map((revision) => ({
    id: revision.id,
    kind: input.kind,
    title: revision.title,
    markdown: revision.markdown,
    revision: revision.revision,
    sourceSessionId: null,
    supersedesRevisionId: null,
    blockIndex: [],
    createdAt: DEFAULT_TIMESTAMP,
  }));
  return {
    id: `artifact-${input.kind}`,
    kind: input.kind,
    currentRevision: input.currentRevision ?? revisions.at(-1)?.revision ?? 0,
    revisions,
  };
}
