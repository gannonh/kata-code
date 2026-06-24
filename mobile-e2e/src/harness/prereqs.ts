import { MOBILE_E2E_TAGS } from "../config/tags.ts";
import {
  assertMacOsHost,
  formatMissingPrerequisiteError,
  readAgentProviderPrerequisites,
  readClerkPrerequisites,
  readGoogleTestUserPrerequisites,
} from "./env.ts";
import { assertMaestroInstalled } from "./maestroRunner.ts";
import { resolveServerBinPath } from "./serverStack.ts";

export type CredentialGroup = "clerk" | "google" | "agent";

/**
 * Map the selected tags to the credential groups their flows require. An empty
 * tag list means "run everything", so all groups are required. Pure so the
 * gating rules are unit-tested.
 */
export function requiredCredentialGroupsForTags(tags: readonly string[]): CredentialGroup[] {
  const groups = new Set<CredentialGroup>();
  const runsAll = tags.length === 0;

  const wants = (tag: string): boolean => runsAll || tags.includes(tag);

  if (wants(MOBILE_E2E_TAGS.auth)) {
    groups.add("clerk");
    groups.add("google");
  }
  if (wants(MOBILE_E2E_TAGS.agent)) {
    groups.add("agent");
  }
  return [...groups];
}

/**
 * Whether a run needs the loopback server + project. Only @smoke (app launch)
 * runs without one; any other tag, or an unfiltered run, pairs to a server.
 */
export function runNeedsServer(tags: readonly string[]): boolean {
  if (tags.length === 0) {
    return true;
  }
  return tags.some((tag) => tag !== MOBILE_E2E_TAGS.smoke);
}

function collectMissingCredentials(groups: readonly CredentialGroup[]): string[] {
  const missing: string[] = [];
  for (const group of groups) {
    const result =
      group === "clerk"
        ? readClerkPrerequisites()
        : group === "google"
          ? readGoogleTestUserPrerequisites()
          : readAgentProviderPrerequisites();
    if (!result.ok) {
      missing.push(...result.missing);
    }
  }
  return missing;
}

/**
 * Fail loud before a run if any static prerequisite is missing: macOS host,
 * Maestro CLI, built server, and the credentials the selected tags need.
 * Simulator and installed-dev-client checks run later, once a sim is booted.
 */
export function requirePrereqs(input: {
  readonly repoRoot: string;
  readonly tags: readonly string[];
}): void {
  assertMacOsHost();
  assertMaestroInstalled();
  resolveServerBinPath(input.repoRoot);

  const missing = collectMissingCredentials(requiredCredentialGroupsForTags(input.tags));
  if (missing.length > 0) {
    throw new Error(
      formatMissingPrerequisiteError(
        `mobile E2E (${input.tags.join(", ") || "all tags"})`,
        missing,
      ),
    );
  }
}
