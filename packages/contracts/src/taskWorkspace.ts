import * as Effect from "effect/Effect";
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

// `research` and `design` are Guided-only reasoning stages (Slice 3b). The union is
// additive, so Slice 1 / Slice 2 events keep decoding unchanged.
export const TaskWorkspaceStage = Schema.Literals([
  "questions",
  "research",
  "design",
  "plan",
  "build",
  "verify",
  "verified",
]);
export type TaskWorkspaceStage = typeof TaskWorkspaceStage.Type;

// `summary` is written by context budgeting, not by a stage.
export const TaskWorkspaceArtifactKind = Schema.Literals([
  "questions",
  "research",
  "design",
  "plan",
  "verification",
  "summary",
]);
export type TaskWorkspaceArtifactKind = typeof TaskWorkspaceArtifactKind.Type;

export const TaskWorkspacePreset = Schema.Literals(["standard", "guided", "freeform"]);
export type TaskWorkspacePreset = typeof TaskWorkspacePreset.Type;

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

export const TaskWorkspaceSessionRole = Schema.Literals([
  "primary",
  "reviewer",
  "alternative",
  "debugging",
  "ad-hoc",
]);
export type TaskWorkspaceSessionRole = typeof TaskWorkspaceSessionRole.Type;

export const TaskWorkspaceSessionStatus = Schema.Literals(["active", "completed"]);
export type TaskWorkspaceSessionStatus = typeof TaskWorkspaceSessionStatus.Type;

export const TaskWorkspaceSession = Schema.Struct({
  id: TrimmedNonEmptyString,
  // `stage` remains as stored (required in Slice 1 events); new ad-hoc sessions store `null`.
  stage: Schema.NullOr(TaskWorkspaceStage),
  threadId: ThreadId,
  // Slice 1 replay defaults: missing role -> primary; status -> active; the rest -> null.
  role: TaskWorkspaceSessionRole.pipe(Schema.withDecodingDefault(Effect.succeed("primary"))),
  provider: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: TaskWorkspaceSessionStatus.pipe(Schema.withDecodingDefault(Effect.succeed("active"))),
  parentSessionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  forkPoint: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  contextManifestId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
});
export type TaskWorkspaceSession = typeof TaskWorkspaceSession.Type;

export const TaskWorkspaceBlockIndexEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  headingPath: Schema.Array(Schema.String),
  contentHash: TrimmedNonEmptyString,
});
export type TaskWorkspaceBlockIndexEntry = typeof TaskWorkspaceBlockIndexEntry.Type;

export const TaskWorkspaceArtifactRevision = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: TaskWorkspaceArtifactKind,
  title: TrimmedNonEmptyString,
  markdown: Schema.String,
  revision: NonNegativeInt,
  sourceSessionId: Schema.NullOr(TrimmedNonEmptyString),
  // Slice 2 lineage/block-index fields default absent for Slice 1 replay.
  supersedesRevisionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  blockIndex: Schema.Array(TaskWorkspaceBlockIndexEntry).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
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

export const TaskWorkspaceCommentAuthorKind = Schema.Literals(["user", "agent"]);
export type TaskWorkspaceCommentAuthorKind = typeof TaskWorkspaceCommentAuthorKind.Type;

export const TaskWorkspaceCommentAuthor = Schema.Struct({
  kind: TaskWorkspaceCommentAuthorKind,
  id: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
});
export type TaskWorkspaceCommentAuthor = typeof TaskWorkspaceCommentAuthor.Type;

export const TaskWorkspaceCommentMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  author: TaskWorkspaceCommentAuthor,
  body: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
});
export type TaskWorkspaceCommentMessage = typeof TaskWorkspaceCommentMessage.Type;

export const TaskWorkspaceCommentStatus = Schema.Literals([
  "open",
  "resolved",
  "outdated",
  "orphaned",
]);
export type TaskWorkspaceCommentStatus = typeof TaskWorkspaceCommentStatus.Type;

export const TaskWorkspaceCommentThread = Schema.Struct({
  id: TrimmedNonEmptyString,
  taskId: TaskWorkspaceId,
  artifactId: TrimmedNonEmptyString,
  anchorBlockId: TrimmedNonEmptyString,
  baseRevisionId: TrimmedNonEmptyString,
  status: TaskWorkspaceCommentStatus,
  messages: Schema.Array(TaskWorkspaceCommentMessage),
  createdAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  resolvedBy: Schema.NullOr(TaskWorkspaceCommentAuthor).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskWorkspaceCommentThread = typeof TaskWorkspaceCommentThread.Type;

export const TaskWorkspaceContextManifestArtifactRef = Schema.Struct({
  kind: TaskWorkspaceArtifactKind,
  revision: NonNegativeInt,
  blockIds: Schema.Array(TrimmedNonEmptyString),
});
export type TaskWorkspaceContextManifestArtifactRef =
  typeof TaskWorkspaceContextManifestArtifactRef.Type;

export const TaskWorkspaceContextManifest = Schema.Struct({
  id: TrimmedNonEmptyString,
  taskId: TaskWorkspaceId,
  sessionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  artifactRefs: Schema.Array(TaskWorkspaceContextManifestArtifactRef),
  notes: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // Slice 3b budgeting. Slice 2 manifests replay with a zero estimate, a null
  // budget (meaning "unbudgeted"), and no compression.
  tokenEstimate: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  budget: Schema.NullOr(NonNegativeInt).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // Set when the selection exceeded `budget` and was replaced by a summary.
  // `compressedBlockCount` is how many blocks the summary stands in for, so the
  // inspector can show the compression rather than silently hiding it.
  summaryArtifactRef: Schema.NullOr(TaskWorkspaceContextManifestArtifactRef).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  compressedBlockCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  createdAt: IsoDateTime,
});
export type TaskWorkspaceContextManifest = typeof TaskWorkspaceContextManifest.Type;

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
  // Pre-Slice-3b runs predate the preset union and are all Standard.
  preset: TaskWorkspacePreset.pipe(Schema.withDecodingDefault(Effect.succeed("standard"))),
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
  comments: Schema.Array(TaskWorkspaceCommentThread),
  contextManifests: Schema.Array(TaskWorkspaceContextManifest).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
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
  preset: TaskWorkspacePreset.pipe(Schema.withDecodingDefault(Effect.succeed("standard"))),
  approvalPolicy: Schema.Literal("before-build"),
});

const TaskSessionLinkCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.session.link"),
  // `stage` is `null` iff `role === "ad-hoc"`; the server enforces the stage gate.
  stage: Schema.NullOr(TaskWorkspaceStage),
  threadId: ThreadId,
  role: TaskWorkspaceSessionRole.pipe(Schema.withDecodingDefault(Effect.succeed("primary"))),
  contextManifestId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const TaskSessionForkCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.session.fork"),
  parentSessionId: TrimmedNonEmptyString,
  threadId: ThreadId,
  forkPoint: TrimmedNonEmptyString,
  role: TaskWorkspaceSessionRole,
  contextManifestId: TrimmedNonEmptyString,
  // `null` iff `role === "ad-hoc"`.
  stage: Schema.NullOr(TaskWorkspaceStage),
});

const TaskArtifactSelectRevisionCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.artifact.select-revision"),
  kind: TaskWorkspaceArtifactKind,
  revision: NonNegativeInt,
});

const TaskContextManifestCreateCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.context-manifest.create"),
  artifactRefs: Schema.Array(TaskWorkspaceContextManifestArtifactRef),
  notes: Schema.optional(Schema.NullOr(Schema.String)),
  sessionId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  // Omit to use the workflow's default budget; `null` opts out of budgeting.
  budget: Schema.optional(Schema.NullOr(NonNegativeInt)),
});

const TaskCommentCreateCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.comment.create"),
  artifactId: TrimmedNonEmptyString,
  anchorBlockId: TrimmedNonEmptyString,
  baseRevisionId: TrimmedNonEmptyString,
  author: TaskWorkspaceCommentAuthor,
  body: TrimmedNonEmptyString,
});

const TaskCommentReplyCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.comment.reply"),
  threadId: TrimmedNonEmptyString,
  author: TaskWorkspaceCommentAuthor,
  body: TrimmedNonEmptyString,
});

const TaskCommentResolveCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.comment.resolve"),
  threadId: TrimmedNonEmptyString,
  resolvedBy: TaskWorkspaceCommentAuthor,
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

// Guided reasoning-stage completions. These mirror the existing per-stage
// command style (`task.questions.complete`) rather than introducing a generic
// stage-completion command alongside it.
const TaskResearchCompleteCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.research.complete"),
});

const TaskDesignCompleteCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.design.complete"),
});

const TaskPlanApproveCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.plan.approve"),
});

/**
 * Explicitly enter a stage the workflow does not rail into.
 *
 * Freeform declares its stages as explicit-entry only, so this is how a
 * Freeform task reaches Plan or Verify. Guided and Standard reject it for any
 * stage their own transitions already cover.
 */
const TaskStageStartCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.stage.start"),
  stage: TaskWorkspaceStage,
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
  TaskSessionForkCommand,
  TaskArtifactUpsertCommand,
  TaskArtifactSelectRevisionCommand,
  TaskContextManifestCreateCommand,
  TaskCommentCreateCommand,
  TaskCommentReplyCommand,
  TaskCommentResolveCommand,
  TaskQuestionsCompleteCommand,
  TaskResearchCompleteCommand,
  TaskDesignCompleteCommand,
  TaskPlanApproveCommand,
  TaskStageStartCommand,
  TaskBuildWorkItemSetStatusCommand,
  TaskFixtureApplyCommand,
  TaskVerificationRunCommand,
  TaskVerificationSignoffCommand,
]);
export type TaskWorkspaceCommand = typeof TaskWorkspaceCommand.Type;

export const TaskWorkspaceEventType = Schema.Literals([
  "task.create",
  "task.session.link",
  "task.session.fork",
  "task.artifact.upsert",
  "task.artifact.select-revision",
  "task.context-manifest.create",
  "task.comment.create",
  "task.comment.reply",
  "task.comment.resolve",
  "task.questions.complete",
  "task.research.complete",
  "task.design.complete",
  "task.plan.approve",
  "task.stage.start",
  "task.build.work-item.set-status",
  "task.fixture.apply",
  "task.verification.run",
  "task.verification.signoff",
]);
export type TaskWorkspaceEventType = typeof TaskWorkspaceEventType.Type;

export const TaskWorkspaceEvent = Schema.Struct({
  sequence: NonNegativeInt,
  eventId: TrimmedNonEmptyString,
  commandId: CommandId,
  taskId: TaskWorkspaceId,
  type: TaskWorkspaceEventType,
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
