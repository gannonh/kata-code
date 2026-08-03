// @effect-diagnostics nodeBuiltinImport:off - pinned base-commit resolution and canonical status capture run real git commands.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  TaskWorkspaceSourceError,
  TaskWorkspaceSourceErrorKind,
  TaskWorkspaceSourceResolver,
  type TaskWorkspaceSourceResolution,
  type TaskWorkspaceSourceResolverShape,
} from "../Services/TaskWorkspaceSourceResolver.ts";

const execFileAsync = promisify(execFile);

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function runGit(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, TaskWorkspaceSourceError> {
  return Effect.tryPromise({
    try: async () => {
      const { stdout } = await execFileAsync("git", [...args], { cwd, encoding: "utf8" });
      return stdout.trim();
    },
    catch: () =>
      new TaskWorkspaceSourceError(
        TaskWorkspaceSourceErrorKind.InvalidBaseRef,
        `Failed to resolve base ref in '${cwd}'.`,
      ),
  });
}

function resolveCommit(
  cwd: string,
  baseRef: string,
): Effect.Effect<string, TaskWorkspaceSourceError> {
  return runGit(cwd, ["rev-parse", "--verify", `${baseRef}^{commit}`]).pipe(
    Effect.mapError(
      (cause) =>
        new TaskWorkspaceSourceError(
          TaskWorkspaceSourceErrorKind.InvalidBaseRef,
          `Base ref '${baseRef}' does not resolve to a commit: ${cause.detail}`,
        ),
    ),
  );
}

function planningRootFingerprint(headSha: string, statusPorcelain: string): string {
  return createHash("sha256").update(`${headSha}\n${statusPorcelain}`).digest("hex");
}

const makeResolver = Effect.gen(function* () {
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;

  const resolve: TaskWorkspaceSourceResolverShape["resolve"] = ({
    projectId,
    baseRef,
    worktreePolicy,
  }) =>
    Effect.gen(function* () {
      const shell = yield* projectionSnapshotQuery
        .getProjectShellById(projectId)
        .pipe(
          Effect.mapError(
            (cause) =>
              new TaskWorkspaceSourceError(
                TaskWorkspaceSourceErrorKind.ProjectNotFound,
                `Failed to read project '${projectId}': ${describe(cause)}`,
              ),
          ),
        );
      if (Option.isNone(shell)) {
        return yield* Effect.fail(
          new TaskWorkspaceSourceError(
            TaskWorkspaceSourceErrorKind.ProjectNotFound,
            `Project '${projectId}' was not found in this environment.`,
          ),
        );
      }
      const project = shell.value;
      if (project.repositoryIdentity === null || project.repositoryIdentity === undefined) {
        return yield* Effect.fail(
          new TaskWorkspaceSourceError(
            TaskWorkspaceSourceErrorKind.NotARepository,
            `Project '${projectId}' is not bound to a repository.`,
          ),
        );
      }
      const workspaceRoot = project.workspaceRoot;
      const baseCommitSha = yield* resolveCommit(workspaceRoot, baseRef);

      if (worktreePolicy === "now") {
        // Planning runs in a fresh worktree; the fingerprint is recorded after
        // clean provisioning, not from the source checkout.
        return {
          workspaceRoot,
          baseCommitSha,
          planningRootFingerprint: null,
        } satisfies TaskWorkspaceSourceResolution;
      }

      // Later and Never run pre-Implement sessions against the source
      // repository: it must be clean and exactly at the pinned base commit.
      const headSha = yield* runGit(workspaceRoot, ["rev-parse", "HEAD"]).pipe(
        Effect.mapError(
          (cause) =>
            new TaskWorkspaceSourceError(
              TaskWorkspaceSourceErrorKind.NotARepository,
              `Failed to resolve HEAD in '${workspaceRoot}': ${describe(cause)}`,
            ),
        ),
      );
      if (headSha !== baseCommitSha) {
        return yield* Effect.fail(
          new TaskWorkspaceSourceError(
            TaskWorkspaceSourceErrorKind.SourceNotAtBase,
            `The source checkout is at ${headSha.slice(0, 12)} but the pinned base commit is ${baseCommitSha.slice(0, 12)}. Check out the base ref before creating the task.`,
          ),
        );
      }
      const statusPorcelain = yield* runGit(workspaceRoot, ["status", "--porcelain=v2"]).pipe(
        Effect.mapError(
          (cause) =>
            new TaskWorkspaceSourceError(
              TaskWorkspaceSourceErrorKind.DirtySource,
              `Failed to read the source status: ${describe(cause)}`,
            ),
        ),
      );
      if (statusPorcelain !== "") {
        return yield* Effect.fail(
          new TaskWorkspaceSourceError(
            TaskWorkspaceSourceErrorKind.DirtySource,
            "The source checkout has uncommitted changes. Commit or stash them before creating the task.",
          ),
        );
      }
      return {
        workspaceRoot,
        baseCommitSha,
        planningRootFingerprint: planningRootFingerprint(headSha, statusPorcelain),
      } satisfies TaskWorkspaceSourceResolution;
    });

  return { resolve } satisfies TaskWorkspaceSourceResolverShape;
});

export const TaskWorkspaceSourceResolverLive = Layer.effect(
  TaskWorkspaceSourceResolver,
  makeResolver,
);
