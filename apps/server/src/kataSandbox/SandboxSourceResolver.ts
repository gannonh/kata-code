import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  CommitSha,
  GitHubRef,
  GitHubRepository,
  ResolvedGitHubSource,
  type ResolvedGitHubSource as ResolvedGitHubSourceValue,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";

export class SandboxSourceResolverError extends Data.TaggedError("SandboxSourceResolverError")<{
  readonly repository: string;
  readonly ref: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface SandboxSourceResolverShape {
  readonly resolve: (input: {
    readonly repository: GitHubRepository;
    readonly ref: GitHubRef;
  }) => Effect.Effect<ResolvedGitHubSourceValue, SandboxSourceResolverError>;
}

export class SandboxSourceResolver extends Context.Service<
  SandboxSourceResolver,
  SandboxSourceResolverShape
>()("@kata-sh/code-cli/kataSandbox/SandboxSourceResolver") {}

const remoteLine = /^([0-9a-f]{40})\s+(\S+)$/i;
const SANDBOX_BOOTSTRAP_TOKEN = "KATACODE_SANDBOX_BOOTSTRAP_TOKEN";

function exactRemoteRefs(ref: string): ReadonlyArray<string> {
  if (ref.startsWith("refs/")) return [ref];
  return [`refs/heads/${ref}`, `refs/tags/${ref}`];
}

function resolveRemoteSha(stdout: string, ref: string): string | undefined {
  const entries = stdout
    .split("\n")
    .map((line) => remoteLine.exec(line.trim()))
    .filter((entry): entry is RegExpExecArray => entry !== null);
  for (const exactRef of exactRemoteRefs(ref)) {
    const peeled = entries.find((entry) => entry[2] === exactRef + "^{}");
    if (peeled?.[1] !== undefined) return peeled[1];
    const direct = entries.find((entry) => entry[2] === exactRef);
    if (direct?.[1] !== undefined) return direct[1];
  }
  return undefined;
}

const makeResolver = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const vcs = yield* VcsProcess.VcsProcess;

  const resolve: SandboxSourceResolverShape["resolve"] = Effect.fn("kataSandbox.resolveSource")(
    function* (input) {
      const remote = `https://github.com/${input.repository}.git`;
      const sourceEnv = { ...process.env };
      delete sourceEnv[SANDBOX_BOOTSTRAP_TOKEN];
      const result = yield* vcs
        .run({
          operation: "kata-sandbox.resolve-source",
          command: "git",
          args: ["ls-remote", remote, "--", ...exactRemoteRefs(input.ref)],
          cwd: config.cwd,
          env: {
            ...sourceEnv,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "/bin/false",
          },
          timeoutMs: 30_000,
          maxOutputBytes: 64 * 1024,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new SandboxSourceResolverError({
                repository: input.repository,
                ref: input.ref,
                message: "GitHub source ref could not be resolved.",
                cause,
              }),
          ),
        );

      const sha = resolveRemoteSha(result.stdout, input.ref);
      if (sha === undefined) {
        return yield* new SandboxSourceResolverError({
          repository: input.repository,
          ref: input.ref,
          message: "GitHub source ref did not resolve to a commit SHA.",
        });
      }

      const resolvedCommitSha = CommitSha.make(sha);
      return {
        repository: GitHubRepository.make(input.repository),
        ref: GitHubRef.make(input.ref),
        resolvedCommitSha,
      } satisfies ResolvedGitHubSource;
    },
  );

  return SandboxSourceResolver.of({ resolve });
});

export const layer = Layer.effect(SandboxSourceResolver, makeResolver).pipe(
  Layer.provide(VcsProcess.layer),
);
