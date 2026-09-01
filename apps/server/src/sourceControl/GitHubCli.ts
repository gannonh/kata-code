import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@kata-sh/code-contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  decodeGitHubPullRequestJson,
  decodeGitHubPullRequestListJson,
} from "./gitHubPullRequests.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

const gitHubCliFailureFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubCliUnavailableError extends Schema.TaggedErrorClass<GitHubCliUnavailableError>()(
  "GitHubCliUnavailableError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI (`gh`) is required but not available on PATH.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliAuthenticationError extends Schema.TaggedErrorClass<GitHubCliAuthenticationError>()(
  "GitHubCliAuthenticationError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI is not authenticated. Run `gh auth login` and retry.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliRateLimitError extends Schema.TaggedErrorClass<GitHubCliRateLimitError>()(
  "GitHubCliRateLimitError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub API rate limit exceeded. Run `gh api rate_limit` to inspect the quota and reset time.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubPullRequestNotFoundError extends Schema.TaggedErrorClass<GitHubPullRequestNotFoundError>()(
  "GitHubPullRequestNotFoundError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "Pull request not found. Check the PR number or URL and try again.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

export class GitHubCliCommandError extends Schema.TaggedErrorClass<GitHubCliCommandError>()(
  "GitHubCliCommandError",
  gitHubCliFailureFields,
) {
  get detail(): string {
    return "GitHub CLI command failed.";
  }

  override get message(): string {
    return `GitHub CLI failed in execute: ${this.detail}`;
  }
}

const gitHubCliDecodeFields = {
  command: Schema.Literal("gh"),
  cwd: Schema.String,
  cause: Schema.Defect(),
} as const;

export class GitHubPullRequestListDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestListDecodeError>()(
  "GitHubPullRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid PR list JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listOpenPullRequests: ${this.detail}`;
  }
}

export class GitHubChangeRequestListDecodeError extends Schema.TaggedErrorClass<GitHubChangeRequestListDecodeError>()(
  "GitHubChangeRequestListDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid change request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in listChangeRequests: ${this.detail}`;
  }
}

export class GitHubPullRequestDecodeError extends Schema.TaggedErrorClass<GitHubPullRequestDecodeError>()(
  "GitHubPullRequestDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid pull request JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getPullRequest: ${this.detail}`;
  }
}

export class GitHubRepositoryDecodeError extends Schema.TaggedErrorClass<GitHubRepositoryDecodeError>()(
  "GitHubRepositoryDecodeError",
  gitHubCliDecodeFields,
) {
  get detail(): string {
    return "GitHub CLI returned invalid repository JSON.";
  }

  override get message(): string {
    return `GitHub CLI failed in getRepositoryCloneUrls: ${this.detail}`;
  }
}

export const GitHubCliError = Schema.Union([
  GitHubCliUnavailableError,
  GitHubCliAuthenticationError,
  GitHubCliRateLimitError,
  GitHubPullRequestNotFoundError,
  GitHubCliCommandError,
  GitHubPullRequestListDecodeError,
  GitHubChangeRequestListDecodeError,
  GitHubPullRequestDecodeError,
  GitHubRepositoryDecodeError,
]);
export type GitHubCliError = typeof GitHubCliError.Type;

export const isGitHubCliError = Schema.is(GitHubCliError);

export function fromVcsError(
  context: {
    readonly command: "gh";
    readonly cwd: string;
  },
  error: VcsError,
): GitHubCliError {
  if (
    error._tag === "VcsProcessSpawnError" &&
    error.cause instanceof PlatformError.PlatformError &&
    error.cause.reason._tag === "NotFound" &&
    error.cause.reason.module === "ChildProcess" &&
    error.cause.reason.method === "spawn"
  ) {
    return new GitHubCliUnavailableError({ ...context, cause: error });
  }

  if (error._tag === "VcsProcessExitError") {
    if (error.failureKind === "authentication") {
      return new GitHubCliAuthenticationError({ ...context, cause: error });
    }
    if (error.failureKind === "rate-limited") {
      return new GitHubCliRateLimitError({ ...context, cause: error });
    }
    if (error.failureKind === "not-found") {
      return new GitHubPullRequestNotFoundError({ ...context, cause: error });
    }
  }

  return new GitHubCliCommandError({ ...context, cause: error });
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

export interface GitHubAccessibleRepository {
  readonly nameWithOwner: string;
  readonly defaultBranch: string;
  readonly visibility: "public" | "private" | "internal";
}

export interface GitHubRepositoryPage {
  readonly repositories: ReadonlyArray<GitHubAccessibleRepository>;
  readonly page: number;
  readonly hasMore: boolean;
}

export interface GitHubBranchPage {
  readonly branches: ReadonlyArray<string>;
  readonly page: number;
  readonly hasMore: boolean;
}

export class GitHubCli extends Context.Service<
  GitHubCli,
  {
    readonly execute: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly timeoutMs?: number;
      /** Piped to the child's stdin, for payloads that must never appear in argv. */
      readonly stdin?: string;
      readonly env?: NodeJS.ProcessEnv;
      readonly maxOutputBytes?: number;
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

    readonly listRepositories: (input: {
      readonly cwd: string;
      readonly page: number;
    }) => Effect.Effect<GitHubRepositoryPage, GitHubCliError>;

    readonly listBranches: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly page: number;
    }) => Effect.Effect<GitHubBranchPage, GitHubCliError>;

    readonly assertAuthenticated: (input: {
      readonly cwd: string;
    }) => Effect.Effect<void, GitHubCliError>;

    readonly withAuthTokenBytes: <A, E, R>(
      input: { readonly cwd: string },
      use: (token: Uint8Array) => Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | GitHubCliError, R>;

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

    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, GitHubCliError>;
  }
>()("@kata-sh/code-cli/sourceControl/GitHubCli") {}

const RawGitHubRepositoryCloneUrlsSchema = Schema.Struct({
  nameWithOwner: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  sshUrl: TrimmedNonEmptyString,
});
const decodeRawGitHubRepositoryCloneUrls = Schema.decodeEffect(
  Schema.fromJsonString(RawGitHubRepositoryCloneUrlsSchema),
);

const RawGitHubAccessibleRepositorySchema = Schema.Struct({
  full_name: TrimmedNonEmptyString,
  default_branch: TrimmedNonEmptyString,
  visibility: Schema.Literals(["public", "private", "internal"]),
});
const RawGitHubAccessibleRepositoryPageSchema = Schema.Array(RawGitHubAccessibleRepositorySchema);
const RawGitHubBranchSchema = Schema.Struct({ name: TrimmedNonEmptyString });
const RawGitHubBranchPageSchema = Schema.Array(RawGitHubBranchSchema);

function includedJsonBody(stdout: string): string {
  const firstArray = stdout.indexOf("[");
  return firstArray >= 0 ? stdout.slice(firstArray).trim() : stdout.trim();
}

function trimAsciiWhitespace(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.byteLength;
  while (start < end && bytes[start]! <= 0x20) start += 1;
  while (end > start && bytes[end - 1]! <= 0x20) end -= 1;
  return bytes.subarray(start, end);
}

function useAuthTokenBytes<A, E, R>(
  process: Pick<VcsProcess.VcsProcess["Service"], "runBytes">,
  input: { readonly cwd: string },
  use: (token: Uint8Array) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | GitHubCliError, R> {
  return Effect.acquireUseRelease(
    process
      .runBytes({
        operation: "GitHubCli.withAuthTokenBytes",
        command: "gh",
        args: ["auth", "token", "--hostname", "github.com"],
        cwd: input.cwd,
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxOutputBytes: 64 * 1024,
      })
      .pipe(Effect.mapError((error) => fromVcsError({ command: "gh", cwd: input.cwd }, error))),
    (result): Effect.Effect<A, E | GitHubCliAuthenticationError, R> => {
      const token = trimAsciiWhitespace(result.stdout);
      if (token.byteLength > 0) return use(token);
      return Effect.fail(
        new GitHubCliAuthenticationError({
          command: "gh",
          cwd: input.cwd,
          cause: "GitHub CLI output omitted.",
        }),
      );
    },
    (result) =>
      Effect.sync(() => {
        result.stdout.fill(0);
        result.stderr.fill(0);
      }),
  );
}

function includesNextLink(stdout: string): boolean {
  return /(?:^|\n)\s*link:\s*[^\n]*rel=["']?next["']?/iu.test(stdout);
}

function decodeIncludedJson<S extends Schema.Top>(
  stdout: string,
  schema: S,
  cwd: string,
): Effect.Effect<S["Type"], GitHubCliError, S["DecodingServices"]> {
  return Schema.decodeEffect(Schema.fromJsonString(schema))(includedJsonBody(stdout)).pipe(
    Effect.mapError(
      () =>
        new GitHubCliCommandError({
          command: "gh",
          cwd,
          cause: "GitHub CLI output omitted.",
        }),
    ),
  );
}

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

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const execute: GitHubCli["Service"]["execute"] = (input) =>
    process
      .run({
        operation: "GitHubCli.execute",
        command: "gh",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(input.stdin !== undefined ? { stdin: input.stdin } : {}),
        ...(input.env !== undefined ? { env: input.env } : {}),
        ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
      })
      .pipe(Effect.mapError((error) => fromVcsError({ command: "gh", cwd: input.cwd }, error)));

  const executeSafe = (input: Parameters<typeof execute>[0]) =>
    execute(input).pipe(
      Effect.mapError((error): GitHubCliError => {
        switch (error._tag) {
          case "GitHubCliUnavailableError":
            return new GitHubCliUnavailableError({
              command: "gh",
              cwd: input.cwd,
              cause: "GitHub CLI output omitted.",
            });
          case "GitHubCliAuthenticationError":
            return new GitHubCliAuthenticationError({
              command: "gh",
              cwd: input.cwd,
              cause: "GitHub CLI output omitted.",
            });
          case "GitHubCliRateLimitError":
            return new GitHubCliRateLimitError({
              command: "gh",
              cwd: input.cwd,
              cause: "GitHub CLI output omitted.",
            });
          case "GitHubPullRequestNotFoundError":
            return new GitHubPullRequestNotFoundError({
              command: "gh",
              cwd: input.cwd,
              cause: "GitHub CLI output omitted.",
            });
          default:
            return new GitHubCliCommandError({
              command: "gh",
              cwd: input.cwd,
              cause: "GitHub CLI output omitted.",
            });
        }
      }),
    );

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
            : Effect.sync(() => decodeGitHubPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new GitHubPullRequestListDecodeError({
                        command: "gh",
                        cwd: input.cwd,
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
          Effect.sync(() => decodeGitHubPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new GitHubPullRequestDecodeError({
                    command: "gh",
                    cwd: input.cwd,
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
          decodeRawGitHubRepositoryCloneUrls(raw).pipe(
            Effect.mapError(
              (cause) =>
                new GitHubRepositoryDecodeError({
                  command: "gh",
                  cwd: input.cwd,
                  cause,
                }),
            ),
          ),
        ),
        Effect.map(normalizeRepositoryCloneUrls),
      ),
    listRepositories: (input) =>
      executeSafe({
        cwd: input.cwd,
        args: [
          "api",
          "--method",
          "GET",
          "--include",
          "/user/repos",
          "-f",
          "affiliation=owner,collaborator,organization_member",
          "-f",
          "sort=updated",
          "-F",
          "per_page=30",
          "-F",
          `page=${input.page}`,
        ],
      }).pipe(
        Effect.flatMap((result) =>
          decodeIncludedJson(
            result.stdout,
            RawGitHubAccessibleRepositoryPageSchema,
            input.cwd,
          ).pipe(
            Effect.map((rows) => ({
              repositories: rows.map((row) => ({
                nameWithOwner: row.full_name,
                defaultBranch: row.default_branch,
                visibility: row.visibility,
              })),
              page: input.page,
              hasMore: includesNextLink(result.stdout),
            })),
          ),
        ),
      ),
    listBranches: (input) =>
      executeSafe({
        cwd: input.cwd,
        args: [
          "api",
          "--method",
          "GET",
          "--include",
          `/repos/${input.repository}/branches`,
          "-F",
          "per_page=30",
          "-F",
          `page=${input.page}`,
        ],
      }).pipe(
        Effect.flatMap((result) =>
          decodeIncludedJson(result.stdout, RawGitHubBranchPageSchema, input.cwd).pipe(
            Effect.map((rows) => ({
              branches: rows.map((row) => row.name),
              page: input.page,
              hasMore: includesNextLink(result.stdout),
            })),
          ),
        ),
      ),
    assertAuthenticated: (input) =>
      executeSafe({
        cwd: input.cwd,
        args: ["auth", "status", "--hostname", "github.com"],
        maxOutputBytes: 64 * 1024,
      }).pipe(
        Effect.mapError((error) =>
          error._tag === "GitHubCliUnavailableError"
            ? error
            : new GitHubCliAuthenticationError({
                command: "gh",
                cwd: input.cwd,
                cause: "GitHub CLI output omitted.",
              }),
        ),
        Effect.asVoid,
      ),
    withAuthTokenBytes: (input, use) => useAuthTokenBytes(process, input, use),
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
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(GitHubCli, make);
