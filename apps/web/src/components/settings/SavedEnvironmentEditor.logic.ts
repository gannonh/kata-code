import { RepositoryCanonicalKey } from "@kata-sh/code-contracts";
import type {
  ProviderInstanceEnvironmentVariable,
  SavedEnvironmentTerminal,
  SavedSandboxEnvironment,
  SavedSandboxEnvironmentMap,
} from "@kata-sh/code-contracts";

type SavedEnvironmentFieldPatch = {
  readonly install?: string | undefined;
  readonly start?: string | undefined;
  readonly networkAccess?: string | undefined;
  readonly environment?: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined;
};

type SavedEnvironmentTerminalPatch = Partial<SavedEnvironmentTerminal>;

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTerminals(
  terminals: ReadonlyArray<SavedEnvironmentTerminal> | undefined,
): SavedEnvironmentTerminal[] | undefined {
  const cleaned = (terminals ?? []).flatMap((terminal) => {
    const name = trimOptional(terminal.name);
    const command = trimOptional(terminal.command);
    return name && command ? [{ name, command }] : [];
  });
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeEnvironment(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
): ProviderInstanceEnvironmentVariable[] | undefined {
  const cleaned = (environment ?? []).filter((variable) => variable.name.trim().length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeSavedEnvironment(
  environment: SavedSandboxEnvironment | undefined,
): SavedSandboxEnvironment | undefined {
  const install = trimOptional(environment?.install);
  const start = trimOptional(environment?.start);
  const networkAccess = trimOptional(environment?.networkAccess);
  const terminals = normalizeTerminals(environment?.terminals);
  const envVars = normalizeEnvironment(environment?.environment);

  const next: SavedSandboxEnvironment = {
    ...(install ? { install } : {}),
    ...(start ? { start } : {}),
    ...(terminals ? { terminals } : {}),
    ...(networkAccess ? { networkAccess } : {}),
    ...(envVars ? { environment: envVars } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

function setSavedEnvironment(
  current: SavedSandboxEnvironmentMap | undefined,
  repositoryKey: string,
  environment: SavedSandboxEnvironment | undefined,
): SavedSandboxEnvironmentMap {
  const key = RepositoryCanonicalKey.make(repositoryKey);
  const next = { ...current } as Record<string, SavedSandboxEnvironment>;
  const normalized = normalizeSavedEnvironment(environment);
  if (normalized) {
    next[key] = normalized;
  } else {
    delete next[key];
  }
  return next as SavedSandboxEnvironmentMap;
}

export function applySavedEnvironmentFieldPatch(
  current: SavedSandboxEnvironmentMap | undefined,
  repositoryKey: string,
  patch: SavedEnvironmentFieldPatch,
): SavedSandboxEnvironmentMap {
  const previous = current?.[RepositoryCanonicalKey.make(repositoryKey)];
  return setSavedEnvironment(current, repositoryKey, {
    ...previous,
    ...(patch.install !== undefined ? { install: patch.install } : {}),
    ...(patch.start !== undefined ? { start: patch.start } : {}),
    ...(patch.networkAccess !== undefined ? { networkAccess: patch.networkAccess } : {}),
    ...(patch.environment !== undefined ? { environment: [...patch.environment] } : {}),
  });
}

export function applySavedEnvironmentTerminalPatch(
  current: SavedSandboxEnvironmentMap | undefined,
  repositoryKey: string,
  terminalIndex: number,
  patch: SavedEnvironmentTerminalPatch,
): SavedSandboxEnvironmentMap {
  const previous = current?.[RepositoryCanonicalKey.make(repositoryKey)];
  const terminals = [...(previous?.terminals ?? [])];
  const currentTerminal = terminals[terminalIndex] ?? { name: "", command: "" };
  terminals[terminalIndex] = { ...currentTerminal, ...patch };
  return setSavedEnvironment(current, repositoryKey, {
    ...previous,
    terminals,
  });
}

export function removeSavedEnvironmentTerminal(
  current: SavedSandboxEnvironmentMap | undefined,
  repositoryKey: string,
  terminalIndex: number,
): SavedSandboxEnvironmentMap {
  const previous = current?.[RepositoryCanonicalKey.make(repositoryKey)];
  const terminals = (previous?.terminals ?? []).filter(
    (_terminal, index) => index !== terminalIndex,
  );
  return setSavedEnvironment(current, repositoryKey, {
    ...previous,
    terminals,
  });
}
