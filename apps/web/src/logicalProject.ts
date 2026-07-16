import { scopedProjectKey, scopeProjectRef } from "@kata-sh/code-client-runtime";
import type { ScopedProjectRef, SidebarProjectGroupingMode } from "@kata-sh/code-contracts";
import type { UnifiedSettings } from "@kata-sh/code-contracts/settings";
import { normalizeProjectPathForComparison } from "./lib/projectPaths";
import type { Project } from "./types";

export interface ProjectGroupingSettings {
  sidebarProjectGroupingMode: SidebarProjectGroupingMode;
  sidebarProjectGroupingOverrides: Record<string, SidebarProjectGroupingMode>;
}

export type ProjectGroupingMode = SidebarProjectGroupingMode;

export function selectProjectGroupingSettings(settings: UnifiedSettings): ProjectGroupingSettings {
  return {
    sidebarProjectGroupingMode: settings.sidebarProjectGroupingMode,
    sidebarProjectGroupingOverrides: settings.sidebarProjectGroupingOverrides,
  };
}

function uniqueNonEmptyValues(values: ReadonlyArray<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function deriveRepositoryRelativeProjectPath(
  project: Pick<Project, "cwd" | "repositoryIdentity">,
): string | null {
  const rootPath = project.repositoryIdentity?.rootPath?.trim();
  if (!rootPath) {
    return null;
  }

  const normalizedProjectPath = normalizeProjectPathForComparison(project.cwd);
  const normalizedRootPath = normalizeProjectPathForComparison(rootPath);
  if (normalizedProjectPath.length === 0 || normalizedRootPath.length === 0) {
    return null;
  }

  if (normalizedProjectPath === normalizedRootPath) {
    return "";
  }

  const separator = normalizedRootPath.includes("\\") ? "\\" : "/";
  const rootPrefix = `${normalizedRootPath}${separator}`;
  if (!normalizedProjectPath.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedProjectPath.slice(rootPrefix.length).replaceAll("\\", "/");
}

export function derivePhysicalProjectKeyFromPath(environmentId: string, cwd: string): string {
  return `${environmentId}:${normalizeProjectPathForComparison(cwd)}`;
}

export function derivePhysicalProjectKey(project: Pick<Project, "environmentId" | "cwd">): string {
  return derivePhysicalProjectKeyFromPath(project.environmentId, project.cwd);
}

export function deriveProjectGroupingOverrideKey(
  project: Pick<Project, "environmentId" | "cwd">,
): string {
  return derivePhysicalProjectKey(project);
}

// Key under which a project's manual sort order (projectOrder) is stored.
// Must stay aligned with the writer side in `uiStateStore.syncProjects` and
// the drag handlers in `Sidebar` so readers and writers agree.
export function getProjectOrderKey(project: Pick<Project, "environmentId" | "cwd">): string {
  return derivePhysicalProjectKey(project);
}

export function resolveProjectGroupingMode(
  project: Pick<Project, "environmentId" | "cwd">,
  settings: ProjectGroupingSettings,
): SidebarProjectGroupingMode {
  return (
    settings.sidebarProjectGroupingOverrides?.[deriveProjectGroupingOverrideKey(project)] ??
    settings.sidebarProjectGroupingMode
  );
}

function deriveRepositoryScopedKey(
  project: Pick<Project, "cwd" | "repositoryIdentity">,
  groupingMode: SidebarProjectGroupingMode,
): string | null {
  const canonicalKey = project.repositoryIdentity?.canonicalKey;
  if (!canonicalKey) {
    return null;
  }

  if (groupingMode === "repository") {
    return canonicalKey;
  }

  const relativeProjectPath = deriveRepositoryRelativeProjectPath(project);
  if (relativeProjectPath === null) {
    return canonicalKey;
  }

  return relativeProjectPath.length === 0
    ? canonicalKey
    : `${canonicalKey}::${relativeProjectPath}`;
}

export function deriveLogicalProjectKey(
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity">,
  options?: {
    groupingMode?: SidebarProjectGroupingMode;
  },
): string {
  const groupingMode = options?.groupingMode ?? "repository";
  if (groupingMode === "separate") {
    return derivePhysicalProjectKey(project);
  }

  return (
    deriveRepositoryScopedKey(project, groupingMode) ??
    derivePhysicalProjectKey(project) ??
    scopedProjectKey(scopeProjectRef(project.environmentId, project.id))
  );
}

export function deriveLogicalProjectKeyFromSettings(
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity">,
  settings: ProjectGroupingSettings,
): string {
  return deriveLogicalProjectKey(project, {
    groupingMode: resolveProjectGroupingMode(project, settings),
  });
}

export function deriveLogicalProjectKeyFromRef(
  projectRef: ScopedProjectRef,
  project: Pick<Project, "environmentId" | "id" | "cwd" | "repositoryIdentity"> | null | undefined,
  options?: {
    groupingMode?: SidebarProjectGroupingMode;
  },
): string {
  return project ? deriveLogicalProjectKey(project, options) : scopedProjectKey(projectRef);
}

/** Prefer short repo/folder name over `owner/repo` for sidebar chrome. */
export function shortProjectDisplayName(input: {
  name?: string | null;
  cwd?: string | null;
  repositoryIdentity?: {
    name?: string | null;
    displayName?: string | null;
  } | null;
}): string {
  const repoName = input.repositoryIdentity?.name?.trim();
  if (repoName) return repoName;

  const stripOwnerPrefix = (value: string): string => {
    const slash = value.lastIndexOf("/");
    if (slash >= 0 && slash < value.length - 1) {
      return value.slice(slash + 1);
    }
    return value;
  };

  const identityDisplay = input.repositoryIdentity?.displayName?.trim();
  if (identityDisplay) return stripOwnerPrefix(identityDisplay);

  const name = input.name?.trim();
  if (name) return stripOwnerPrefix(name);

  const cwd = input.cwd?.replace(/\/+$/, "").trim();
  if (cwd) {
    const base = cwd.slice(cwd.lastIndexOf("/") + 1);
    if (base) return base;
  }

  return "Project";
}

export function deriveProjectGroupLabel(input: {
  representative: Pick<Project, "name" | "cwd" | "repositoryIdentity">;
  members: ReadonlyArray<Pick<Project, "name" | "cwd" | "repositoryIdentity">>;
}): string {
  const sharedRepositoryNames = uniqueNonEmptyValues(
    input.members.map((member) => member.repositoryIdentity?.name),
  );
  if (sharedRepositoryNames.length === 1) {
    return sharedRepositoryNames[0]!;
  }

  const sharedShortLabels = uniqueNonEmptyValues(
    input.members.map((member) => shortProjectDisplayName(member)),
  );
  if (sharedShortLabels.length === 1) {
    return sharedShortLabels[0]!;
  }

  return shortProjectDisplayName(input.representative);
}
