import { type CredentialGroup, selectedDescriptors } from "../config/tags.ts";
import {
  assertMacOsHost,
  formatMissingPrerequisiteError,
  readAgentProviderPrerequisites,
  readClerkPrerequisites,
  readGoogleTestUserEmail,
  readGoogleTestUserPrerequisites,
  type PrerequisiteResult,
} from "./env.ts";
import { assertMaestroInstalled } from "./maestroRunner.ts";
import { resolveServerBinPath } from "./serverStack.ts";

export type { CredentialGroup } from "../config/tags.ts";

export interface ResolvedCredentials {
  readonly googleEmail: string | null;
}

const CREDENTIAL_READERS: Record<CredentialGroup, () => PrerequisiteResult> = {
  clerk: readClerkPrerequisites,
  google: readGoogleTestUserPrerequisites,
  agent: readAgentProviderPrerequisites,
};

/**
 * Whether the selected flows pair to a loopback `katacode serve` stack. Looks
 * up `needsServer` per descriptor so a native-modal flow like `@auth` is not
 * mis-wired into the server-start path. Pure so the rule is unit-tested.
 */
export function runNeedsServer(selection: readonly string[]): boolean {
  return selectedDescriptors(selection).some((descriptor) => descriptor.needsServer);
}

/**
 * Credential groups the selected flows require. An empty selection resolves to
 * every flow, so all groups are required. Pure so the rule is unit-tested.
 */
export function requiredCredentialGroupsForTags(selection: readonly string[]): CredentialGroup[] {
  const groups = new Set<CredentialGroup>();
  for (const descriptor of selectedDescriptors(selection)) {
    for (const group of descriptor.credentials) {
      groups.add(group);
    }
  }
  return [...groups];
}

function collectMissingCredentials(groups: readonly CredentialGroup[]): string[] {
  const missing: string[] = [];
  for (const group of groups) {
    const result = CREDENTIAL_READERS[group]();
    if (!result.ok) {
      missing.push(...result.missing);
    }
  }
  return missing;
}

function resolveCredentials(selection: readonly string[]): ResolvedCredentials {
  const groups = new Set(requiredCredentialGroupsForTags(selection));
  return {
    googleEmail: groups.has("google") ? readGoogleTestUserEmail() : null,
  };
}

/**
 * Fail loud before a run if any static prerequisite is missing: macOS host,
 * Maestro CLI, built server, and the credentials the selected tags need. Returns
 * the resolved credentials so flow env builders consume the validated values
 * rather than re-reading process.env.
 */
export function requirePrereqs(input: {
  readonly repoRoot: string;
  readonly tags: readonly string[];
}): ResolvedCredentials {
  assertMacOsHost();
  assertMaestroInstalled();
  // Only server-backed flows (pairing, agent) need the built `katacode serve`
  // binary; @smoke and @auth run without it and must not fail on a fresh setup.
  if (runNeedsServer(input.tags)) {
    resolveServerBinPath(input.repoRoot);
  }

  const missing = collectMissingCredentials(requiredCredentialGroupsForTags(input.tags));
  if (missing.length === 0) {
    return resolveCredentials(input.tags);
  }
  throw new Error(
    formatMissingPrerequisiteError(`mobile E2E (${input.tags.join(", ") || "all tags"})`, missing),
  );
}
