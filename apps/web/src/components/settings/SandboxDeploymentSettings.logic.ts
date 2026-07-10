import {
  SandboxProviderDriverKind,
  SandboxProviderInstanceId,
  type SandboxInstanceSummary,
  type SandboxProviderInstanceConfig,
} from "@kata-sh/code-contracts";
import { normalizeGitRemoteUrl } from "@kata-sh/code-shared/git";

export const DOCKER_SANDBOX_KIND = SandboxProviderDriverKind.make("docker");
export const VERCEL_SANDBOX_KIND = SandboxProviderDriverKind.make("vercel");

/** Slugify a label into a sandbox instance id suffix (mirrors provider dialog). */
export function slugifySandboxLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

export function sandboxInstanceIdForLabel(input: {
  readonly driver: typeof DOCKER_SANDBOX_KIND | typeof VERCEL_SANDBOX_KIND;
  readonly label: string;
}): string {
  const suffix = slugifySandboxLabel(input.label) || "default";
  return `${input.driver as string}_${suffix}`;
}

/** Parse a sandbox port string into a validated integer in 1..65535, or null. */
export function parseSandboxPort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535) return parsed;
  return null;
}

function optionalDisplayName(label: string): Pick<SandboxProviderInstanceConfig, "displayName"> {
  const displayName = label.trim();
  return displayName === "" ? {} : { displayName };
}

export function buildDockerSandboxProviderInstance(input: {
  readonly label: string;
  readonly image: string;
  readonly command: string;
  readonly port: string;
}): SandboxProviderInstanceConfig {
  const portNumber = parseSandboxPort(input.port);
  if (portNumber === null) {
    throw new Error("Container port must be an integer from 1 to 65535.");
  }
  return {
    driver: DOCKER_SANDBOX_KIND,
    enabled: true,
    ...optionalDisplayName(input.label),
    config: { image: input.image, command: input.command, port: portNumber },
  } satisfies SandboxProviderInstanceConfig;
}

/** Vercel Sandbox vCPU choices. RAM is fixed at 2 GB per vCPU. */
export const VERCEL_VCPU_OPTIONS = [1, 2, 4, 8, 16, 32] as const;

/** Recommended floor — matches Vercel’s default when `resources` is omitted. */
export const DEFAULT_VERCEL_VCPUS = 2;

/** Resolve the selected vCPU count. Missing/invalid values fall back to the
 * recommended floor so the dropdown never shows a misleading empty/placeholder state. */
export function readVercelVcpus(config: unknown): number {
  if (config === null || typeof config !== "object") return DEFAULT_VERCEL_VCPUS;
  const value = (config as Record<string, unknown>).vcpus;
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_VERCEL_VCPUS;
  if ((VERCEL_VCPU_OPTIONS as readonly number[]).includes(value)) return value;
  return DEFAULT_VERCEL_VCPUS;
}

/** Label showing both vCPU and derived RAM (2 GB × vCPUs). */
export function formatVercelVcpusLabel(vcpus: number): string {
  const memoryGb = vcpus * 2;
  const recommended = vcpus === DEFAULT_VERCEL_VCPUS ? " — recommended" : "";
  return `${vcpus} vCPU / ${memoryGb} GB RAM${recommended}`;
}

export function buildVercelSandboxProviderInstance(input: {
  readonly label: string;
}): SandboxProviderInstanceConfig {
  return {
    driver: VERCEL_SANDBOX_KIND,
    enabled: true,
    ...optionalDisplayName(input.label),
    config: {
      runtime: "node24",
      persistent: true,
      timeoutMs: 86_400_000,
      port: 13773,
      vcpus: DEFAULT_VERCEL_VCPUS,
    },
  } satisfies SandboxProviderInstanceConfig;
}

/** `sandbox.startSession` is both create-and-run and lifecycle-start. Attach a
 * repository only for the create path; an existing running/stopped sandbox
 * already has a seeded workspace, so Start must only start the sandbox. */
export function shouldSeedRepositoryForStart(summary: SandboxInstanceSummary | undefined): boolean {
  if (summary?.kind !== "available") return true;
  return summary.runningSession === undefined;
}

/** A Vercel GitHub source selection persisted on the instance config. */
export interface VercelSourceSelection {
  readonly repository: string;
  readonly branch: string;
}

/** Read the `{ repository, branch }` source from an opaque Vercel config, or
 *  null when either value is missing. */
export function readVercelSource(config: unknown): VercelSourceSelection | null {
  if (config === null || typeof config !== "object") return null;
  const source = (config as Record<string, unknown>).source;
  if (source === null || typeof source !== "object") return null;
  const repository = (source as Record<string, unknown>).repository;
  const branch = (source as Record<string, unknown>).branch;
  if (
    typeof repository !== "string" ||
    repository.trim().length === 0 ||
    typeof branch !== "string" ||
    branch.trim().length === 0
  ) {
    return null;
  }
  return { repository: repository.trim(), branch: branch.trim() };
}

/** Write a Vercel source onto an opaque config, clearing it when repository is
 *  empty. Branch resets when the repository changes. */
export function setVercelSource(
  config: unknown,
  next: { readonly repository?: string; readonly branch?: string },
): Record<string, unknown> | undefined {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  // Read the raw source (repo-only intermediate states have no branch yet).
  const rawSource =
    base.source !== null && typeof base.source === "object"
      ? (base.source as Record<string, unknown>)
      : {};
  const currentRepository =
    typeof rawSource.repository === "string" ? rawSource.repository.trim() : "";
  const currentBranch = typeof rawSource.branch === "string" ? rawSource.branch.trim() : "";
  const repository = (next.repository ?? currentRepository).trim();
  if (repository.length === 0) {
    delete base.source;
    return Object.keys(base).length > 0 ? base : undefined;
  }
  // Reset the branch when the repository changes.
  const branchBase =
    next.repository !== undefined && next.repository.trim() !== currentRepository
      ? ""
      : currentBranch;
  const branch = (next.branch ?? branchBase).trim();
  base.source = { repository, ...(branch.length > 0 ? { branch } : {}) };
  return base;
}

/** The canonical GitHub repository key for an `owner/name` selection
 *  (`github.com/<owner>/<name>` lowercased). Reuses the shared
 *  `normalizeGitRemoteUrl` so it matches the server derivation exactly. */
export function vercelSourceRepositoryKey(repository: string): string {
  const owner = repository.trim().replace(/\.git$/i, "");
  return normalizeGitRemoteUrl(`https://github.com/${owner}.git`);
}

/** Whether a Vercel target can be created: a complete source is required.
 *  Non-Vercel drivers are unaffected (always true). */
export function canCreateVercelSandbox(input: {
  readonly isVercel: boolean;
  readonly config: unknown;
}): boolean {
  if (!input.isVercel) return true;
  return readVercelSource(input.config) !== null;
}

export function makeSandboxProviderInstanceId(input: {
  readonly driver: typeof DOCKER_SANDBOX_KIND | typeof VERCEL_SANDBOX_KIND;
  readonly label: string;
  readonly existingIds: ReadonlySet<string>;
}): string {
  const instanceId = sandboxInstanceIdForLabel({ driver: input.driver, label: input.label });
  if (input.existingIds.has(instanceId)) {
    throw new Error(`Instance id '${instanceId}' already exists. Choose a different label.`);
  }
  return SandboxProviderInstanceId.make(instanceId) as string;
}

/** The lifecycle state of a saved sandbox runtime record, joined to its
 *  instance's `SandboxInstanceSummary` from `sandbox.listInstances`.
 *  `unknown` = the record could not be joined by id (legacy record without
 *  `sandbox.instanceId` and no session claims its environment id); the row
 *  renders as a plain Connect row and is never auto-deleted. */
export type SandboxLifecycleState = "running" | "stopped" | "gone" | "unknown";

function sessionStatusToLifecycleState(
  status: "running" | "stopped" | undefined,
): SandboxLifecycleState {
  return status === "stopped" ? "stopped" : "running";
}

/** Resolve the lifecycle state of a saved sandbox runtime record by joining it
 *  to `sandbox.listInstances` summaries **by id only** (identity recovery plan
 *  R1; labels are never join keys).
 *
 *  Join order:
 *  1. `runningSession.environmentId === record.environmentId` — the in-sandbox
 *     server's environment id, stable across renames.
 *  2. `record.sandbox.instanceId === summary.instanceId` — the configured
 *     instance id persisted on the record at pairing time.
 *
 *  Returns `undefined` when the record is not a sandbox record. Returns
 *  `"gone"` only when summaries were successfully loaded AND the record's
 *  `instanceId` is known and absent (or has no session). When
 *  `summariesLoaded` is false (fetch failed / not yet loaded), returns
 *  `"unknown"` instead of inventing `"gone"`. Legacy records without an
 *  `instanceId` that match nothing resolve to `"unknown"` — never `"gone"`. */
export function resolveSandboxLifecycleState(
  record: {
    readonly environmentId: string;
    readonly label: string;
    readonly sandbox?:
      | { readonly providerKind: string; readonly instanceId?: string | undefined }
      | undefined;
  },
  summaries: ReadonlyArray<SandboxInstanceSummary>,
  options?: { readonly summariesLoaded?: boolean },
): SandboxLifecycleState | undefined {
  if (record.sandbox === undefined) return undefined;
  const summariesLoaded = options?.summariesLoaded !== false;

  // Join 1: by the in-sandbox environment id.
  for (const summary of summaries) {
    if (summary.kind !== "available") continue;
    const session = summary.runningSession;
    if (session !== undefined && (session.environmentId as string) === record.environmentId) {
      return sessionStatusToLifecycleState(session.status);
    }
  }

  // Join 2: by the persisted instance id.
  const instanceId = record.sandbox.instanceId;
  if (instanceId !== undefined) {
    // A failed or pending listInstances must never look like confirmed deletion.
    if (!summariesLoaded) return "unknown";
    const match = summaries.find((s) => (s.instanceId as string) === instanceId);
    if (match === undefined) return "gone";
    if (match.kind !== "available") return "unknown";
    if (match.runningSession === undefined) {
      // Instance exists but has no session — the sandbox was deleted while the
      // configured target remains. The record points at nothing.
      return "gone";
    }
    return sessionStatusToLifecycleState(match.runningSession.status);
  }

  // Legacy record without an instance id and no session match: unknown.
  return "unknown";
}
