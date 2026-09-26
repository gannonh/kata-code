import {
  GITHUB_ROUTINE_EVENT_LABELS,
  LINEAR_ROUTINE_EVENT_LABELS,
  ModelSelection,
  isProviderAvailable,
  isScheduleTrigger,
  RoutineId,
  RoutineRequestId,
  SCHEDULE_TRIGGER_KINDS,
  type GitHubEventTrigger,
  type GitHubRoutineConnection,
  type GitHubRoutineEvent,
  type LinearEventTrigger,
  type LinearRoutineConnection,
  type LinearRoutineEvent,
  type Routine,
  type RoutineConnection,
  type RoutineConnectionId,
  type RoutineDeliveryStatus,
  type RoutineDraft,
  type RoutineDraftConversationMessage,
  type RoutineDraftConversationState,
  type RoutineDraftGenerationResult,
  type RoutineTrigger,
  type RuntimeMode,
  type ServerProvider,
  type ScheduleTrigger,
  type VcsRef,
} from "@kata-sh/code-contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { randomUUID } from "../../lib/utils";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);

export function newRoutineDraftId(): RoutineId {
  return RoutineId.make(`routine-draft-${randomUUID()}`);
}

export function newRoutineRequestId(): RoutineRequestId {
  return RoutineRequestId.make(`routine-request-${randomUUID()}`);
}

function remoteRefBranchName(ref: Pick<VcsRef, "name" | "remoteName" | "isRemote">): string {
  if (ref.isRemote && ref.remoteName && ref.name.startsWith(`${ref.remoteName}/`)) {
    return ref.name.slice(ref.remoteName.length + 1);
  }
  return ref.name;
}

export function worktreeWorkspace(baseBranch: string): RoutineDraft["workspace"] {
  return {
    kind: "worktree",
    baseBranch,
    startFromOrigin: true,
    runSetupScript: true,
  };
}

export function preferredWorktreeBaseBranch(refs: ReadonlyArray<VcsRef>): string | null {
  const defaultRef = refs.find((ref) => ref.isDefault);
  const currentLocal = refs.find((ref) => ref.current && !ref.isRemote);
  const chosen = defaultRef ?? currentLocal ?? refs.find((ref) => ref.current);
  if (!chosen) return null;
  return remoteRefBranchName(chosen);
}

export function worktreeBaseExists(refs: ReadonlyArray<VcsRef>, branch: string): boolean {
  return refs.some((ref) => remoteRefBranchName(ref) === branch);
}

export function enabledProviders(providers: readonly ServerProvider[]): readonly ServerProvider[] {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.status !== "disabled" &&
      isProviderAvailable(provider) &&
      provider.models.length > 0,
  );
}

export function firstEnabledProviderModel(
  providers: readonly ServerProvider[],
): ModelSelection | null {
  const provider = enabledProviders(providers)[0];
  const model = provider?.models.find((candidate) => !candidate.isLegacy) ?? provider?.models[0];
  if (!provider?.instanceId || !model) return null;
  return decodeModelSelection({
    instanceId: provider.instanceId,
    model: model.slug,
  });
}

export function canSaveRoutineDraft(input: {
  readonly name: string;
  readonly instruction: string;
  readonly hasProject: boolean;
  readonly offline: boolean;
  readonly busy: boolean;
  readonly provider: ServerProvider | undefined;
}): boolean {
  return (
    input.name.trim().length > 0 &&
    input.instruction.trim().length > 0 &&
    input.hasProject &&
    !input.offline &&
    !input.busy &&
    input.provider !== undefined &&
    enabledProviders([input.provider]).length > 0
  );
}

export type RoutinesLibraryEmptyKind = "none" | "unavailable" | "pending" | "empty";

export function routinesLibraryEmptyKind(input: {
  readonly routineCount: number;
  readonly unavailableCount: number;
  readonly pendingCount: number;
}): RoutinesLibraryEmptyKind {
  if (input.routineCount > 0) return "none";
  if (input.pendingCount > 0) return "pending";
  if (input.unavailableCount > 0) return "unavailable";
  return "empty";
}

export const ROUTINE_PERMISSION_MODE_LABELS: Record<RuntimeMode, string> = {
  "approval-required": "Supervised · ask before changes",
  "auto-accept-edits": "Auto accept edits",
  auto: "Auto",
  "full-access": "Full access",
};

/** Viewport `lg` two-column layout overlays When-to-run at 1440×1000 with the sidebar open. */
export const ROUTINE_EDITOR_FIELDS_CLASS = "mt-5 grid min-w-0 grid-cols-1 gap-4";
export const ROUTINE_EDITOR_COLUMN_CLASS = "grid min-w-0 content-start gap-4";
export const ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS = "flex min-w-0 flex-wrap gap-2";
export const ROUTINE_CONTROL_CLASS =
  "h-8 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-2 text-sm";
export const DISCARD_UNSAVED_ROUTINE_MESSAGE =
  "Discard unsaved changes?\nThis draft will not become a routine.";
export const DELETE_ROUTINE_MESSAGE =
  "Delete this routine?\nConversations and run history stay available. It will not start again on the schedule.";
export const ROUTINE_CANCEL_HINT =
  "Discards unsaved changes. A canceled draft is not saved as a routine.";

/** GitHub choice before a connection exists. Never saved. */
export type GitHubTriggerDraft = {
  readonly kind: "github-draft";
  readonly event: GitHubRoutineEvent;
  readonly branch?: string;
  readonly includeDrafts: boolean;
  readonly issueLabelId?: number;
};
export type RoutineEditorGitHubTrigger = GitHubTriggerDraft | GitHubEventTrigger;
/** Linear choice missing its connection or the filter its event requires. Never saved. */
export type LinearTriggerDraft = {
  readonly kind: "linear-draft";
  readonly connectionId?: RoutineConnectionId;
  readonly workspaceId?: string;
  readonly teamId?: string;
  readonly projectId?: string;
  readonly event: LinearRoutineEvent;
  readonly stateId?: string;
  readonly labelId?: string;
};
export type RoutineEditorLinearTrigger = LinearTriggerDraft | LinearEventTrigger;
export type RoutineEditorTrigger = RoutineTrigger | GitHubTriggerDraft | LinearTriggerDraft;
export type RoutineEditorDraft = Omit<RoutineDraft, "trigger"> & {
  readonly trigger: RoutineEditorTrigger;
};

export function isRoutineDraftDirty(
  current: RoutineEditorDraft,
  baseline: RoutineEditorDraft,
): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

export type RoutineDraftChatMessage = RoutineDraftConversationMessage;

/** Renderable chat turn with a stable identity independent of list position. */
export type RoutineDraftChatTurn = RoutineDraftConversationMessage & { readonly id: number };

/** Increment the chat revision only when a user-visible draft value changed. */
export function routineDraftRevisionAfterEdit(
  previous: RoutineEditorDraft,
  next: RoutineEditorDraft,
  revision: number,
): number {
  return isRoutineDraftDirty(previous, next) ? revision + 1 : revision;
}

/**
 * The server only sees an untouched default editor. Once a generation or a
 * user edit initialized the draft, send the authoritative editor state,
 * including mid-edit blank name or instruction fields. Draft generation
 * produces schedules and Linear triggers, so a GitHub trigger or an
 * incomplete Linear draft is sent as no current draft.
 */
export function routineDraftForGenerationInput(
  current: RoutineEditorDraft,
  initialized: boolean,
): RoutineDraftConversationState | null {
  if (
    !initialized ||
    (!isRoutineEditorScheduleTrigger(current.trigger) && current.trigger.kind !== "linear")
  ) {
    return null;
  }
  return {
    name: current.name,
    instruction: current.instruction,
    projectId: current.projectId,
    modelSelection: current.modelSelection,
    runtimeMode: current.runtimeMode,
    workspace: current.workspace,
    trigger: current.trigger,
  };
}

/** Keep the bounded transcript sent to the draft model. */
export function routineDraftChatHistoryAfterTurn(
  history: readonly RoutineDraftChatTurn[],
  userMessage: string,
  assistantMessage: string,
  nextTurnId: () => number,
): readonly RoutineDraftChatTurn[] {
  return [
    ...history,
    { id: nextTurnId(), role: "user" as const, content: userMessage },
    { id: nextTurnId(), role: "assistant" as const, content: assistantMessage },
  ].slice(-20);
}

/** The wire transcript carries only the conversational fields. */
export function routineDraftChatHistoryForRequest(
  history: readonly RoutineDraftChatTurn[],
): readonly RoutineDraftConversationMessage[] {
  return history.map(({ role, content }) => ({ role, content }));
}

export type RoutineDraftGenerationApplyResult =
  | {
      readonly status: "applied" | "clarification";
      readonly draft: RoutineEditorDraft;
      readonly revision: number;
    }
  | {
      readonly status: "stale";
      readonly draft: RoutineEditorDraft;
      readonly revision: number;
      readonly reviewDraft: RoutineDraft;
    };

/** Merge only model-owned fields, keeping editor-owned permission settings. */
export function mergeRoutineDraftGeneratedFields(
  current: RoutineEditorDraft,
  generated: RoutineDraft,
): RoutineDraft {
  return {
    ...generated,
    runtimeMode: current.runtimeMode,
    ...(generated.projectId === current.projectId ? { workspace: current.workspace } : {}),
  };
}

/**
 * Apply generated fields only after matching the revision sent with the request.
 * Runtime mode and workspace belong to the editor and always come from it.
 */
export function applyRoutineDraftGenerationResponse(
  current: RoutineEditorDraft,
  currentRevision: number,
  response: RoutineDraftGenerationResult,
): RoutineDraftGenerationApplyResult {
  if (response.draft === null) {
    return { status: "clarification", draft: current, revision: currentRevision };
  }

  const reviewDraft = mergeRoutineDraftGeneratedFields(current, response.draft);
  if (response.draftRevision !== currentRevision) {
    return {
      status: "stale",
      draft: current,
      revision: currentRevision,
      reviewDraft,
    };
  }

  return { status: "applied", draft: reviewDraft, revision: currentRevision + 1 };
}

/** RPC command results carry the expected failure inside a cause; unwrap it for its message. */
export function errorMessage(value: unknown): string {
  const error = Cause.isCause(value) ? Option.getOrNull(Cause.findErrorOption(value)) : value;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The routine request failed. Try again.";
}

/** Fail closed when the themed confirm host is not registered yet (`undefined`). */
export function confirmDialogAccepted(result: boolean | undefined): boolean {
  return result === true;
}

/** Automatic init (default-branch fill) is not a user edit. Keep real edits dirty. */
export function routineDraftBaselineAfterAutomaticChange(
  current: RoutineEditorDraft,
  baseline: RoutineEditorDraft,
  next: RoutineEditorDraft,
): RoutineEditorDraft {
  return isRoutineDraftDirty(current, baseline) ? baseline : next;
}

export function libraryRoutinesAfterChange<
  T extends { readonly id: string; readonly state: Routine["state"] },
>(routines: readonly T[], next: T): readonly T[] {
  if (next.state === "deleted") return routines.filter((entry) => entry.id !== next.id);
  return routines.some((entry) => entry.id === next.id)
    ? routines.map((entry) => (entry.id === next.id ? next : entry))
    : [...routines, next];
}

export function keepDeletedRoutineInEditor(state: Routine["state"]): boolean {
  return state === "deleted";
}

export type RoutineTriggerKind = "schedule" | "github" | "linear";

export function isRoutineEditorScheduleTrigger(
  trigger: RoutineEditorTrigger,
): trigger is ScheduleTrigger {
  return SCHEDULE_TRIGGER_KINDS.has(trigger.kind);
}

export function isRoutineEditorTriggerComplete(
  trigger: RoutineEditorTrigger,
): trigger is RoutineTrigger {
  return trigger.kind !== "github-draft" && trigger.kind !== "linear-draft";
}

export function isRoutineEditorDraftComplete(draft: RoutineEditorDraft): draft is RoutineDraft {
  return isRoutineEditorTriggerComplete(draft.trigger);
}

export function routineTriggerKind(trigger: RoutineEditorTrigger): RoutineTriggerKind {
  if (isRoutineEditorScheduleTrigger(trigger)) return "schedule";
  return trigger.kind === "linear" || trigger.kind === "linear-draft" ? "linear" : "github";
}

/** What the GitHub trigger fields edit. A key set to `undefined` clears that filter. */
export type GitHubTriggerInput = {
  readonly connectionId?: RoutineConnectionId | undefined;
  readonly repositoryId?: number | undefined;
  readonly event: GitHubRoutineEvent;
  readonly branch?: string | undefined;
  readonly includeDrafts: boolean;
  readonly issueLabelId?: number | undefined;
};

/** A key set to `undefined` clears that filter; an absent key leaves it alone. */
export type GitHubTriggerPatch = Partial<Omit<GitHubTriggerInput, "connectionId" | "repositoryId">>;

/**
 * Branch filters apply to pull requests and workflows; label filters apply to
 * issues. Dropping the filter an event cannot use keeps a hidden value from
 * silently blocking every delivery. Keys follow the contract schema's order
 * because the dirty check compares serialized drafts.
 */
export function gitHubEditorTrigger(input: GitHubTriggerInput): RoutineEditorGitHubTrigger {
  const branch = input.event === "issue_opened" ? undefined : input.branch;
  const issueLabelId = input.event === "issue_opened" ? input.issueLabelId : undefined;
  const filters = {
    event: input.event,
    ...(branch === undefined ? {} : { branch }),
    includeDrafts: input.includeDrafts,
    ...(issueLabelId === undefined ? {} : { issueLabelId }),
  };
  if (input.connectionId === undefined || input.repositoryId === undefined) {
    return { kind: "github-draft", ...filters };
  }
  return {
    kind: "github",
    connectionId: input.connectionId,
    repositoryId: input.repositoryId,
    ...filters,
  };
}

/** What the Linear trigger fields edit. A key set to `undefined` clears that filter. */
export type LinearTriggerInput = {
  readonly connectionId?: RoutineConnectionId | undefined;
  readonly workspaceId?: string | undefined;
  readonly teamId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly event: LinearRoutineEvent;
  readonly stateId?: string | undefined;
  readonly labelId?: string | undefined;
};

function nonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

/** A key set to `undefined` clears that filter; an absent key leaves it alone. */
export type LinearTriggerPatch = Partial<Omit<LinearTriggerInput, "connectionId" | "workspaceId">>;

/**
 * A status transition carries the destination state; a label event carries the
 * added label. Dropping the filter the event cannot use keeps a hidden value
 * from silently blocking every delivery. The trigger is complete only with a
 * connection and the filter its event requires. Keys follow the contract
 * schema's order because the dirty check compares serialized drafts.
 */
export function linearEditorTrigger(input: LinearTriggerInput): RoutineEditorLinearTrigger {
  const scope = {
    ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
  };
  const stateId = input.event === "status_changed" ? input.stateId : undefined;
  const labelId = input.event === "label_added" ? input.labelId : undefined;
  const { connectionId, workspaceId } = input;
  if (connectionId !== undefined && workspaceId !== undefined) {
    const connected = { kind: "linear", connectionId, workspaceId, ...scope } as const;
    switch (input.event) {
      case "issue_created":
        return { ...connected, event: "issue_created" };
      case "status_changed":
        if (nonBlank(stateId)) return { ...connected, event: "status_changed", stateId };
        break;
      case "label_added":
        if (nonBlank(labelId)) return { ...connected, event: "label_added", labelId };
        break;
    }
  }
  return {
    kind: "linear-draft",
    ...(connectionId === undefined ? {} : { connectionId }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...scope,
    event: input.event,
    ...(stateId === undefined ? {} : { stateId }),
    ...(labelId === undefined ? {} : { labelId }),
  };
}

export function formatRoutineTrigger(trigger: RoutineTrigger): string {
  if (trigger.kind === "linear") {
    return `Linear · ${LINEAR_ROUTINE_EVENT_LABELS[trigger.event]}`;
  }
  if (!isScheduleTrigger(trigger)) {
    const branch = trigger.branch ? ` on ${trigger.branch}` : "";
    return `GitHub · ${GITHUB_ROUTINE_EVENT_LABELS[trigger.event].split(" (")[0]}${branch}`;
  }
  const triggerText =
    trigger.kind === "cron"
      ? trigger.expression
      : trigger.kind === "weekly"
        ? `Weekly on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][trigger.weekday]} at ${trigger.time}`
        : trigger.kind === "weekdays"
          ? `Weekdays at ${trigger.time}`
          : `Daily at ${trigger.time}`;
  return `${triggerText} · ${trigger.timezone}`;
}

export function defaultGitHubTrigger(connection: GitHubRoutineConnection): GitHubEventTrigger {
  return {
    kind: "github",
    connectionId: connection.id,
    repositoryId: connection.repositoryId,
    event: "pr_opened",
    branch: connection.defaultBranch,
    includeDrafts: false,
  };
}

export function defaultGitHubTriggerDraft(): GitHubTriggerDraft {
  return { kind: "github-draft", event: "pr_opened", includeDrafts: false };
}

export function defaultLinearTrigger(connection: LinearRoutineConnection): LinearEventTrigger {
  return {
    kind: "linear",
    connectionId: connection.id,
    workspaceId: connection.workspaceId,
    ...(connection.teamIds.length === 1 ? { teamId: connection.teamIds[0]! } : {}),
    event: "issue_created",
  };
}

export function defaultLinearTriggerDraft(): LinearTriggerDraft {
  return { kind: "linear-draft", event: "issue_created" };
}

/**
 * Switching to an event kind starts from the first selectable connection's
 * default, or a draft when none exists. Switching back to Schedule restores
 * the schedule the editor held before it left.
 */
export function switchRoutineEditorTrigger(
  current: RoutineEditorTrigger,
  kind: RoutineTriggerKind,
  options: {
    readonly githubConnections: readonly GitHubRoutineConnection[];
    readonly linearConnections: readonly LinearRoutineConnection[];
    readonly returnSchedule: ScheduleTrigger;
  },
): RoutineEditorTrigger {
  if (kind === routineTriggerKind(current)) return current;
  if (kind === "schedule") return options.returnSchedule;
  if (kind === "github") {
    const first = options.githubConnections[0];
    return first ? defaultGitHubTrigger(first) : defaultGitHubTriggerDraft();
  }
  const first = options.linearConnections[0];
  return first ? defaultLinearTrigger(first) : defaultLinearTriggerDraft();
}

/** Connections a new trigger may target; disabled ones stay listed only when already saved. */
export function selectableConnections(
  connections: readonly RoutineConnection[],
  savedConnectionId: string | null,
): readonly RoutineConnection[] {
  return connections.filter(
    (connection) => connection.status !== "disabled" || connection.id === savedConnectionId,
  );
}

export function gitHubHookSettingsUrl(connection: RoutineConnection): string | null {
  if (connection.provider !== "github" || connection.hookId === null) return null;
  return `${connection.repositoryUrl}/settings/hooks/${connection.hookId}`;
}

export const ROUTINE_CONNECTION_STATUS_LABELS: Record<
  RoutineConnection["status"] | "unavailable",
  string
> = {
  pending: "Waiting for GitHub ping",
  verified: "Verified",
  disabled: "Disabled",
  unavailable: "Unavailable",
};

export function routineConnectionStatusLabel(
  connection: Pick<RoutineConnection, "provider" | "status">,
): string {
  if (connection.status === "pending") {
    return connection.provider === "linear"
      ? "Waiting for the first delivery"
      : "Waiting for GitHub ping";
  }
  return ROUTINE_CONNECTION_STATUS_LABELS[connection.status];
}

export const ROUTINE_DELIVERY_STATUS_LABELS: Record<RoutineDeliveryStatus, string> = {
  accepted: "Accepted",
  ignored: "Ignored",
  rejected: "Rejected",
};

export const GITHUB_REDELIVERY_NOTE =
  "GitHub does not resend a delivery that failed on its own. Redeliver it from the repository's webhook settings.";

export const LINEAR_RETRY_NOTE =
  "Linear retries a failed delivery three times, after 1 minute, 1 hour, and 6 hours, then may disable the webhook. Re-enable it in the webhook's settings.";
export const LINEAR_PROVIDER_REMOVAL_NOTE =
  "Disconnect removes the stored signing secret and metadata credential here. Delete the webhook in Linear's workspace settings to stop provider deliveries.";
