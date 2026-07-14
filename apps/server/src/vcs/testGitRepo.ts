/**
 * Shared git fixtures for server tests: build one committed template repo, then
 * clone it per test instead of paying init/config/add/commit on every case.
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";

import { GitCommandError } from "@kata-sh/code-contracts";

import * as GitVcsDriver from "./GitVcsDriver.ts";

let sharedTemplateDir: string | null = null;
let sharedInitialBranch: string | null = null;

const runGitInDir = (
  cwd: string,
  args: readonly string[],
): Effect.Effect<string, GitCommandError, GitVcsDriver.GitVcsDriver> =>
  Effect.gen(function* () {
    const git = yield* GitVcsDriver.GitVcsDriver;
    const result = yield* git.execute({
      operation: "testGitRepo.runGit",
      cwd,
      args,
      timeoutMs: 30_000,
    });
    return result.stdout.trim();
  });

/**
 * Create (once per process) a committed git template with user identity and README.
 * Not Scope-scoped — lives until the test process exits.
 */
export const ensureGitRepoTemplate: Effect.Effect<
  { readonly templateDir: string; readonly initialBranch: string },
  PlatformError.PlatformError | GitCommandError,
  FileSystem.FileSystem | Path.Path | GitVcsDriver.GitVcsDriver
> = Effect.gen(function* () {
  if (sharedTemplateDir && sharedInitialBranch) {
    return { templateDir: sharedTemplateDir, initialBranch: sharedInitialBranch };
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const templateDir = yield* fileSystem.makeTempDirectory({
    prefix: "katacode-git-template-",
  });

  yield* runGitInDir(templateDir, ["init", "--initial-branch=main"]);
  yield* runGitInDir(templateDir, ["config", "user.email", "test@example.com"]);
  yield* runGitInDir(templateDir, ["config", "user.name", "Test User"]);
  yield* fileSystem.writeFileString(path.join(templateDir, "README.md"), "hello\n");
  yield* runGitInDir(templateDir, ["add", "README.md"]);
  yield* runGitInDir(templateDir, ["commit", "-m", "initial commit"]);
  const initialBranch = yield* runGitInDir(templateDir, ["branch", "--show-current"]);

  sharedTemplateDir = templateDir;
  sharedInitialBranch = initialBranch.length > 0 ? initialBranch : "main";
  return { templateDir: sharedTemplateDir, initialBranch: sharedInitialBranch };
});

/**
 * Clone the shared template into a scoped temp directory.
 * Removes the default `origin` remote so callers can attach their own remotes.
 */
export const cloneGitRepoFromTemplate = (
  prefix = "katacode-git-repo-",
): Effect.Effect<
  { readonly cwd: string; readonly initialBranch: string },
  PlatformError.PlatformError | GitCommandError,
  FileSystem.FileSystem | Path.Path | Scope.Scope | GitVcsDriver.GitVcsDriver
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const { templateDir, initialBranch } = yield* ensureGitRepoTemplate;
    const parent = yield* fileSystem.makeTempDirectoryScoped({ prefix: `${prefix}parent-` });
    const cwd = path.join(parent, "repo");

    // Use clone --local so we skip re-init/config/commit. Drop origin so tests
    // that `remote add origin` do not collide with the template path remote.
    yield* runGitInDir(parent, ["clone", "--local", templateDir, "repo"]);
    yield* runGitInDir(cwd, ["remote", "remove", "origin"]).pipe(Effect.ignore);

    // Ensure identity exists even if clone omitted some local config keys.
    yield* runGitInDir(cwd, ["config", "user.email", "test@example.com"]);
    yield* runGitInDir(cwd, ["config", "user.name", "Test User"]);

    return { cwd, initialBranch };
  });

/** @internal test-only — reset the process-wide template cache. */
export function resetGitRepoTemplateCacheForTests(): void {
  sharedTemplateDir = null;
  sharedInitialBranch = null;
}
