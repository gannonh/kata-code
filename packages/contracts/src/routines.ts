import * as Cron from "effect/Cron";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  MessageId,
  CommandId,
  TurnId,
  IsoDateTime,
  TrimmedNonEmptyString,
  PositiveInt,
  NonNegativeInt,
} from "./baseSchemas.ts";
import { ModelSelection, RuntimeMode } from "./orchestration.ts";
import { RoutineOwnerGeneration, RoutineProviderSubmission, RoutineRunId } from "./routineFence.ts";

export { RoutineOwnerGeneration, RoutineProviderSubmission, RoutineRunId } from "./routineFence.ts";

export const RoutineId = TrimmedNonEmptyString.pipe(Schema.brand("RoutineId"));
export type RoutineId = typeof RoutineId.Type;
export const RoutineRequestId = TrimmedNonEmptyString.pipe(Schema.brand("RoutineRequestId"));
export type RoutineRequestId = typeof RoutineRequestId.Type;
export const RoutineOccurrenceKey = TrimmedNonEmptyString.pipe(
  Schema.brand("RoutineOccurrenceKey"),
);
export type RoutineOccurrenceKey = typeof RoutineOccurrenceKey.Type;
const LocalTime = Schema.String.check(Schema.isPattern(/^([01]\d|2[0-3]):[0-5]\d$/));
const Weekday = Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 6 }));
export const ScheduleTrigger = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("weekdays"),
    time: LocalTime,
    timezone: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("daily"),
    time: LocalTime,
    timezone: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("weekly"),
    time: LocalTime,
    weekday: Weekday,
    timezone: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    kind: Schema.Literal("cron"),
    expression: TrimmedNonEmptyString,
    timezone: TrimmedNonEmptyString,
  }),
]);
export type ScheduleTrigger = typeof ScheduleTrigger.Type;
export const RoutineConnectionId = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/u),
).pipe(Schema.brand("RoutineConnectionId"));
export type RoutineConnectionId = typeof RoutineConnectionId.Type;
export const GitHubRoutineEvent = Schema.Literals([
  "pr_opened",
  "pr_updated",
  "issue_opened",
  "workflow_failed",
]);
export type GitHubRoutineEvent = typeof GitHubRoutineEvent.Type;
export const GITHUB_ROUTINE_EVENT_LABELS: Record<GitHubRoutineEvent, string> = {
  pr_opened: "Pull request opened",
  pr_updated: "Pull request updated (new commits, reopened, or ready for review)",
  issue_opened: "Issue opened",
  workflow_failed: "Workflow run failed",
};
/**
 * Event routines key on GitHub's numeric ids. A repository or label rename keeps
 * its id, so the saved filter keeps matching without editing the routine.
 */
export const GitHubEventTrigger = Schema.Struct({
  kind: Schema.Literal("github"),
  connectionId: RoutineConnectionId,
  repositoryId: PositiveInt,
  event: GitHubRoutineEvent,
  branch: Schema.optional(TrimmedNonEmptyString),
  includeDrafts: Schema.Boolean,
  issueLabelId: Schema.optional(PositiveInt),
});
export type GitHubEventTrigger = typeof GitHubEventTrigger.Type;
export const LinearRoutineEvent = Schema.Literals([
  "issue_created",
  "status_changed",
  "label_added",
]);
export type LinearRoutineEvent = typeof LinearRoutineEvent.Type;
export const LINEAR_ROUTINE_EVENT_LABELS: Record<LinearRoutineEvent, string> = {
  issue_created: "Issue created",
  status_changed: "Status changed",
  label_added: "Label added",
};
/** Linear ids are workspace-scoped UUIDs; they survive renames. */
const LinearResourceId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));
const LinearTriggerScope = {
  connectionId: RoutineConnectionId,
  workspaceId: LinearResourceId,
  teamId: Schema.optional(LinearResourceId),
  projectId: Schema.optional(LinearResourceId),
} as const;
/**
 * Linear update events carry the evidence they need to be actionable: a status
 * transition names the destination state, and a label addition names the added
 * label. A matching final state without a transition is not an event.
 */
export const LinearEventTrigger = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("linear"),
    ...LinearTriggerScope,
    event: Schema.Literal("issue_created"),
  }),
  Schema.Struct({
    kind: Schema.Literal("linear"),
    ...LinearTriggerScope,
    event: Schema.Literal("status_changed"),
    stateId: LinearResourceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("linear"),
    ...LinearTriggerScope,
    event: Schema.Literal("label_added"),
    labelId: LinearResourceId,
  }),
]);
export type LinearEventTrigger = typeof LinearEventTrigger.Type;

/**
 * OpenAI strict structured output requires every object property in its JSON
 * Schema to be required. Encode optional Linear scopes as required nullable
 * fields for the model, then decode null back to an omitted filter.
 */
const LinearModelEventTriggerEncoded = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("linear"),
    connectionId: RoutineConnectionId,
    workspaceId: LinearResourceId,
    teamId: Schema.NullOr(LinearResourceId),
    projectId: Schema.NullOr(LinearResourceId),
    event: Schema.Literal("issue_created"),
  }),
  Schema.Struct({
    kind: Schema.Literal("linear"),
    connectionId: RoutineConnectionId,
    workspaceId: LinearResourceId,
    teamId: Schema.NullOr(LinearResourceId),
    projectId: Schema.NullOr(LinearResourceId),
    event: Schema.Literal("status_changed"),
    stateId: LinearResourceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("linear"),
    connectionId: RoutineConnectionId,
    workspaceId: LinearResourceId,
    teamId: Schema.NullOr(LinearResourceId),
    projectId: Schema.NullOr(LinearResourceId),
    event: Schema.Literal("label_added"),
    labelId: LinearResourceId,
  }),
]);
type LinearModelEventTriggerEncoded = typeof LinearModelEventTriggerEncoded.Type;
type LinearEventTriggerEncoded = typeof LinearEventTrigger.Encoded;
const LinearModelEventTrigger = LinearModelEventTriggerEncoded.pipe(
  Schema.decodeTo(
    LinearEventTrigger,
    SchemaTransformation.transform<LinearEventTriggerEncoded, LinearModelEventTriggerEncoded>({
      decode: ({ teamId, projectId, ...trigger }) => ({
        ...trigger,
        ...(teamId === null ? {} : { teamId }),
        ...(projectId === null ? {} : { projectId }),
      }),
      encode: (trigger) => ({
        ...trigger,
        connectionId: RoutineConnectionId.make(trigger.connectionId),
        teamId: trigger.teamId ?? null,
        projectId: trigger.projectId ?? null,
      }),
    }),
  ),
);
export const RoutineTrigger = Schema.Union([
  ScheduleTrigger,
  GitHubEventTrigger,
  LinearEventTrigger,
]);
export type RoutineTrigger = typeof RoutineTrigger.Type;
export const SCHEDULE_TRIGGER_KINDS = new Set(["weekdays", "daily", "weekly", "cron"]);
export const isScheduleTrigger = (trigger: RoutineTrigger): trigger is ScheduleTrigger =>
  SCHEDULE_TRIGGER_KINDS.has(trigger.kind);
/** Event routines are never due; the scheduler filters them out by trigger kind. */
export const EVENT_ROUTINE_NEXT_DUE_AT = "9999-12-31T00:00:00.000Z";
export const RoutineWorkspace = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("worktree"),
    baseBranch: TrimmedNonEmptyString,
    startFromOrigin: Schema.Boolean,
    runSetupScript: Schema.Boolean,
  }),
  Schema.Struct({ kind: Schema.Literal("shared"), directory: TrimmedNonEmptyString }),
]);
export const RoutineDraft = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  instruction: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  workspace: RoutineWorkspace,
  trigger: RoutineTrigger,
});
export type RoutineDraft = typeof RoutineDraft.Type;

/**
 * The only fields a text-generation provider is allowed to propose. Runtime
 * permissions and workspace placement are owned by the user and are seeded
 * by the server from the selected project. The model selection stays a loose
 * string pair here: models occasionally merge the list's `id:model` format,
 * and the server repairs or clarifies against the provider registry before
 * any draft is accepted.
 */
const RoutineDraftGeneratedFieldShape = {
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
  instruction: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
  projectId: ProjectId,
  modelSelection: Schema.Struct({
    instanceId: Schema.String.check(Schema.isMaxLength(200)),
    model: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  }),
} as const;
export const RoutineDraftGeneratedFields = Schema.Struct({
  ...RoutineDraftGeneratedFieldShape,
  trigger: Schema.Union([ScheduleTrigger, LinearEventTrigger]),
});
export type RoutineDraftGeneratedFields = typeof RoutineDraftGeneratedFields.Type;

/** Structured provider output. A null draft is a clarification response. */
export const RoutineDraftModelOutput = Schema.Struct({
  draft: Schema.NullOr(RoutineDraftGeneratedFields),
  assistantMessage: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
});
export type RoutineDraftModelOutput = typeof RoutineDraftModelOutput.Type;

/** Provider wire schema for strict structured output; decodes to the public model output type. */
const RoutineDraftProviderGeneratedFields = Schema.Struct({
  ...RoutineDraftGeneratedFieldShape,
  trigger: Schema.Union([ScheduleTrigger, LinearModelEventTrigger]),
});
export const RoutineDraftProviderOutput = Schema.Struct({
  draft: Schema.NullOr(RoutineDraftProviderGeneratedFields),
  assistantMessage: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
});
export type RoutineDraftProviderOutput = typeof RoutineDraftProviderOutput.Type;

export const RoutineDraftConversationMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  content: Schema.String.check(Schema.isMaxLength(100_000)),
});
export type RoutineDraftConversationMessage = typeof RoutineDraftConversationMessage.Type;

/**
 * Editor draft sent back to the assistant. Name and instruction may be
 * mid-edit (empty) so a refinement always carries the authoritative editor
 * state instead of discarding manual edits to blank fields.
 */
export const RoutineDraftConversationState = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(120)),
  instruction: Schema.String.check(Schema.isMaxLength(100_000)),
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  workspace: RoutineWorkspace,
  trigger: RoutineTrigger,
});
export type RoutineDraftConversationState = typeof RoutineDraftConversationState.Type;

/** Input to the conversational routine draft generator. */
export const RoutineDraftGenerationInput = Schema.Struct({
  message: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
  currentDraft: Schema.NullOr(RoutineDraftConversationState),
  draftRevision: NonNegativeInt,
  history: Schema.Array(RoutineDraftConversationMessage).check(Schema.isMaxLength(20)),
  projectId: ProjectId,
  generationModelSelection: ModelSelection,
});
export type RoutineDraftGenerationInput = typeof RoutineDraftGenerationInput.Type;

/** Full draft returned after a model turn has been validated and merged. */
export const RoutineDraftGenerationResult = Schema.Struct({
  /** Null when the assistant needs clarification and must leave the draft untouched. */
  draft: Schema.NullOr(RoutineDraft),
  assistantMessage: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
  draftRevision: NonNegativeInt,
});
export type RoutineDraftGenerationResult = typeof RoutineDraftGenerationResult.Type;
export const Routine = Schema.Struct({
  id: RoutineId,
  environmentId: EnvironmentId,
  revision: PositiveInt,
  configuration: RoutineDraft,
  state: Schema.Literals(["enabled", "paused", "deleted"]),
  nextDueAt: IsoDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Routine = typeof Routine.Type;
export const RoutineRunStatus = Schema.Literals([
  "queued",
  "starting",
  "running",
  "waiting-for-approval",
  "succeeded",
  "failed",
  "interrupted",
  "needs-attention",
  "skipped",
  "blocked",
]);
export type RoutineRunStatus = typeof RoutineRunStatus.Type;
export const RoutineRunStage = Schema.Literals([
  "admitted",
  "thread-created",
  "prompt-accepted",
  "submitting",
  "provider-bound",
  "terminal",
]);
export type RoutineRunStage = typeof RoutineRunStage.Type;
export const RoutineRun = Schema.Struct({
  id: RoutineRunId,
  routineId: RoutineId,
  environmentId: EnvironmentId,
  revision: PositiveInt,
  configuration: RoutineDraft,
  occurrenceKey: Schema.String,
  source: Schema.Literals(["schedule", "test", "downtime", "github", "linear"]),
  /** Link to the provider resource that admitted this run, shown beside the run. */
  sourceUrl: Schema.optional(Schema.String),
  /** Bounded, untrusted provider context appended under the saved instruction. */
  eventContext: Schema.optional(Schema.String),
  threadId: ThreadId,
  messageId: MessageId,
  commandId: CommandId,
  conversation: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("unconfirmed") }),
    Schema.Struct({ kind: Schema.Literal("confirmed"), threadId: ThreadId }),
  ]),
  status: RoutineRunStatus,
  stage: RoutineRunStage,
  turnId: Schema.NullOr(TurnId),
  detail: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RoutineRun = typeof RoutineRun.Type;
export class RoutineError extends Schema.TaggedError<RoutineError>()("RoutineError", {
  code: Schema.Literals([
    "validation",
    "conflict",
    "not-found",
    "blocked",
    "lost-fence",
    "persistence",
  ]),
  message: Schema.String,
}) {}
export const RoutineSaveInput = Schema.Struct({
  id: RoutineId,
  expectedRevision: NonNegativeInt,
  configuration: RoutineDraft,
});
export const RoutineGetInput = Schema.Struct({ id: RoutineId });
export const RoutineChangeInput = Schema.Struct({
  id: RoutineId,
  expectedRevision: PositiveInt,
  action: Schema.Literals(["pause", "resume", "delete"]),
});
export const RoutineTestInput = Schema.Struct({
  id: RoutineId,
  expectedRevision: PositiveInt,
  requestId: RoutineRequestId,
});
export const RoutineHistoryInput = Schema.Struct({
  id: RoutineId,
  before: Schema.optional(Schema.String),
  limit: Schema.optional(PositiveInt),
});
export const RoutinePreviewInput = Schema.Struct({ trigger: ScheduleTrigger });
export const RoutineDeliveryStatus = Schema.Literals(["accepted", "ignored", "rejected"]);
export type RoutineDeliveryStatus = typeof RoutineDeliveryStatus.Type;
export const RoutineDelivery = Schema.Struct({
  deliveryId: Schema.String,
  event: Schema.String,
  status: RoutineDeliveryStatus,
  detail: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(RoutineRunId),
  receivedAt: IsoDateTime,
});
export type RoutineDelivery = typeof RoutineDelivery.Type;
export const RoutineConnectionStatus = Schema.Literals([
  "pending",
  "verified",
  "disabled",
  "unavailable",
]);
export type RoutineConnectionStatus = typeof RoutineConnectionStatus.Type;
const RoutineConnectionFields = {
  id: RoutineConnectionId,
  environmentId: EnvironmentId,
  callbackUrl: TrimmedNonEmptyString,
  status: RoutineConnectionStatus,
  lastDelivery: Schema.NullOr(RoutineDelivery),
  acceptedCount: NonNegativeInt,
  ignoredCount: NonNegativeInt,
  rejectedCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
} as const;
/**
 * A repository webhook owned by this environment. The signing secret lives only
 * in the server secret store and never appears on this record.
 */
export const GitHubRoutineConnection = Schema.Struct({
  ...RoutineConnectionFields,
  provider: Schema.Literal("github"),
  repositoryId: PositiveInt,
  repositoryName: TrimmedNonEmptyString,
  repositoryUrl: TrimmedNonEmptyString,
  defaultBranch: TrimmedNonEmptyString,
  hookId: Schema.NullOr(PositiveInt),
});
export type GitHubRoutineConnection = typeof GitHubRoutineConnection.Type;
/**
 * A Linear workspace webhook created by the server through the delivered
 * OAuth access token. The signing secret and the OAuth bundle live in the
 * server secret store and never appear on this record.
 */
export const LinearRoutineConnection = Schema.Struct({
  ...RoutineConnectionFields,
  provider: Schema.Literal("linear"),
  workspaceId: TrimmedNonEmptyString,
  workspaceName: TrimmedNonEmptyString,
  /** Teams the connected webhook may deliver for; empty means all public teams. */
  teamIds: Schema.Array(TrimmedNonEmptyString),
  allTeams: Schema.Boolean,
  webhookId: Schema.NullOr(TrimmedNonEmptyString),
  metadataAccess: Schema.Literals(["ok", "revoked"]),
});
export type LinearRoutineConnection = typeof LinearRoutineConnection.Type;
export const RoutineConnection = Schema.Union([GitHubRoutineConnection, LinearRoutineConnection]);
export type RoutineConnection = typeof RoutineConnection.Type;
export const RoutineConnectionList = Schema.Array(RoutineConnection);
export const RoutineGitHubConnectionCreateInput = Schema.Struct({
  provider: Schema.Literal("github"),
  id: RoutineConnectionId,
  repository: TrimmedNonEmptyString,
});
export const RoutineLinearConnectionCreateInput = Schema.Struct({
  provider: Schema.Literal("linear"),
  id: RoutineConnectionId,
  allTeams: Schema.Boolean,
  teamIds: Schema.Array(TrimmedNonEmptyString),
});
export const RoutineConnectionCreateInput = Schema.Union([
  RoutineGitHubConnectionCreateInput,
  RoutineLinearConnectionCreateInput,
]);
export type RoutineConnectionCreateInput = typeof RoutineConnectionCreateInput.Type;
export const RoutineConnectionInput = Schema.Struct({ id: RoutineConnectionId });
export const RoutineConnectionAuthorization = Schema.Struct({
  authorizeUrl: TrimmedNonEmptyString,
});
export type RoutineConnectionAuthorization = typeof RoutineConnectionAuthorization.Type;
export const RoutineGitHubMetadataInput = Schema.Struct({
  repository: Schema.optional(TrimmedNonEmptyString),
});
export const RoutineGitHubMetadata = Schema.Struct({
  repositories: Schema.Array(
    Schema.Struct({ nameWithOwner: TrimmedNonEmptyString, defaultBranch: TrimmedNonEmptyString }),
  ),
  repository: Schema.NullOr(
    Schema.Struct({
      id: PositiveInt,
      nameWithOwner: TrimmedNonEmptyString,
      defaultBranch: TrimmedNonEmptyString,
      branches: Schema.Array(TrimmedNonEmptyString),
      labels: Schema.Array(Schema.Struct({ id: PositiveInt, name: TrimmedNonEmptyString })),
    }),
  ),
});
export type RoutineGitHubMetadata = typeof RoutineGitHubMetadata.Type;
/**
 * Pickers read metadata through the OAuth token delivered for a connection.
 * The token is read from the secret store by the server and never crosses the
 * client boundary.
 */
export const RoutineLinearMetadataInput = Schema.Struct({ connectionId: RoutineConnectionId });
/** Workspace, team, project, workflow-state, and label metadata for Linear pickers. */
export const RoutineLinearMetadata = Schema.Struct({
  workspace: Schema.Struct({
    id: TrimmedNonEmptyString,
    name: TrimmedNonEmptyString,
    urlKey: TrimmedNonEmptyString,
  }),
  teams: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      name: TrimmedNonEmptyString,
      key: TrimmedNonEmptyString,
    }),
  ),
  projects: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      name: TrimmedNonEmptyString,
      teamIds: Schema.Array(TrimmedNonEmptyString),
    }),
  ),
  states: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      name: TrimmedNonEmptyString,
      teamId: TrimmedNonEmptyString,
      type: TrimmedNonEmptyString,
    }),
  ),
  labels: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      name: TrimmedNonEmptyString,
      teamId: Schema.NullOr(TrimmedNonEmptyString),
    }),
  ),
});
export type RoutineLinearMetadata = typeof RoutineLinearMetadata.Type;
export const RoutinePreview = Schema.Struct({
  expression: Schema.String,
  dates: Schema.Array(IsoDateTime),
});
export const RoutineList = Schema.Array(Routine);
export const RoutineHistory = Schema.Struct({
  runs: Schema.Array(RoutineRun),
  nextCursor: Schema.NullOr(Schema.String),
});

export const RoutineSubscriptionEvent = Schema.Struct({
  kind: Schema.Literals(["snapshot", "changed"]),
  routines: Schema.Array(Routine),
  cursor: NonNegativeInt,
});
export type RoutineSubscriptionEvent = typeof RoutineSubscriptionEvent.Type;

export function previewRoutineSchedule(
  trigger: ScheduleTrigger,
  after: Date,
): typeof RoutinePreview.Type {
  const expression =
    trigger.kind === "cron"
      ? trigger.expression
      : (() => {
          const [hour, minute] = trigger.time.split(":");
          const day =
            trigger.kind === "weekdays"
              ? "1-5"
              : trigger.kind === "weekly"
                ? String(trigger.weekday)
                : "*";
          return `${Number(minute)} ${Number(hour)} * * ${day}`;
        })();
  try {
    if (expression.length > 256 || expression.trim().split(/\s+/).length !== 5)
      throw new Error("Use exactly five cron fields at minute granularity.");
    new Intl.DateTimeFormat("en", { timeZone: trigger.timezone }).format(after);
    const parsed = Result.getOrThrow(Cron.parse(expression, trigger.timezone));
    const dates: string[] = [];
    let cursor = after;
    for (let i = 0; i < 3; i++) {
      cursor = Cron.next(parsed, cursor);
      dates.push(cursor.toISOString());
    }
    return { expression, dates };
  } catch (cause) {
    throw new RoutineError({
      code: "validation",
      message: `Invalid schedule or timezone: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}
