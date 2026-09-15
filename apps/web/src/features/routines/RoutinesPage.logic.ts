import {
  ModelSelection,
  isProviderAvailable,
  type Routine,
  type RoutineDraft,
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
