/**
 * `sandboxGitHubDiscovery` — server-side GitHub repository/branch discovery for
 * the Vercel sandbox source picker.
 *
 * Wraps the host `GitHubCli` so the browser never receives a token or runs
 * `gh`. Repository search and branch listing return only display metadata plus
 * pagination flags. GitHub CLI errors (unauthenticated, unavailable, malformed
 * response) map to the sandbox RPC error channel with the concrete recovery
 * message.
 *
 * @module sandboxGitHubDiscovery
 */
import * as Effect from "effect/Effect";

import { SandboxRpcError } from "@kata-sh/code-contracts/sandboxRpc";
import type {
  SandboxListGitHubBranchesResult,
  SandboxSearchGitHubRepositoriesResult,
} from "@kata-sh/code-contracts/sandboxRpc";

import type { GitHubCliError, GitHubCliShape } from "../sourceControl/GitHubCli.ts";

/** Map a GitHub CLI failure to the sandbox RPC error channel. */
function mapGitHubError(error: GitHubCliError): SandboxRpcError {
  return new SandboxRpcError({ reason: "invalid-config", message: error.detail });
}

/** Search accessible GitHub repositories via the host `gh` session. */
export function searchGitHubRepositories(input: {
  readonly github: GitHubCliShape;
  readonly cwd: string;
  readonly page?: number;
}): Effect.Effect<SandboxSearchGitHubRepositoriesResult, SandboxRpcError> {
  return input.github
    .searchRepositories({
      cwd: input.cwd,
      ...(input.page !== undefined ? { page: input.page } : {}),
    })
    .pipe(
      Effect.map((result) => ({
        repositories: result.repositories.map((repository) => ({
          nameWithOwner: repository.nameWithOwner,
          url: repository.url,
          defaultBranch: repository.defaultBranch,
          visibility: repository.visibility,
        })),
        hasMore: result.hasMore,
      })),
      Effect.mapError(mapGitHubError),
    );
}

/** List branches of a selected GitHub repository via the host `gh` session. */
export function listGitHubBranches(input: {
  readonly github: GitHubCliShape;
  readonly cwd: string;
  readonly repository: string;
  readonly page?: number;
}): Effect.Effect<SandboxListGitHubBranchesResult, SandboxRpcError> {
  return input.github
    .listBranches({
      cwd: input.cwd,
      repository: input.repository,
      ...(input.page !== undefined ? { page: input.page } : {}),
    })
    .pipe(
      Effect.map((result) => ({
        branches: result.branches,
        hasMore: result.hasMore,
      })),
      Effect.mapError(mapGitHubError),
    );
}
