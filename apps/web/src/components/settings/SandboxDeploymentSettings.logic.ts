import {
  SandboxProviderDriverKind,
  SandboxProviderInstanceId,
  type SandboxInstanceSummary,
  type SandboxProviderInstanceConfig,
} from "@kata-sh/code-contracts";

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
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null;
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
    ...(input.label.trim().length > 0 ? { displayName: input.label.trim() } : {}),
    config: { image: input.image, command: input.command, port: portNumber },
  } satisfies SandboxProviderInstanceConfig;
}

export function buildVercelSandboxProviderInstance(input: {
  readonly label: string;
}): SandboxProviderInstanceConfig {
  return {
    driver: VERCEL_SANDBOX_KIND,
    enabled: true,
    ...(input.label.trim().length > 0 ? { displayName: input.label.trim() } : {}),
    config: { runtime: "node24", sourceType: "runtime", timeoutMs: 86_400_000, port: 13773 },
  } satisfies SandboxProviderInstanceConfig;
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
 *  instance's `SandboxInstanceSummary` from `sandbox.listInstances`. */
export type SandboxLifecycleState = "running" | "stopped" | "gone";

/** Map a saved record's `sandbox.providerKind` to the driver kind used in
 *  `sandboxInstanceIdForLabel`. Legacy Docker records use "local"; current
 *  records use the driver kind string ("docker" / "vercel"). */
function providerKindToDriver(providerKind: string): string {
  if (providerKind === "local") return DOCKER_SANDBOX_KIND as string;
  return providerKind;
}

/** Resolve the lifecycle state of a saved sandbox runtime record by joining it
 *  to the matching `SandboxInstanceSummary` from `listInstances`. Returns
 *  `undefined` when the record is not a sandbox record (no `sandbox` marker).
 *  Returns `"gone"` when no matching summary exists or the instance is
 *  unavailable (the sandbox was deleted or its config is invalid). */
export function resolveSandboxLifecycleState(
  record: {
    readonly label: string;
    readonly sandbox?: { readonly providerKind: string } | undefined;
  },
  summaries: ReadonlyArray<SandboxInstanceSummary>,
): SandboxLifecycleState | undefined {
  if (record.sandbox === undefined) return undefined;
  const driver = providerKindToDriver(record.sandbox.providerKind);
  const instanceId = sandboxInstanceIdForLabel({
    driver: driver as typeof DOCKER_SANDBOX_KIND | typeof VERCEL_SANDBOX_KIND,
    label: record.label,
  });
  const match = summaries.find((s) => (s.instanceId as string) === instanceId);
  if (match === undefined || match.kind !== "available") return "gone";
  const status = match.runningSession?.status;
  if (status === "running") return "running";
  if (status === "stopped") return "stopped";
  // A sandbox instance exists with no running session (not yet provisioned).
  // Treat as gone from the runtime perspective — there's no sandbox to connect to.
  return "gone";
}
