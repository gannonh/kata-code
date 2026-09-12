import {
  ModelSelection,
  isProviderAvailable,
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
