import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import {
  CommitSha,
  GitHubRef,
  GitHubRepository,
  ResolvedGitHubSource,
  type ResolvedGitHubSource as ResolvedGitHubSourceValue,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import {
  SandboxGitHubBranchPage,
  SandboxGitHubRepositoryPage,
  type SandboxGitHubBranchPage as SandboxGitHubBranchPageValue,
  type SandboxGitHubRepositoryPage as SandboxGitHubRepositoryPageValue,
} from "@kata-sh/code-kata-sandbox-contracts/http";
import {
  SandboxDriverError,
  type SandboxGitHubCheckoutCredential,
} from "@kata-sh/code-kata-sandbox/driver";

import * as ServerConfig from "../config.ts";
import * as GitHubCli from "../sourceControl/GitHubCli.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

const REMOTE_LINE = /^([0-9a-f]{40})\s+(\S+)$/i;
const SOURCE_ENVIRONMENT_KEYS = [
  "HOME",
  "PATH",
  "XDG_CONFIG_HOME",
  "GH_CONFIG_DIR",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "SystemRoot",
  "COMSPEC",
  "PATHEXT",
] as const;
const decodeRepositoryPage = Schema.decodeUnknownEffect(SandboxGitHubRepositoryPage);
const decodeBranchPage = Schema.decodeUnknownEffect(SandboxGitHubBranchPage);

export type SandboxGitHubAccessOperation =
  | "resolve-source"
  | "list-repositories"
  | "list-branches"
  | "checkout-credential";

export class SandboxGitHubAccessError extends Data.TaggedError("SandboxGitHubAccessError")<{
  readonly operation: SandboxGitHubAccessOperation;
  readonly message: string;
  readonly repository?: string;
  readonly ref?: string;
}> {}

export interface SandboxGitHubAccessShape {
  readonly resolve: (input: {
    readonly repository: GitHubRepository;
    readonly ref: GitHubRef;
  }) => Effect.Effect<ResolvedGitHubSourceValue, SandboxGitHubAccessError>;
  readonly listRepositories: (input: {
    readonly page: number;
  }) => Effect.Effect<SandboxGitHubRepositoryPageValue, SandboxGitHubAccessError>;
  readonly listBranches: (input: {
    readonly repository: GitHubRepository;
    readonly page: number;
  }) => Effect.Effect<SandboxGitHubBranchPageValue, SandboxGitHubAccessError>;
  readonly checkoutCredential: SandboxGitHubCheckoutCredential;
}

export class SandboxGitHubAccess extends Context.Service<
  SandboxGitHubAccess,
  SandboxGitHubAccessShape
>()("@kata-sh/code-cli/kataSandbox/SandboxGitHubAccess") {}

function fixedMessage(
  operation: SandboxGitHubAccessOperation,
  error: GitHubCli.GitHubCliError,
): string {
  if (error._tag === "GitHubCliAuthenticationError") {
    return "GitHub CLI is not authenticated. Run `gh auth login` and retry.";
  }
  if (error._tag === "GitHubCliUnavailableError") {
    return "GitHub CLI (`gh`) is required but not available on PATH.";
  }
  if (error._tag === "GitHubCliRateLimitError") {
    return "GitHub API rate limit exceeded. Try again later.";
  }
  switch (operation) {
    case "resolve-source":
      return "GitHub source ref could not be resolved.";
    case "list-repositories":
      return "GitHub repository discovery failed.";
    case "list-branches":
      return "GitHub branch discovery failed.";
    case "checkout-credential":
      return "GitHub checkout credential is unavailable. Run `gh auth login` and retry.";
  }
}

function accessError(
  operation: SandboxGitHubAccessOperation,
  error: GitHubCli.GitHubCliError,
  repository?: string,
  ref?: string,
): SandboxGitHubAccessError {
  return new SandboxGitHubAccessError({
    operation,
    message: fixedMessage(operation, error),
    ...(repository !== undefined ? { repository } : {}),
    ...(ref !== undefined ? { ref } : {}),
  });
}

function driverCredentialError(error: GitHubCli.GitHubCliError): SandboxDriverError {
  return new SandboxDriverError({
    reason: "setup-failed",
    message: fixedMessage("checkout-credential", error),
  });
}

function remoteRefCandidates(ref: string): ReadonlyArray<string> {
  if (ref.startsWith("refs/")) return [ref];
  return [`refs/heads/${ref}`, `refs/tags/${ref}`];
}

function exactRemoteRefs(ref: string): ReadonlyArray<string> {
  return remoteRefCandidates(ref).flatMap((exactRef) =>
    exactRef.startsWith("refs/tags/") ? [exactRef, exactRef + "^{}"] : [exactRef],
  );
}

/** Resolve a branch, tag, annotated tag, or explicit ref from ls-remote output. */
export function resolveRemoteSha(stdout: string, ref: string): string | undefined {
  const entries = stdout
    .split("\n")
    .map((line) => REMOTE_LINE.exec(line.trim()))
    .filter((entry): entry is RegExpExecArray => entry !== null);
  for (const exactRef of remoteRefCandidates(ref)) {
    const peeled = exactRef.startsWith("refs/tags/")
      ? entries.find((entry) => entry[2] === exactRef + "^{}")
      : undefined;
    if (peeled?.[1] !== undefined) return peeled[1];
    const direct = entries.find((entry) => entry[2] === exactRef);
    if (direct?.[1] !== undefined) return direct[1];
  }
  return undefined;
}

export function sourceEnvironment(
  hostEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
  };
  for (const key of SOURCE_ENVIRONMENT_KEYS) {
    const value = hostEnvironment[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export interface SandboxGitHubAccessDependencies {
  readonly cwd: string;
  readonly github: Pick<
    GitHubCli.GitHubCli["Service"],
    "listRepositories" | "listBranches" | "assertAuthenticated" | "withAuthTokenBytes"
  >;
  readonly vcs: Pick<VcsProcess.VcsProcess["Service"], "run">;
}

export function makeSandboxGitHubAccess(
  dependencies: SandboxGitHubAccessDependencies,
): SandboxGitHubAccessShape {
  const resolve: SandboxGitHubAccessShape["resolve"] = Effect.fn("kataSandbox.resolveSource")(
    function* (input) {
      yield* dependencies.github
        .assertAuthenticated({ cwd: dependencies.cwd })
        .pipe(
          Effect.mapError((error) =>
            accessError("resolve-source", error, input.repository, input.ref),
          ),
        );
      const remote = `https://github.com/${input.repository}.git`;
      const result = yield* dependencies.vcs
        .run({
          operation: "kata-sandbox.resolve-source",
          command: "git",
          args: [
            "-c",
            "credential.helper=",
            "-c",
            "credential.helper=!gh auth git-credential",
            "ls-remote",
            remote,
            ...exactRemoteRefs(input.ref),
          ],
          cwd: dependencies.cwd,
          env: sourceEnvironment(),
          envMode: "replace",
          timeoutMs: 30_000,
          maxOutputBytes: 64 * 1024,
        })
        .pipe(
          Effect.mapError(
            () =>
              new SandboxGitHubAccessError({
                operation: "resolve-source",
                repository: input.repository,
                ref: input.ref,
                message: "GitHub source ref could not be resolved.",
              }),
          ),
        );

      const sha = resolveRemoteSha(result.stdout, input.ref);
      if (sha === undefined) {
        return yield* new SandboxGitHubAccessError({
          operation: "resolve-source",
          repository: input.repository,
          ref: input.ref,
          message: "GitHub source ref did not resolve to a commit SHA.",
        });
      }

      const resolvedCommitSha = yield* Effect.try({
        try: () => CommitSha.make(sha),
        catch: () =>
          new SandboxGitHubAccessError({
            operation: "resolve-source",
            repository: input.repository,
            ref: input.ref,
            message: "GitHub source ref did not resolve to a commit SHA.",
          }),
      });
      return {
        repository: GitHubRepository.make(input.repository),
        ref: GitHubRef.make(input.ref),
        resolvedCommitSha,
      } satisfies ResolvedGitHubSource;
    },
  );

  const listRepositories: SandboxGitHubAccessShape["listRepositories"] = (input) =>
    dependencies.github.listRepositories({ cwd: dependencies.cwd, page: input.page }).pipe(
      Effect.mapError((error) => accessError("list-repositories", error)),
      Effect.flatMap((page) =>
        decodeRepositoryPage(page).pipe(
          Effect.mapError(
            () =>
              new SandboxGitHubAccessError({
                operation: "list-repositories",
                message: "GitHub repository discovery failed.",
              }),
          ),
        ),
      ),
    );

  const listBranches: SandboxGitHubAccessShape["listBranches"] = (input) =>
    dependencies.github
      .listBranches({ cwd: dependencies.cwd, repository: input.repository, page: input.page })
      .pipe(
        Effect.mapError((error) => accessError("list-branches", error, input.repository)),
        Effect.flatMap((page) =>
          decodeBranchPage(page).pipe(
            Effect.mapError(
              () =>
                new SandboxGitHubAccessError({
                  operation: "list-branches",
                  repository: input.repository,
                  message: "GitHub branch discovery failed.",
                }),
            ),
          ),
        ),
      );

  const checkoutCredential: SandboxGitHubCheckoutCredential = {
    withToken: (use) =>
      dependencies.github
        .withAuthTokenBytes({ cwd: dependencies.cwd }, use)
        .pipe(
          Effect.mapError((error) =>
            GitHubCli.isGitHubCliError(error) ? driverCredentialError(error) : error,
          ),
        ),
  };

  return { resolve, listRepositories, listBranches, checkoutCredential };
}

const makeLayer = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const github = yield* GitHubCli.GitHubCli;
  const vcs = yield* VcsProcess.VcsProcess;
  return makeSandboxGitHubAccess({ cwd: config.cwd, github, vcs });
});

export const layer = Layer.effect(SandboxGitHubAccess, makeLayer).pipe(
  Layer.provide(GitHubCli.layer),
  Layer.provide(VcsProcess.layer),
);
