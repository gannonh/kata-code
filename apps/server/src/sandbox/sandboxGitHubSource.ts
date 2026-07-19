/**
 * `sandboxGitHubSource` — pure helpers for sandbox GitHub source selection.
 *
 * Docker and Vercel sandbox targets share one `{ repository, branch }` source
 * shape. These helpers derive the canonical repository key (matching
 * `RepositoryIdentity.canonicalKey`, so saved per-repo settings key
 * consistently), the HTTPS clone URL, and a non-secret source fingerprint the
 * session store persists to guard against a changed source on lifecycle start.
 *
 * @module sandboxGitHubSource
 */
// @effect-diagnostics nodeBuiltinImport:off - node:crypto for the source-fingerprint hash.
import * as NodeCrypto from "node:crypto";

import { normalizeGitRemoteUrl } from "@kata-sh/code-shared/git";

/** A resolved GitHub source: the selected repo/branch plus derived clone URL
 *  and canonical key. */
export interface ResolvedSandboxGitHubSource {
  /** Canonical `owner/name` as selected. */
  readonly repository: string;
  /** Selected branch. */
  readonly branch: string;
  /** `github.com/<owner>/<name>` (lowercased), the saved-env map key. */
  readonly repositoryKey: string;
  /** HTTPS clone URL for native or in-container clone. */
  readonly httpsUrl: string;
}

/** Build the HTTPS clone URL for an `owner/name` GitHub repository. */
export function buildGitHubHttpsUrl(repository: string): string {
  return `https://github.com/${repository}.git`;
}

/** Derive the canonical repository key for an `owner/name` GitHub repository,
 *  reusing `normalizeGitRemoteUrl` so it matches host-project identities. */
export function deriveGitHubRepositoryKey(repository: string): string {
  return normalizeGitRemoteUrl(buildGitHubHttpsUrl(repository));
}

/** Read a `{ source: { repository, branch } }` payload from decoded sandbox
 *  config and resolve it. Returns `null` when no complete source is present. */
export function resolveSandboxGitHubSource(config: unknown): ResolvedSandboxGitHubSource | null {
  if (config === null || typeof config !== "object") return null;
  const source = (config as { source?: unknown }).source;
  if (source === null || typeof source !== "object") return null;
  const repository = (source as { repository?: unknown }).repository;
  const branch = (source as { branch?: unknown }).branch;
  if (
    typeof repository !== "string" ||
    repository.trim().length === 0 ||
    typeof branch !== "string" ||
    branch.trim().length === 0
  ) {
    return null;
  }
  const trimmedRepository = repository.trim();
  const trimmedBranch = branch.trim();
  return {
    repository: trimmedRepository,
    branch: trimmedBranch,
    repositoryKey: deriveGitHubRepositoryKey(trimmedRepository),
    httpsUrl: buildGitHubHttpsUrl(trimmedRepository),
  };
}

/** Compute a non-secret fingerprint for a source selection. Persisted with the
 *  session record so lifecycle start can reject a changed source. */
export function sourceFingerprint(input: {
  readonly repositoryKey: string;
  readonly branch: string;
}): string {
  return NodeCrypto.createHash("sha256")
    .update(`${input.repositoryKey}\u0000${input.branch}`)
    .digest("hex");
}
