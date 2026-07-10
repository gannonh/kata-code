import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@kata-sh/code-contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubPullRequests from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export class GitHubCliError extends Schema.TaggedErrorClass<GitHubCliError>()("GitHubCliError", {
  operation: Schema.String,
  detail: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `GitHub CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export interface GitHubPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface GitHubRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

/** A GitHub repository accessible to the host `gh` session (source picker). */
export interface GitHubAccessibleRepository {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly visibility: "public" | "private";
}

/** One page of accessible repositories plus a `hasMore` flag (full page ⇒ more). */
export interface GitHubRepositoryPage {
  readonly repositories: ReadonlyArray<GitHubAccessibleRepository>;
  readonly hasMore: boolean;
}

/** One page of branch names plus a `hasMore` flag. */
export interface GitHubBranchPage {
  readonly branches: ReadonlyArray<string>;
  readonly hasMore: boolean;
}

export interface GitHubCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<VcsProcess.VcsProcessOutput, GitHubCliError>;

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<GitHubPullRequestSummary>, GitHubCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<GitHubPullRequestSummary, GitHubCliError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createRepository: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly visibility: SourceControlRepositoryVisibility;
  }) => Effect.Effect<GitHubRepositoryCloneUrls, GitHubCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHubCliError>;

  readonly searchRepositories: (input: {
    readonly cwd: string;
    readonly page?: number;
  }) => Effect.Effect<GitHubRepositoryPage, GitHubCliError>;

  readonly listBranches: (input: {
    readonly cwd: string;
    readonly repository: string;
    readonly page?: number;
  }) => Effect.Effect<GitHubBranchPage, GitHubCliError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHubCliError>;

  readonly getAuthToken: (input: { readonly cwd: string }) => Effect.Effect<string, GitHubCliError>;
}

export class GitHubCli extends Context.Service<GitHubCli, GitHubCliShape>()(
  "@kata-sh/code-cli/sourceControl/GitHubCli",
) {}

function errorText(error: VcsError | unknown): string {
  if (typeof error === "object" && error !== null) {
    const tag = "_tag" in error && typeof error._tag === "string" ? error._tag : "";
    const detail = "detail" in error && typeof error.detail === "string" ? error.detail : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return [tag, detail, message].filter(Boolean).join("\n");
  }

  return String(error);
}

function normalizeGitHubCliError(
  operation: "execute" | "stdout",
  error: VcsError | unknown,
): GitHubCliError {
  const text = errorText(error);
  const lower = text.toLowerCase();

  if (lower.includes("command not found: gh") || lower.includes("enoent")) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI (`gh`) is required but not available on PATH.",
      cause: error,
    });
  }

  if (
    lower.includes("authentication failed") ||
    lower.includes("not logged in") ||
    lower.includes("gh auth login") ||
    lower.includes("no oauth token")
  ) {
    return new GitHubCliError({
      operation,
      detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
      cause: error,
    });
  }

  if (
    lower.includes("could not resolve to a pullrequest") ||
    lower.includes("repository.pullrequest") ||
    lower.includes("no pull requests found for branch") ||
    lower.includes("pull request not found")
  ) {
    return new GitHubCliError({
      operation,
      detail: "Pull request not found. Check the PR number or URL and try again.",
      cause: error,
    });
  }

  return new GitHubCliError({
    operation,
    detail: text,
    cause: error,
  });
}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});

/** Page size for the source-picker discovery calls (GitHub REST max is 100). */
const DISCOVERY_PAGE_SIZE = 30;

const RawGitHubAccessibleRepositorySchema = Schema.Struct({
  full_name: TrimmedNonEmptyString,
  html_url: TrimmedNonEmptyString,
  default_branch: TrimmedNonEmptyString,
  visibility: Schema.Literals(["public", "private"]),
});
const RawGitHubAccessibleRepositoryListSchema = Schema.Array(RawGitHubAccessibleRepositorySchema);

const RawGitHubBranchSchema = Schema.Struct({ name: TrimmedNonEmptyString });
const RawGitHubBranchListSchema = Schema.Array(RawGitHubBranchSchema);

function normalizeRepositoryCloneUrls(
  raw: Schema.Schema.Type<typeof RawGitHubRepositoryCloneUrlsSchema>,
): GitHubRepositoryCloneUrls {
  return {
    nameWithOwner: raw.nameWithOwner,
    url: raw.url,
    sshUrl: raw.sshUrl,
  };
}

/**
 * `gh repo create` prints the canonical URL of the new repository on stdout
 * (e.g. `https://github.com/owner/repo`). Reading it back here avoids a
 * follow-up `gh repo view`, which can race GitHub's GraphQL eventual
 * consistency window and falsely report the just-created repo as missing.
 */
function deriveRepositoryCloneUrlsFromCreateOutput(
  stdout: string,
  repository: string,
): GitHubRepositoryCloneUrls {
  const fallbackHost = "github.com";
  const match = stdout.match(/https?:\/\/[^\s]+/);
  if (match) {
    const cleaned = match[0].replace(/\.git$/, "");
    try {
      const parsed = new URL(cleaned);
      const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length === 2) {
        const nameWithOwner = `${segments[0]}/${segments[1]}`;
        return {
          nameWithOwner,
          url: `${parsed.origin}/${nameWithOwner}`,
          sshUrl: `git@${parsed.host}:${nameWithOwner}.git`,
        };
      }
    } catch {
      // Fall through to the input-derived defaults below.
    }
  }
  return {
    nameWithOwner: repository,
    url: `https://${fallbackHost}/${repository}`,
    sshUrl: `git@${fallbackHost}:${repository}.git`,
  };
}

function decodeGitHubJson<S extends Schema.Top>(
  raw: string,
  schema: S,
  operation:
    | "listOpenPullRequests"
    | "getPullRequest"
    | "getRepositoryCloneUrls"
    | "searchRepositories"
    | "listBranches",
  invalidDetail: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
    Effect.mapError(
      (error) =>
        new GitHubCliError({
          operation,
          detail: `${invalidDetail}: ${SchemaIssue.makeFormatterDefault()(error.issue)}`,
          cause: error,
        }),
    ),
  );
}

export const make = Effect.fn("makeGitHubCli")(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCliShape["execute"] = (input) =>
    process
      .run({
        operation: "GitHubCli.execute",
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })
      .pipe(Effect.mapError((error) => normalizeGitHubCliError("execute", error)));

  return GitHubCli.of({
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          input.headSelector,
          "--state",
          "open",
          "--limit",
          String(input.limit ?? 1),
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubCliError({
                        operation: "listOpenPullRequests",
                        detail: `GitHub CLI returned invalid PR list JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                        cause: decoded.failure,
                      }),
                    );
                  }

                  return Effect.succeed(
                    decoded.success.map(({ updatedAt: _updatedAt, ...summary }) => summary),
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "view",
          input.reference,
          "--json",
          "number,title,url,baseRefName,headRefName,state,mergedAt,isCrossRepository,headRepository,headRepositoryOwner",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => GitHubPullRequests.decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubCliError({
                    operation: "getPullRequest",
                    detail: `GitHub CLI returned invalid pull request JSON: ${GitHubPullRequests.formatGitHubJsonDecodeError(decoded.failure)}`,
                    cause: decoded.failure,
                  }),
                );
              }

              return Effect.succeed(
                (({ updatedAt: _updatedAt, ...summary }) => summary)(decoded.success),
              );
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", input.repository, "--json", "nameWithOwner,url,sshUrl"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubRepositoryCloneUrlsSchema,
            "getRepositoryCloneUrls",
            "GitHub CLI returned invalid repository JSON.",
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository, `--${input.visibility}`],
      }).pipe(
        Effect.map((result) =>
          deriveRepositoryCloneUrlsFromCreateOutput(result.stdout, input.repository),
        ),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.baseBranch,
          "--head",
          input.headSelector,
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      }).pipe(
        Effect.map((value) => {
          const trimmed = value.stdout.trim();
          return trimmed.length > 0 ? trimmed : null;
        }),
      ),
    searchRepositories: (input) => {
      const page = input.page ?? 1;
      return execute({
        cwd: input.cwd,
        args: [
          "api",
          "--method",
          "GET",
          "/user/repos",
          "-f",
          "affiliation=owner,collaborator,organization",
          "-f",
          "sort=updated",
          "-F",
          `per_page=${DISCOVERY_PAGE_SIZE}`,
          "-F",
          `page=${page}`,
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubAccessibleRepositoryListSchema,
            "searchRepositories",
            "GitHub CLI returned invalid repository list JSON.",
          ),
        ),
        Effect.map((rows) => ({
          repositories: rows.map((row) => ({
            nameWithOwner: row.full_name,
            url: row.html_url,
            defaultBranch: row.default_branch,
            visibility: row.visibility,
          })),
          hasMore: rows.length === DISCOVERY_PAGE_SIZE,
        })),
      );
    },
    listBranches: (input) => {
      const page = input.page ?? 1;
      return execute({
        cwd: input.cwd,
        args: [
          "api",
          "--method",
          "GET",
          `/repos/${input.repository}/branches`,
          "-F",
          `per_page=${DISCOVERY_PAGE_SIZE}`,
          "-F",
          `page=${page}`,
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          decodeGitHubJson(
            raw,
            RawGitHubBranchListSchema,
            "listBranches",
            "GitHub CLI returned invalid branch list JSON.",
          ),
        ),
        Effect.map((rows) => ({
          branches: rows.map((row) => row.name),
          hasMore: rows.length === DISCOVERY_PAGE_SIZE,
        })),
      );
    },
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
    getAuthToken: (input) =>
      execute({
        cwd: input.cwd,
        args: ["auth", "token", "--hostname", "github.com"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((token) =>
          token.length > 0
            ? Effect.succeed(token)
            : Effect.fail(
                new GitHubCliError({
                  operation: "getAuthToken",
                  detail: "GitHub CLI is not authenticated. Run `gh auth login` and retry.",
                }),
              ),
        ),
      ),
  });
});

export const layer = Layer.effect(GitHubCli, make());
