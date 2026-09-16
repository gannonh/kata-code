import {
  ModelSelection,
  isProviderAvailable,
  type Routine,
  type RoutineDraft,
  type RoutineDraftConversationMessage,
  type RoutineDraftGenerationResult,
  type RuntimeMode,
  type ServerProvider,
  type VcsRef,
} from "@kata-sh/code-contracts";
import * as Schema from "effect/Schema";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);

function remoteRefBranchName(ref: Pick<VcsRef, "name" | "remoteName" | "isRemote">): string {
  if (ref.isRemote && ref.remoteName && ref.name.startsWith(`${ref.remoteName}/`)) {
    return ref.name.slice(ref.remoteName.length + 1);
  }
  return ref.name;
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

export function isRoutineDraftDirty(current: RoutineDraft, baseline: RoutineDraft): boolean {
  return JSON.stringify(current) !== JSON.stringify(baseline);
}

export type RoutineDraftChatMessage = RoutineDraftConversationMessage;

/** Renderable chat turn with a stable identity independent of list position. */
export type RoutineDraftChatTurn = RoutineDraftConversationMessage & { readonly id: number };

/** Increment the chat revision only when a user-visible draft value changed. */
export function routineDraftRevisionAfterEdit(
  previous: RoutineDraft,
  next: RoutineDraft,
  revision: number,
): number {
  return isRoutineDraftDirty(previous, next) ? revision + 1 : revision;
}

/**
 * The server only sees an untouched default editor. Once a generation or a
 * user edit initialized the draft, send the authoritative editor state,
 * including mid-edit blank name or instruction fields.
 */
export function routineDraftForGenerationInput(
  current: RoutineDraft,
  initialized: boolean,
): RoutineDraft | null {
  return initialized ? current : null;
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
      readonly draft: RoutineDraft;
      readonly revision: number;
    }
  | {
      readonly status: "stale";
      readonly draft: RoutineDraft;
      readonly revision: number;
      readonly reviewDraft: RoutineDraft;
    };

/** Merge only model-owned fields, keeping editor-owned permission settings. */
export function mergeRoutineDraftGeneratedFields(
  current: RoutineDraft,
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
  current: RoutineDraft,
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

/** Fail closed when the themed confirm host is not registered yet (`undefined`). */
export function confirmDialogAccepted(result: boolean | undefined): boolean {
  return result === true;
}

/** Automatic init (default-branch fill) is not a user edit. Keep real edits dirty. */
export function routineDraftBaselineAfterAutomaticChange(
  current: RoutineDraft,
  baseline: RoutineDraft,
  next: RoutineDraft,
): RoutineDraft {
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
