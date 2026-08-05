import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./orchestration.ts";

/**
 * Hard ceiling for an inline task brief. The server enforces this below the
 * existing 120,000-character turn limit so the first kickoff turn always fits.
 */
export const TASK_BRIEF_MAX_CHARS = 100_000;

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
  "amendment",
]);
export type TaskWorkspaceArtifactKind = typeof TaskWorkspaceArtifactKind.Type;

export const TaskWorkspacePreset = Schema.Literals(["standard", "guided", "freeform"]);
export type TaskWorkspacePreset = typeof TaskWorkspacePreset.Type;

/**
 * Worktree timing preference captured at creation and applied after Plan
 * approval. `never` keeps the planning slice in the source repository.
 */
export const TaskWorkspaceWorktreePolicy = Schema.Literals(["now", "later", "never"]);
export type TaskWorkspaceWorktreePolicy = typeof TaskWorkspaceWorktreePolicy.Type;

/**
 * Enforced execution profile for pre-Implement stages. Only `planning` exists
 * in this slice; it forbids write effects during Clarify, Research, Design, and
 * Plan.
 */
export const TaskWorkspaceExecutionProfile = Schema.Literals(["planning", "task-worktree-write"]);
export type TaskWorkspaceExecutionProfile = typeof TaskWorkspaceExecutionProfile.Type;

/** Canonical repository provisioning status; `provisioned` stays decode-only. */
export const TaskWorkspaceProvisioningStatus = Schema.Literals([
  "not-requested",
  "pending",
  "running",
  "ready",
  "failed",
  "provisioned",
]);
export type TaskWorkspaceProvisioningStatus = typeof TaskWorkspaceProvisioningStatus.Type;

export const TaskWorkspaceIntakeSource = Schema.Struct({
  kind: Schema.Literal("inline"),
  body: Schema.String,
});
export type TaskWorkspaceIntakeSource = typeof TaskWorkspaceIntakeSource.Type;

export const TaskWorkspaceIntake = Schema.Struct({
  brief: Schema.String,
  source: TaskWorkspaceIntakeSource,
});
export type TaskWorkspaceIntake = typeof TaskWorkspaceIntake.Type;

export const TaskWorkspacePreferences = Schema.Struct({
  worktreePolicy: TaskWorkspaceWorktreePolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("later")),
  ),
  modelSelection: Schema.NullOr(ModelSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  executionProfile: TaskWorkspaceExecutionProfile.pipe(
    Schema.withDecodingDefault(Effect.succeed("planning")),
  ),
});
export type TaskWorkspacePreferences = typeof TaskWorkspacePreferences.Type;

export const TaskWorkspaceBootstrapStatus = Schema.Literals([
  "pending",
  "running",
  "ready",
  "failed",
]);
export type TaskWorkspaceBootstrapStatus = typeof TaskWorkspaceBootstrapStatus.Type;

export const TaskWorkspaceBootstrapFailure = Schema.Struct({
  step: TrimmedNonEmptyString,
  message: Schema.String,
  occurredAt: IsoDateTime,
});
export type TaskWorkspaceBootstrapFailure = typeof TaskWorkspaceBootstrapFailure.Type;

export const TaskWorkspaceBootstrapConversationTarget = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type TaskWorkspaceBootstrapConversationTarget =
  typeof TaskWorkspaceBootstrapConversationTarget.Type;

/**
 * Durable bootstrap state for the current primary session. Reserved external
 * identities live here so a restart worker can reconcile each target before
 * retrying without allocating a second session or occurrence.
 */
export const TaskWorkspaceBootstrapState = Schema.Struct({
  operationKey: TrimmedNonEmptyString,
  executionProfile: TaskWorkspaceExecutionProfile.pipe(
    Schema.withDecodingDefault(Effect.succeed("planning")),
  ),
  presentation: TrimmedNonEmptyString.pipe(Schema.withDecodingDefault(Effect.succeed("stage"))),
  status: TaskWorkspaceBootstrapStatus,
  currentStep: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  reservedSessionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  reservedThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  threadCreateCommandId: Schema.NullOr(CommandId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  turnStartCommandId: Schema.NullOr(CommandId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  kickoffMessageId: Schema.NullOr(MessageId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  conversationTarget: Schema.NullOr(TaskWorkspaceBootstrapConversationTarget).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  attemptCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  failure: Schema.NullOr(TaskWorkspaceBootstrapFailure).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  updatedAt: IsoDateTime,
});
export type TaskWorkspaceBootstrapState = typeof TaskWorkspaceBootstrapState.Type;

/**
 * Stage occurrence status. `changes-requested` is a Plan gate outcome, not an
 * occurrence status.
 */
export const TaskWorkspaceOccurrenceStatus = Schema.Literals([
  "starting",
  "running",
  "finalizing",
  "awaiting-approval",
  "blocked",
  "completed",
  "failed",
]);
export type TaskWorkspaceOccurrenceStatus = typeof TaskWorkspaceOccurrenceStatus.Type;

/**
 * One repeatable occurrence of a workflow stage. Ordinals start at zero and
 * every new occurrence allocates `1 + max(recorded occurrences for that stage)`.
 */
export const TaskWorkspaceStageOccurrence = Schema.Struct({
  id: TrimmedNonEmptyString,
  stage: TaskWorkspaceStage,
  ordinal: NonNegativeInt,
  status: TaskWorkspaceOccurrenceStatus,
  sessionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  threadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  contextManifestId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  artifactRevisionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  completionProposalId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  gateOutcome: Schema.NullOr(Schema.Literals(["approved", "changes-requested"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  feedback: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  supersedesOccurrenceId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskWorkspaceStageOccurrence = typeof TaskWorkspaceStageOccurrence.Type;

export const TaskWorkspaceGateOutcome = Schema.Struct({
  occurrence: NonNegativeInt,
  revision: NonNegativeInt,
  outcome: Schema.Literals(["approved", "changes-requested"]),
  feedback: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  actor: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  resolvedAt: IsoDateTime,
});
export type TaskWorkspaceGateOutcome = typeof TaskWorkspaceGateOutcome.Type;

/**
 * Active Plan approval gate. Repeatable across requested revisions; approval
 * succeeds only for the current open occurrence and revision.
 */
export const TaskWorkspacePlanGate = Schema.Struct({
  occurrence: NonNegativeInt,
  revision: NonNegativeInt,
  status: Schema.Literals(["open", "approved", "changes-requested"]),
  feedback: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  openedAt: IsoDateTime,
  resolvedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskWorkspacePlanGate = typeof TaskWorkspacePlanGate.Type;

export const TaskWorkspaceWorkStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "blocked",
  "invalidated",
]);
export type TaskWorkspaceWorkStatus = typeof TaskWorkspaceWorkStatus.Type;

export const TaskWorkspaceCheckpointPolicy = Schema.Literals([
  "always",
  "manual-only",
  "on-failure",
  "never",
]);
export type TaskWorkspaceCheckpointPolicy = typeof TaskWorkspaceCheckpointPolicy.Type;

export const TaskWorkspaceBuildCheckKind = Schema.Literals(["automated", "manual"]);
export type TaskWorkspaceBuildCheckKind = typeof TaskWorkspaceBuildCheckKind.Type;

export const TaskWorkspaceBuildCheckStatus = Schema.Literals([
  "pending",
  "running",
  "pass",
  "fail",
  "blocked",
  "stale",
  "indeterminate",
]);
export type TaskWorkspaceBuildCheckStatus = typeof TaskWorkspaceBuildCheckStatus.Type;

export const TaskWorkspaceBuildCheck = Schema.Struct({
  id: TrimmedNonEmptyString,
  phaseId: TrimmedNonEmptyString,
  workItemId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  kind: TaskWorkspaceBuildCheckKind,
  status: TaskWorkspaceBuildCheckStatus,
  label: TrimmedNonEmptyString,
  command: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  output: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  note: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  exitCode: Schema.NullOr(Schema.Int).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  commitSha: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  startedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  // Slice 2 check-attempt lineage. Legacy Build checks decode with no attempts.
  attemptIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type TaskWorkspaceBuildCheck = typeof TaskWorkspaceBuildCheck.Type;

export const TaskWorkspaceCheckAttemptStatus = Schema.Literals([
  "pending",
  "running",
  "pass",
  "fail",
  "stale",
  "indeterminate",
]);
export type TaskWorkspaceCheckAttemptStatus = typeof TaskWorkspaceCheckAttemptStatus.Type;

export const TaskWorkspaceCheckAttempt = Schema.Struct({
  id: TrimmedNonEmptyString,
  checkId: TrimmedNonEmptyString,
  planRevisionId: TrimmedNonEmptyString,
  startingCommitSha: TrimmedNonEmptyString,
  commandDigest: TrimmedNonEmptyString,
  operationKey: TrimmedNonEmptyString,
  status: TaskWorkspaceCheckAttemptStatus,
  output: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  exitCode: Schema.NullOr(Schema.Int).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  timeoutMs: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  observedStatus: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  startedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  endingCommitSha: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskWorkspaceCheckAttempt = typeof TaskWorkspaceCheckAttempt.Type;

export const TaskWorkspaceCheckpointStatus = Schema.Literals(["waiting", "continued"]);
export type TaskWorkspaceCheckpointStatus = typeof TaskWorkspaceCheckpointStatus.Type;

export const TaskWorkspaceBuildCheckpoint = Schema.Struct({
  id: TrimmedNonEmptyString,
  phaseId: TrimmedNonEmptyString,
  reason: TrimmedNonEmptyString,
  status: TaskWorkspaceCheckpointStatus,
  checkIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  continuationSessionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  // Set when a checkpoint-specific continuation context has been prepared.
  // Older checkpoints decode with no associated manifest.
  contextManifestId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  // Exact worktree commit observed when this checkpoint was created.
  observedCommitSha: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  continuedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskWorkspaceBuildCheckpoint = typeof TaskWorkspaceBuildCheckpoint.Type;

export const TaskWorkspaceAmendmentStatus = Schema.Literals([
  "requested",
  "approved",
  "changes-requested",
]);
export type TaskWorkspaceAmendmentStatus = typeof TaskWorkspaceAmendmentStatus.Type;

export const TaskWorkspacePlanDiff = Schema.Struct({
  baseRevisionId: TrimmedNonEmptyString,
  proposedRevisionId: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
  changedBlockIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type TaskWorkspacePlanDiff = typeof TaskWorkspacePlanDiff.Type;

export const TaskWorkspaceAmendment = Schema.Struct({
  id: TrimmedNonEmptyString,
  basePlanRevisionId: TrimmedNonEmptyString,
  triggeringPhaseId: TrimmedNonEmptyString,
  triggeringWorkItemId: TrimmedNonEmptyString,
  triggeringCheckId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  expected: TrimmedNonEmptyString,
  found: TrimmedNonEmptyString,
  impact: TrimmedNonEmptyString,
  proposedChanges: TrimmedNonEmptyString,
  proposedPlanMarkdown: Schema.optional(Schema.String),
  reviewFeedback: Schema.optional(Schema.NullOr(Schema.String)),
  affectedPhaseIds: Schema.Array(TrimmedNonEmptyString),
  affectedWorkItemIds: Schema.Array(TrimmedNonEmptyString),
  dependentCheckIds: Schema.Array(TrimmedNonEmptyString),
  status: TaskWorkspaceAmendmentStatus,
  artifactRevisionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  planDiff: Schema.NullOr(TaskWorkspacePlanDiff).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  requestedAt: IsoDateTime,
  approvedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  approvedBy: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskWorkspaceAmendment = typeof TaskWorkspaceAmendment.Type;

export const TaskWorkspaceRepository = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
  branch: Schema.NullOr(TrimmedNonEmptyString),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  provisioningStatus: TaskWorkspaceProvisioningStatus,
  // Server-resolved pinned base commit. `planningRootFingerprint` covers the
  // planning root (HEAD SHA + canonical status) and is revalidated before every
  // task-bound turn, at proposal acceptance, and at Plan approval.
  baseCommitSha: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  planningRootFingerprint: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
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

export const TaskWorkspaceSessionStatus = Schema.Literals(["active", "completed", "superseded"]);
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
  dependsOn: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  checkIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  invalidationReason: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskWorkspaceWorkItem = typeof TaskWorkspaceWorkItem.Type;

export const TaskWorkspaceBuildPhase = Schema.Struct({
  id: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  status: TaskWorkspaceWorkStatus,
  workItems: Schema.Array(TaskWorkspaceWorkItem),
  checkpointPolicy: TaskWorkspaceCheckpointPolicy.pipe(
    Schema.withDecodingDefault(Effect.succeed("never")),
  ),
  checkIds: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  checkpointId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  phaseCommitSha: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  startedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
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
  // Run-level prompt pin; legacy runs populate it from `versions.prompt` at
  // import. Prompt resolution uses this pin, never the mirror alone.
  promptBundleVersion: Schema.optional(TrimmedNonEmptyString),
  currentStage: TaskWorkspaceStage,
  approvalPolicy: Schema.Literal("before-build"),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskWorkspaceWorkflowRun = typeof TaskWorkspaceWorkflowRun.Type;

export const TaskWorkspace = Schema.Struct({
  id: TaskWorkspaceId,
  // Stamped by the owning server environment at creation or import. `null`
  // means the record predates environment scoping and needs the repair path.
  environmentId: Schema.NullOr(EnvironmentId).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  title: TrimmedNonEmptyString,
  versions: Schema.Struct({
    taskContract: TrimmedNonEmptyString,
    artifactContract: TrimmedNonEmptyString,
    workflowDefinition: TrimmedNonEmptyString,
    prompt: TrimmedNonEmptyString,
  }),
  intake: TaskWorkspaceIntake.pipe(
    Schema.withDecodingDefault(Effect.succeed({ brief: "", source: { kind: "inline", body: "" } })),
  ),
  preferences: TaskWorkspacePreferences.pipe(
    Schema.withDecodingDefault(
      Effect.succeed({
        worktreePolicy: "later",
        modelSelection: null,
        executionProfile: "planning",
      }),
    ),
  ),
  // Durable bootstrap state for the current primary session, or `null` for
  // legacy tasks whose sessions were linked manually.
  bootstrap: Schema.NullOr(TaskWorkspaceBootstrapState).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  // Append-only repeatable stage occurrences.
  occurrences: Schema.Array(TaskWorkspaceStageOccurrence).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  // Active Plan gate plus append-only gate history.
  planGate: Schema.NullOr(TaskWorkspacePlanGate).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  gateHistory: Schema.Array(TaskWorkspaceGateOutcome).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  // Incremented for every persisted task event; the compare-and-set anchor.
  taskRevision: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
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
    activePhaseId: Schema.NullOr(TrimmedNonEmptyString).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    activeWorkItemId: Schema.NullOr(TrimmedNonEmptyString).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    checks: Schema.Array(TaskWorkspaceBuildCheck).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    checkpoints: Schema.Array(TaskWorkspaceBuildCheckpoint).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    amendments: Schema.Array(TaskWorkspaceAmendment).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    checkAttempts: Schema.Array(TaskWorkspaceCheckAttempt).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    currentPlanRevisionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    amendmentGateId: Schema.NullOr(TrimmedNonEmptyString).pipe(
      Schema.withDecodingDefault(Effect.succeed(null)),
    ),
    continuationSessionIds: Schema.Array(TrimmedNonEmptyString).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
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
  // Slice 1/2 clients sent the repository path directly; the server now derives
  // the workspace root from the project. Legacy commands keep decoding.
  workspaceRoot: Schema.optional(TrimmedNonEmptyString),
  baseRef: TrimmedNonEmptyString,
  preset: TaskWorkspacePreset.pipe(Schema.withDecodingDefault(Effect.succeed("standard"))),
  approvalPolicy: Schema.Literal("before-build"),
  // First-slice create fields. `operationKey` is a stable client-generated
  // semantic key; `brief`/`source`/`worktreePolicy`/`modelSelection` are
  // required for new creates and absent on legacy commands.
  operationKey: Schema.optional(TrimmedNonEmptyString),
  brief: Schema.optional(Schema.String),
  source: Schema.optional(TaskWorkspaceIntakeSource),
  worktreePolicy: Schema.optional(TaskWorkspaceWorktreePolicy),
  modelSelection: Schema.optional(ModelSelection),
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
  checkpointId: Schema.optional(TrimmedNonEmptyString),
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
  expectedTaskRevision: Schema.optional(NonNegativeInt),
  operationKey: Schema.optional(TrimmedNonEmptyString),
});

/**
 * Explicitly enter a stage the workflow does not rail into.
 *
 * Freeform declares its stages as explicit-entry only, so this is how a
 * Freeform task reaches Plan or Verify. Guided and Standard reject it for any
 * stage their own transitions already cover.
 */
/**
 * Record Plan feedback and allocate a continuation occurrence. The previous
 * Plan occurrence and its session complete with the `changes-requested` gate
 * outcome; a new occurrence starts and reopens the gate.
 */
const TaskStageRequestChangesCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.stage.request-changes"),
  expectedTaskRevision: NonNegativeInt,
  operationKey: TrimmedNonEmptyString,
  feedback: TrimmedNonEmptyString,
});

/**
 * Change worktree timing after Plan approval. In this slice only a Never task
 * may call it; changing to Now or Later enqueues deterministic provisioning.
 */
const TaskWorktreePolicySetCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.worktree.policy.set"),
  expectedTaskRevision: NonNegativeInt,
  operationKey: TrimmedNonEmptyString,
  policy: TaskWorkspaceWorktreePolicy,
});

/**
 * Deterministic primary-session recovery. `existing` preserves the selected
 * occurrence and supersedes other active primaries; `new` allocates the next
 * occurrence and creates new work.
 */
const TaskSessionRecoverPrimaryCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.session.recover-primary"),
  expectedTaskRevision: NonNegativeInt,
  operationKey: TrimmedNonEmptyString,
  selection: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("existing"), sessionId: TrimmedNonEmptyString }),
    Schema.Struct({ kind: Schema.Literal("new") }),
  ]),
});

/** User-authorized repair of a legacy project/repository binding. */
const TaskEnvironmentRepairCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.environment.repair"),
  expectedTaskRevision: NonNegativeInt,
  operationKey: TrimmedNonEmptyString,
  projectId: ProjectId,
  workspaceRoot: TrimmedNonEmptyString,
  baseRef: TrimmedNonEmptyString,
});

/**
 * Reopen a failed operation receipt for retry. Carries the latest expected
 * revision and the target semantic operation key; it never creates a second
 * semantic operation.
 */
const TaskOperationRetryCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.operation.retry"),
  expectedTaskRevision: NonNegativeInt,
  targetOperationKey: TrimmedNonEmptyString,
});

const TaskStageStartCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.stage.start"),
  stage: TaskWorkspaceStage,
});

const TaskWorkflowUpgradeCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.workflow.upgrade"),
  sourceVersion: TrimmedNonEmptyString,
  targetVersion: TrimmedNonEmptyString,
  expectedTaskRevision: NonNegativeInt,
  operationKey: TrimmedNonEmptyString,
});

const TaskImplementationStartCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.implementation.start"),
  expectedTaskRevision: NonNegativeInt,
  operationKey: TrimmedNonEmptyString,
});

export const TaskWorkflowUpgradeAck = Schema.Struct({
  accepted: Schema.Literal(true),
  sourceVersion: TrimmedNonEmptyString,
  targetVersion: TrimmedNonEmptyString,
  taskRevision: NonNegativeInt,
});
export type TaskWorkflowUpgradeAck = typeof TaskWorkflowUpgradeAck.Type;

export const TaskImplementationStartAck = Schema.Struct({
  accepted: Schema.Literal(true),
  occurrenceId: TrimmedNonEmptyString,
  sessionId: TrimmedNonEmptyString,
  taskRevision: NonNegativeInt,
});
export type TaskImplementationStartAck = typeof TaskImplementationStartAck.Type;

const TaskImplementationProgressCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.implementation.progress"),
  expectedTaskRevision: NonNegativeInt,
  phaseId: TrimmedNonEmptyString,
  workItemId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: Schema.Literals(["running", "completed", "blocked"]),
  summary: TrimmedNonEmptyString,
});

const TaskImplementationCheckRunCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.implementation.check.run"),
  expectedTaskRevision: NonNegativeInt,
  checkId: TrimmedNonEmptyString,
  operationKey: TrimmedNonEmptyString,
});

const TaskImplementationAmendmentProposeCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.implementation.amendment.propose"),
  expectedTaskRevision: NonNegativeInt,
  phaseId: TrimmedNonEmptyString,
  workItemId: TrimmedNonEmptyString,
  triggeringCheckId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  expected: TrimmedNonEmptyString,
  found: TrimmedNonEmptyString,
  impact: TrimmedNonEmptyString,
  proposedPlanMarkdown: Schema.String,
  operationKey: TrimmedNonEmptyString,
});

const TaskImplementationCompleteCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.implementation.complete"),
  expectedTaskRevision: NonNegativeInt,
  summary: TrimmedNonEmptyString,
  operationKey: TrimmedNonEmptyString,
  /** Provider-bound identity, supplied only by server bridge dispatch. */
  sessionId: Schema.optional(TrimmedNonEmptyString),
  providerTurnId: Schema.optional(TrimmedNonEmptyString),
});

const TaskBuildWorkItemSetStatusCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.build.work-item.set-status"),
  workItemId: TrimmedNonEmptyString,
  status: Schema.Literals(["pending", "running", "completed"]),
});

const TaskBuildPhaseStartCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.build.phase.start"),
  phaseId: TrimmedNonEmptyString,
});

const TaskBuildCheckRunCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.build.check.run"),
  checkId: TrimmedNonEmptyString,
});

const TaskBuildCheckRecordManualCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.build.check.record-manual"),
  checkId: TrimmedNonEmptyString,
  status: Schema.Literals(["pass", "fail", "blocked"]),
  note: TrimmedNonEmptyString,
  commitSha: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  expectedTaskRevision: Schema.optional(NonNegativeInt),
  operationKey: Schema.optional(TrimmedNonEmptyString),
});

const TaskBuildCheckpointContinueCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.build.checkpoint.continue"),
  checkpointId: TrimmedNonEmptyString,
  threadId: Schema.optional(ThreadId),
  contextManifestId: Schema.optional(TrimmedNonEmptyString),
  expectedTaskRevision: Schema.optional(NonNegativeInt),
  operationKey: Schema.optional(TrimmedNonEmptyString),
});

const TaskAmendmentRequestCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.amendment.request"),
  phaseId: TrimmedNonEmptyString,
  workItemId: TrimmedNonEmptyString,
  checkId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  expected: TrimmedNonEmptyString,
  found: TrimmedNonEmptyString,
  impact: TrimmedNonEmptyString,
  proposedChanges: TrimmedNonEmptyString,
  affectedPhaseIds: Schema.Array(TrimmedNonEmptyString),
  affectedWorkItemIds: Schema.Array(TrimmedNonEmptyString),
  dependentCheckIds: Schema.Array(TrimmedNonEmptyString),
});

const TaskAmendmentRequestChangesCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.amendment.request-changes"),
  amendmentId: TrimmedNonEmptyString,
  feedback: TrimmedNonEmptyString,
  expectedTaskRevision: NonNegativeInt,
  operationKey: TrimmedNonEmptyString,
});

const TaskAmendmentApproveCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.amendment.approve"),
  amendmentId: TrimmedNonEmptyString,
  approvedBy: TrimmedNonEmptyString,
  expectedTaskRevision: Schema.optional(NonNegativeInt),
  operationKey: Schema.optional(TrimmedNonEmptyString),
});

const TaskBuildResumeCommand = Schema.Struct({
  ...TaskCommandBase,
  type: Schema.Literal("task.build.resume"),
  checkpointId: TrimmedNonEmptyString,
  threadId: ThreadId,
  contextManifestId: TrimmedNonEmptyString,
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
  TaskStageRequestChangesCommand,
  TaskWorktreePolicySetCommand,
  TaskSessionRecoverPrimaryCommand,
  TaskEnvironmentRepairCommand,
  TaskOperationRetryCommand,
  TaskStageStartCommand,
  TaskWorkflowUpgradeCommand,
  TaskImplementationStartCommand,
  TaskImplementationProgressCommand,
  TaskImplementationCheckRunCommand,
  TaskImplementationAmendmentProposeCommand,
  TaskImplementationCompleteCommand,
  TaskBuildPhaseStartCommand,
  TaskBuildWorkItemSetStatusCommand,
  TaskBuildCheckRunCommand,
  TaskBuildCheckRecordManualCommand,
  TaskBuildCheckpointContinueCommand,
  TaskAmendmentRequestCommand,
  TaskAmendmentRequestChangesCommand,
  TaskAmendmentApproveCommand,
  TaskBuildResumeCommand,
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
  "task.stage.request-changes",
  "task.worktree.policy.set",
  "task.session.recover-primary",
  "task.environment.repair",
  "task.operation.retry",
  "task.stage.start",
  "task.workflow.upgrade",
  "task.workflow.upgraded",
  "task.implementation.start",
  "task.implementation.started",
  "task.implementation.progress",
  "task.implementation.check.run",
  "task.implementation.check.updated",
  "task.implementation.amendment.propose",
  "task.implementation.amendment.updated",
  "task.implementation.complete",
  "task.implementation.completed",
  "task.build.phase.start",
  "task.build.work-item.set-status",
  "task.build.check.run",
  "task.build.check.record-manual",
  "task.build.checkpoint.continue",
  "task.amendment.request",
  "task.amendment.request-changes",
  "task.amendment.changes-requested",
  "task.amendment.approve",
  "task.build.resume",
  "task.fixture.apply",
  "task.verification.run",
  "task.verification.signoff",
  // Lifecycle event types. Event type is independent from command type: one
  // semantic operation may emit requested, step-completed, ready, or failed
  // lifecycle events.
  "task.bootstrap.requested",
  "task.bootstrap.step-completed",
  "task.bootstrap.ready",
  "task.bootstrap.failed",
  "task.occurrence.completed",
  "task.occurrence.starting",
  "task.occurrence.failed",
  "task.gate.opened",
  "task.gate.approved",
  "task.gate.changes-requested",
  "task.proposal.proposed",
  "task.proposal.committed",
  "task.proposal.rejected",
  "task.worktree.ready",
  "task.worktree.failed",
  "task.migrated",
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

export const TaskWorkspaceDispatchOperationStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskWorkspaceDispatchOperationStatus = typeof TaskWorkspaceDispatchOperationStatus.Type;

export const TaskWorkspaceDispatchOperation = Schema.Struct({
  key: TrimmedNonEmptyString,
  status: TaskWorkspaceDispatchOperationStatus,
  attempt: NonNegativeInt,
  error: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskWorkspaceDispatchOperation = typeof TaskWorkspaceDispatchOperation.Type;

export const TaskWorkspaceTaskRoute = Schema.Struct({
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
});
export type TaskWorkspaceTaskRoute = typeof TaskWorkspaceTaskRoute.Type;

export const TaskWorkspaceConversationTarget = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type TaskWorkspaceConversationTarget = typeof TaskWorkspaceConversationTarget.Type;

export const TaskWorkspaceDispatchResult = Schema.Struct({
  sequence: NonNegativeInt,
  task: TaskWorkspace,
  operation: TaskWorkspaceDispatchOperation,
  taskRoute: TaskWorkspaceTaskRoute,
  conversationTarget: Schema.NullOr(TaskWorkspaceConversationTarget).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
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

// ---------------------------------------------------------------------------
// Durable service records
//
// These persist inside the task store's transactional boundary. They are
// contract-level schemas so tests can pin their shapes, but only the server
// writes them.
// ---------------------------------------------------------------------------

export const TaskWorkspaceCommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type TaskWorkspaceCommandReceiptStatus = typeof TaskWorkspaceCommandReceiptStatus.Type;

/**
 * Durable receipt for one transport request. Prevents a replayed retry command
 * from incrementing the target operation attempt twice.
 */
export const TaskWorkspaceCommandReceipt = Schema.Struct({
  environmentId: EnvironmentId,
  commandId: CommandId,
  taskId: TaskWorkspaceId,
  commandType: TrimmedNonEmptyString,
  commandDigest: TrimmedNonEmptyString,
  operationKey: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: TaskWorkspaceCommandReceiptStatus,
  // Immutable result identity: the event id of the terminal event, or null for
  // rejected receipts.
  resultEventId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  error: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
});
export type TaskWorkspaceCommandReceipt = typeof TaskWorkspaceCommandReceipt.Type;

export const TaskWorkspaceOperationStatus = Schema.Literals(["pending", "completed", "failed"]);
export type TaskWorkspaceOperationStatus = typeof TaskWorkspaceOperationStatus.Type;

/**
 * Durable service record for one semantic operation across retries. Distinct
 * from the task-local replay cache: a receipt binds environment, task, operation
 * type, semantic key, payload digest, status, attempts, and result identity.
 */
export const TaskWorkspaceOperationReceipt = Schema.Struct({
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  operationType: TrimmedNonEmptyString,
  operationKey: TrimmedNonEmptyString,
  payloadDigest: TrimmedNonEmptyString,
  status: TaskWorkspaceOperationStatus,
  attemptCount: NonNegativeInt,
  sourceCommandIds: Schema.Array(CommandId),
  resultEventId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  resultTaskRevision: Schema.NullOr(NonNegativeInt).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  error: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskWorkspaceOperationReceipt = typeof TaskWorkspaceOperationReceipt.Type;

export const TaskWorkspaceProposalStatus = Schema.Literals(["proposed", "committed", "rejected"]);
export type TaskWorkspaceProposalStatus = typeof TaskWorkspaceProposalStatus.Type;

export const TaskWorkspaceProposalTurnOutcome = Schema.Literals(["completed", "aborted", "failed"]);
export type TaskWorkspaceProposalTurnOutcome = typeof TaskWorkspaceProposalTurnOutcome.Type;

/**
 * Durable completion proposal bound to a task occurrence, session, thread, and
 * provider turn. One proposal per occurrence and provider turn; a different
 * payload on the same key conflicts.
 */
export const TaskWorkspaceCompletionProposal = Schema.Struct({
  id: TrimmedNonEmptyString,
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  stage: TaskWorkspaceStage,
  occurrence: NonNegativeInt,
  sessionId: TrimmedNonEmptyString,
  threadId: ThreadId,
  providerTurnId: TrimmedNonEmptyString,
  payloadDigest: TrimmedNonEmptyString,
  summary: Schema.String,
  markdown: Schema.String,
  status: TaskWorkspaceProposalStatus,
  terminalTurnOutcome: Schema.NullOr(TaskWorkspaceProposalTurnOutcome).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  committedArtifactRevisionId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  rejectionReason: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  createdAt: IsoDateTime,
  settledAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskWorkspaceCompletionProposal = typeof TaskWorkspaceCompletionProposal.Type;

export const TaskWorkspaceOutboxTarget = Schema.Literals([
  "worktree",
  "bootstrap",
  "proposal-commit",
  "implementation-check",
]);
export type TaskWorkspaceOutboxTarget = typeof TaskWorkspaceOutboxTarget.Type;

export const TaskWorkspaceOutboxStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type TaskWorkspaceOutboxStatus = typeof TaskWorkspaceOutboxStatus.Type;

/**
 * One outbox row persisting deterministic external identities before side
 * effects run. A restart worker reconciles each target before retrying.
 */
export const TaskWorkspaceOutboxEntry = Schema.Struct({
  id: TrimmedNonEmptyString,
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
  operationKey: TrimmedNonEmptyString,
  target: TaskWorkspaceOutboxTarget,
  status: TaskWorkspaceOutboxStatus,
  payload: Schema.Unknown,
  attemptCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  completedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskWorkspaceOutboxEntry = typeof TaskWorkspaceOutboxEntry.Type;

/**
 * Deterministic external identities for a bootstrap outbox row. Persisted
 * before thread-create/turn-start side effects run so a restart worker can
 * reconcile the same targets.
 */
export const TaskWorkspaceBootstrapOutboxPayload = Schema.Struct({
  stage: TaskWorkspaceStage,
  occurrence: NonNegativeInt,
  executionProfile: TaskWorkspaceExecutionProfile.pipe(
    Schema.withDecodingDefault(Effect.succeed("planning")),
  ),
  presentation: TrimmedNonEmptyString.pipe(Schema.withDecodingDefault(Effect.succeed("stage"))),
  sessionId: TrimmedNonEmptyString,
  threadId: ThreadId,
  threadCreateCommandId: CommandId,
  turnStartCommandId: CommandId,
  kickoffMessageId: MessageId,
  trustedInstructions: Schema.optional(Schema.String),
  contextManifestId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  continuationCheckpointId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  continuationMode: Schema.NullOr(Schema.Literals(["checkpoint", "amendment"])).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  continuationActivatePhase: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  worktreeBranch: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskWorkspaceBootstrapOutboxPayload = typeof TaskWorkspaceBootstrapOutboxPayload.Type;

export const TaskWorkspaceWorktreeOutboxPayload = Schema.Struct({
  branch: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  baseCommitSha: TrimmedNonEmptyString,
  sourceWorkspaceRoot: TrimmedNonEmptyString,
});
export type TaskWorkspaceWorktreeOutboxPayload = typeof TaskWorkspaceWorktreeOutboxPayload.Type;

export const TaskWorkspaceImplementationCheckOutboxPayload = Schema.Struct({
  attemptId: TrimmedNonEmptyString,
  checkId: TrimmedNonEmptyString,
  worktreePath: TrimmedNonEmptyString,
  command: TrimmedNonEmptyString,
  commandDigest: TrimmedNonEmptyString,
  timeoutMs: NonNegativeInt,
});
export type TaskWorkspaceImplementationCheckOutboxPayload =
  typeof TaskWorkspaceImplementationCheckOutboxPayload.Type;

/**
 * Provider-neutral task-stage bridge payloads. The context result contains
 * only untrusted task data selected by the server; trusted stage instructions
 * and runtime internals stay outside the tool response.
 */
export const TaskStageContextArtifact = Schema.Struct({
  kind: TaskWorkspaceArtifactKind,
  revision: NonNegativeInt,
  title: Schema.String,
  markdown: Schema.String,
});
export type TaskStageContextArtifact = typeof TaskStageContextArtifact.Type;

export const TaskStageContextResult = Schema.Struct({
  stage: TaskWorkspaceStage,
  occurrence: NonNegativeInt,
  brief: Schema.String,
  feedback: Schema.NullOr(Schema.String),
  artifacts: Schema.Array(TaskStageContextArtifact),
});
export type TaskStageContextResult = typeof TaskStageContextResult.Type;

export const TaskStageCompletionInput = Schema.Struct({
  summary: TrimmedNonEmptyString,
  markdown: Schema.String,
});
export type TaskStageCompletionInput = typeof TaskStageCompletionInput.Type;

export const TaskStageCompletionAck = Schema.Struct({
  accepted: Schema.Literal(true),
  stage: TaskWorkspaceStage,
  occurrence: NonNegativeInt,
  proposalId: TrimmedNonEmptyString,
  providerTurnId: TrimmedNonEmptyString,
});
export type TaskStageCompletionAck = typeof TaskStageCompletionAck.Type;

export const TaskImplementationContextInput = Schema.Struct({});
export type TaskImplementationContextInput = typeof TaskImplementationContextInput.Type;

export const TaskWorkspaceImplementationProgress = Schema.Struct({
  phaseId: TrimmedNonEmptyString,
  workItemId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: Schema.Literals(["pending", "running", "completed", "blocked", "invalidated"]),
  summary: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
});
export type TaskWorkspaceImplementationProgress = typeof TaskWorkspaceImplementationProgress.Type;

export const TaskImplementationProgressInput = Schema.Struct({
  phaseId: TrimmedNonEmptyString,
  workItemId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: Schema.Literals(["running", "completed", "blocked"]),
  summary: TrimmedNonEmptyString,
});
export type TaskImplementationProgressInput = typeof TaskImplementationProgressInput.Type;

export const TaskImplementationContextResult = Schema.Struct({
  stage: Schema.Literal("build"),
  occurrence: NonNegativeInt,
  brief: Schema.String,
  planRevisionId: TrimmedNonEmptyString,
  planMarkdown: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  phases: Schema.Array(TaskWorkspaceBuildPhase),
  checks: Schema.Array(TaskWorkspaceBuildCheck),
  checkpoints: Schema.Array(TaskWorkspaceBuildCheckpoint),
  amendments: Schema.Array(TaskWorkspaceAmendment),
  checkAttempts: Schema.Array(TaskWorkspaceCheckAttempt).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  currentCommitSha: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type TaskImplementationContextResult = typeof TaskImplementationContextResult.Type;

export const TaskImplementationProgressAck = Schema.Struct({
  accepted: Schema.Literal(true),
  phaseId: TrimmedNonEmptyString,
  workItemId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  status: Schema.Literals(["running", "completed", "blocked"]),
  taskRevision: NonNegativeInt,
});
export type TaskImplementationProgressAck = typeof TaskImplementationProgressAck.Type;

export const TaskImplementationCheckRunInput = Schema.Struct({ checkId: TrimmedNonEmptyString });
export type TaskImplementationCheckRunInput = typeof TaskImplementationCheckRunInput.Type;

export const TaskImplementationCheckRunAck = Schema.Struct({
  accepted: Schema.Literal(true),
  checkId: TrimmedNonEmptyString,
  attemptId: TrimmedNonEmptyString,
  status: TaskWorkspaceBuildCheckStatus,
  taskRevision: NonNegativeInt,
});
export type TaskImplementationCheckRunAck = typeof TaskImplementationCheckRunAck.Type;

export const TaskImplementationAmendmentInput = Schema.Struct({
  phaseId: TrimmedNonEmptyString,
  workItemId: TrimmedNonEmptyString,
  triggeringCheckId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  expected: TrimmedNonEmptyString,
  found: TrimmedNonEmptyString,
  impact: TrimmedNonEmptyString,
  proposedPlanMarkdown: Schema.String,
});
export type TaskImplementationAmendmentInput = typeof TaskImplementationAmendmentInput.Type;

export const TaskImplementationAmendmentAck = Schema.Struct({
  accepted: Schema.Literal(true),
  amendmentId: TrimmedNonEmptyString,
  taskRevision: NonNegativeInt,
});
export type TaskImplementationAmendmentAck = typeof TaskImplementationAmendmentAck.Type;

export const TaskImplementationCompleteInput = Schema.Struct({ summary: TrimmedNonEmptyString });
export type TaskImplementationCompleteInput = typeof TaskImplementationCompleteInput.Type;

export const TaskImplementationCompleteAck = Schema.Struct({
  accepted: Schema.Literal(true),
  proposalId: TrimmedNonEmptyString,
  providerTurnId: TrimmedNonEmptyString,
});
export type TaskImplementationCompleteAck = typeof TaskImplementationCompleteAck.Type;

export const TaskImplementationToolErrorCode = Schema.Literals([
  "unauthorized",
  "not-active",
  "turn-unavailable",
  "conflict",
  "invalid",
  "stale-revision",
  "unknown-id",
  "dependency-blocked",
  "check-blocked",
  "gate-open",
  "worktree-invalid",
]);
export type TaskImplementationToolErrorCode = typeof TaskImplementationToolErrorCode.Type;

export class TaskImplementationToolError extends Schema.TaggedErrorClass<TaskImplementationToolError>()(
  "TaskImplementationToolError",
  { code: TaskImplementationToolErrorCode, message: Schema.String },
) {}

export const TaskStageToolErrorCode = Schema.Literals([
  "unauthorized",
  "not-active",
  "turn-unavailable",
  "conflict",
  "invalid",
  "source-drift",
]);
export type TaskStageToolErrorCode = typeof TaskStageToolErrorCode.Type;

export class TaskStageToolError extends Schema.TaggedErrorClass<TaskStageToolError>()(
  "TaskStageToolError",
  {
    code: TaskStageToolErrorCode,
    message: Schema.String,
  },
) {}
