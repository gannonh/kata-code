import * as Schema from "effect/Schema";

import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const TASK_WORKSPACE_WS_METHODS = {
  dispatchCommand: "taskWorkspace.dispatchCommand",
  subscribe: "taskWorkspace.subscribe",
} as const;

export const TaskWorkspaceId = TrimmedNonEmptyString;
export type TaskWorkspaceId = typeof TaskWorkspaceId.Type;

export const TaskWorkspaceStage = Schema.Literals([
  "questions",
  "plan",
  "build",
  "verify",
  "verified",
]);
export type TaskWorkspaceStage = typeof TaskWorkspaceStage.Type;

export const TaskWorkspaceArtifactKind = Schema.Literals(["questions", "plan", "verification"]);
export type TaskWorkspaceArtifactKind = typeof TaskWorkspaceArtifactKind.Type;

export const TaskWorkspaceWorkStatus = Schema.Literals(["pending", "running", "completed"]);
export type TaskWorkspaceWorkStatus = typeof TaskWorkspaceWorkStatus.Type;

export const TaskWorkspaceRepository = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  provisioningStatus: Schema.Literals(["pending", "provisioned", "failed"]),
});
export type TaskWorkspaceRepository = typeof TaskWorkspaceRepository.Type;

export const TaskWorkspaceSession = Schema.Struct({
  id: TrimmedNonEmptyString,
  stage: TaskWorkspaceStage,
  threadId: ThreadId,
  createdAt: IsoDateTime,
});
export type TaskWorkspaceSession = typeof TaskWorkspaceSession.Type;

export const TaskWorkspaceArtifactRevision = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: TaskWorkspaceArtifactKind,
  title: TrimmedNonEmptyString,
  markdown: Schema.String,
  revision: NonNegativeInt,
  sourceSessionId: Schema.NullOr(TrimmedNonEmptyString),
  createdAt: IsoDateTime,
});
export type TaskWorkspaceArtifactRevision = typeof TaskWorkspaceArtifactRevision.Type;

export const TaskWorkspaceArtifact = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: TaskWorkspaceArtifactKind,
  currentRevision: NonNegativeInt,
  revisions: Schema.Array(TaskWorkspaceArtifactRevision),
});
export type TaskWorkspaceArtifact = typeof TaskWorkspaceArtifact.Type;

export const TaskWorkspaceWorkItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TaskWorkspaceWorkStatus,
  summary: Schema.NullOr(Schema.String),
});
export type TaskWorkspaceWorkItem = typeof TaskWorkspaceWorkItem.Type;

export const TaskWorkspaceBuildPhase = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TaskWorkspaceWorkStatus,
  workItems: Schema.Array(TaskWorkspaceWorkItem),
});
export type TaskWorkspaceBuildPhase = typeof TaskWorkspaceBuildPhase.Type;

export const TaskWorkspaceCriterion = Schema.Struct({
  id: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
});
export type TaskWorkspaceCriterion = typeof TaskWorkspaceCriterion.Type;

export const TaskWorkspaceVerificationResult = Schema.Struct({
  id: TrimmedNonEmptyString,
  criterionId: TrimmedNonEmptyString,
  status: Schema.Literals(["pass", "fail"]),
  commitSha: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  verifiedAt: IsoDateTime,
});
export type TaskWorkspaceVerificationResult = typeof TaskWorkspaceVerificationResult.Type;

export const TaskWorkspaceWorkflowRun = Schema.Struct({
  id: TrimmedNonEmptyString,
  preset: Schema.Literal("standard"),
  definitionVersion: TrimmedNonEmptyString,
  currentStage: TaskWorkspaceStage,
  approvalPolicy: Schema.Literal("before-build"),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskWorkspaceWorkflowRun = typeof TaskWorkspaceWorkflowRun.Type;

export const TaskWorkspace = Schema.Struct({
  id: TaskWorkspaceId,
  title: TrimmedNonEmptyString,
  versions: Schema.Struct({
    taskContract: TrimmedNonEmptyString,
    artifactContract: TrimmedNonEmptyString,
    workflowDefinition: TrimmedNonEmptyString,
    prompt: TrimmedNonEmptyString,
  }),
  workspace: Schema.Struct({
    repositories: Schema.Array(TaskWorkspaceRepository),
  }),
  workflowRuns: Schema.Array(TaskWorkspaceWorkflowRun),
  sessions: Schema.Array(TaskWorkspaceSession),
  artifacts: Schema.Array(TaskWorkspaceArtifact),
  comments: Schema.Array(Schema.Unknown),
  build: Schema.Struct({
    phases: Schema.Array(TaskWorkspaceBuildPhase),
    resultingCommitSha: Schema.NullOr(TrimmedNonEmptyString),
  }),
  verification: Schema.Struct({
    criteria: Schema.Array(TaskWorkspaceCriterion),
    results: Schema.Array(TaskWorkspaceVerificationResult),
    signedOffAt: Schema.NullOr(IsoDateTime),
  }),
  sourceLinks: Schema.Array(Schema.Unknown),
  delivery: Schema.Struct({
    state: Schema.Literals(["unavailable", "ready"]),
  }),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskWorkspace = typeof TaskWorkspace.Type;

const TaskCommandBase = {
  commandId: CommandId,
  taskId: TaskWorkspaceId,
  createdAt: IsoDateTime,
} as const;

const TaskCreateCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.create"),
  title: TrimmedNonEmptyString,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  preset: Schema.Literal("standard"),
  approvalPolicy: Schema.Literal("before-build"),
});

const TaskSessionLinkCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.session.link"),
  stage: TaskWorkspaceStage,
  threadId: ThreadId,
});

const TaskArtifactUpsertCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.artifact.upsert"),
  kind: TaskWorkspaceArtifactKind,
  title: TrimmedNonEmptyString,
  markdown: Schema.String,
  sourceSessionId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const TaskQuestionsCompleteCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.questions.complete"),
});

const TaskPlanApproveCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.plan.approve"),
});

const TaskBuildWorkItemSetStatusCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.build.work-item.set-status"),
  workItemId: TrimmedNonEmptyString,
  status: Schema.Literals(["pending", "running"]),
});

const TaskFixtureApplyCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.fixture.apply"),
});

const TaskVerificationRunCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.verification.run"),
  criterionId: TrimmedNonEmptyString,
});

const TaskVerificationSignoffCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.verification.signoff"),
});

export const TaskWorkspaceCommand = Schema.Union([
  TaskCreateCommand,
  TaskSessionLinkCommand,
  TaskArtifactUpsertCommand,
  TaskQuestionsCompleteCommand,
  TaskPlanApproveCommand,
  TaskBuildWorkItemSetStatusCommand,
  TaskFixtureApplyCommand,
  TaskVerificationRunCommand,
  TaskVerificationSignoffCommand,
]);
export type TaskWorkspaceCommand = typeof TaskWorkspaceCommand.Type;

export const TaskWorkspaceEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: TrimmedNonEmptyString,
  commandId: CommandId,
  taskId: TaskWorkspaceId,
  type: TrimmedNonEmptyString,
  occurredAt: IsoDateTime,
  task: TaskWorkspace,
});
export type TaskWorkspaceEvent = typeof TaskWorkspaceEvent.Type;

export const TaskWorkspaceSnapshot = Schema.Struct({
  sequence: NonNegativeInt,
  tasks: Schema.Array(TaskWorkspace),
});
export type TaskWorkspaceSnapshot = typeof TaskWorkspaceSnapshot.Type;

export const TaskWorkspaceStreamItem = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    snapshot: TaskWorkspaceSnapshot,
  }),
  Schema.Struct({
    kind: Schema.Literal("task-upserted"),
    sequence: NonNegativeInt,
    task: TaskWorkspace,
  }),
]);
export type TaskWorkspaceStreamItem = typeof TaskWorkspaceStreamItem.Type;

export const TaskWorkspaceDispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
  task: TaskWorkspace,
});
export type TaskWorkspaceDispatchResult = typeof TaskWorkspaceDispatchResult.Type;

export class TaskWorkspaceError extends Schema.TaggedErrorClass<TaskWorkspaceError>()(
  "TaskWorkspaceError",
  {
    message: TrimmedNonEmptyString,
    commandType: Schema.optional(TrimmedNonEmptyString),
    taskId: Schema.optional(TaskWorkspaceId),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
