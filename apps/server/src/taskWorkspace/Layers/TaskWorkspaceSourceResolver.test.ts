// @effect-diagnostics nodeBuiltinImport:off - the resolver test creates a real temporary Git repository.
import { execFile } from "node:child_process";
import * as NodeFs from "node:fs/promises";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";
import { promisify } from "node:util";

import { ProjectId } from "@kata-sh/code-contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  TaskWorkspaceSourceError,
  TaskWorkspaceSourceErrorKind,
  TaskWorkspaceSourceResolver,
} from "../Services/TaskWorkspaceSourceResolver.ts";
import { TaskWorkspaceSourceResolverLive } from "./TaskWorkspaceSourceResolver.ts";

const execFileAsync = promisify(execFile);

const projectId = ProjectId.make("project-1");

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Kata Code Test",
      GIT_AUTHOR_EMAIL: "test@kata.sh",
      GIT_COMMITTER_NAME: "Kata Code Test",
      GIT_COMMITTER_EMAIL: "test@kata.sh",
    },
  });
  return stdout.trim();
}

function makeProjection(workspaceRoot: string): ProjectionSnapshotQueryShape {
  return {
    getProjectShellById: () =>
      Effect.succeed(
        Option.some({
          id: projectId,
          title: "Resolver project",
          workspaceRoot,
          repositoryIdentity: {
            canonicalKey: "github.com/example/project",
            locator: {
              source: "git-remote",
              remoteName: "origin",
              remoteUrl: "https://github.com/example/project.git",
            },
          },
          defaultModelSelection: null,
          scripts: [],
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        }),
      ),
  } as unknown as ProjectionSnapshotQueryShape;
}

const makeResolver = (workspaceRoot: string) =>
  Effect.gen(function* () {
    const layer = TaskWorkspaceSourceResolverLive.pipe(
      Layer.provide(Layer.succeed(ProjectionSnapshotQuery, makeProjection(workspaceRoot))),
    );
    const context = yield* Layer.build(layer);
    return yield* Effect.service(TaskWorkspaceSourceResolver).pipe(Effect.provide(context));
  });

describe("TaskWorkspaceSourceResolver", () => {
  it.effect(
    "pins the base ref to a commit and records a clean-source fingerprint for later and never",
    () =>
      Effect.gen(function* () {
        const root = yield* Effect.tryPromise(() =>
          NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-source-resolver-")),
        );
        yield* Effect.addFinalizer(() =>
          Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
            Effect.orDie,
          ),
        );
        yield* Effect.tryPromise(() => git(root, ["init", "-b", "main"]));
        yield* Effect.tryPromise(() =>
          NodeFs.writeFile(NodePath.join(root, "README.md"), "# fixture\n", "utf8"),
        );
        yield* Effect.tryPromise(() => git(root, ["add", "README.md"]));
        yield* Effect.tryPromise(() =>
          git(root, ["commit", "-m", "chore: seed fixture repository"]),
        );

        const resolver = yield* makeResolver(root);
        const resolved = yield* resolver.resolve({
          projectId,
          baseRef: "main",
          worktreePolicy: "later",
        });
        expect(resolved.workspaceRoot).toBe(root);
        expect(resolved.baseCommitSha).toMatch(/^[0-9a-f]{40}$/u);
        expect(resolved.planningRootFingerprint).toMatch(/^[0-9a-f]{64}$/u);

        // `now` skips the source-clean check and defers the fingerprint.
        const nowPolicy = yield* resolver.resolve({
          projectId,
          baseRef: "main",
          worktreePolicy: "now",
        });
        expect(nowPolicy.planningRootFingerprint).toBeNull();
      }),
  );

  it.effect("rejects an invalid base ref before task creation", () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-source-badref-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
          Effect.orDie,
        ),
      );
      yield* Effect.tryPromise(() => git(root, ["init", "-b", "main"]));

      const resolver = yield* makeResolver(root);
      const failure = yield* resolver
        .resolve({ projectId, baseRef: "missing-branch", worktreePolicy: "later" })
        .pipe(Effect.flip);
      expect(failure).toBeInstanceOf(TaskWorkspaceSourceError);
      expect((failure as TaskWorkspaceSourceError).kind).toBe(
        TaskWorkspaceSourceErrorKind.InvalidBaseRef,
      );
    }),
  );

  it.effect("rejects a dirty source checkout for later and never", () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-source-dirty-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
          Effect.orDie,
        ),
      );
      yield* Effect.tryPromise(() => git(root, ["init", "-b", "main"]));
      yield* Effect.tryPromise(() =>
        NodeFs.writeFile(NodePath.join(root, "README.md"), "# fixture\n", "utf8"),
      );
      yield* Effect.tryPromise(() => git(root, ["add", "README.md"]));
      yield* Effect.tryPromise(() => git(root, ["commit", "-m", "chore: seed fixture repository"]));
      yield* Effect.tryPromise(() =>
        NodeFs.writeFile(NodePath.join(root, "dirty.txt"), "uncommitted\n", "utf8"),
      );

      const resolver = yield* makeResolver(root);
      const failure = yield* resolver
        .resolve({ projectId, baseRef: "main", worktreePolicy: "never" })
        .pipe(Effect.flip);
      expect((failure as TaskWorkspaceSourceError).kind).toBe(
        TaskWorkspaceSourceErrorKind.DirtySource,
      );
    }),
  );

  it.effect("rejects a source checkout that is not at the pinned base commit", () =>
    Effect.gen(function* () {
      const root = yield* Effect.tryPromise(() =>
        NodeFs.mkdtemp(NodePath.join(NodeOs.tmpdir(), "kata-task-source-drift-")),
      );
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise(() => NodeFs.rm(root, { recursive: true, force: true })).pipe(
          Effect.orDie,
        ),
      );
      yield* Effect.tryPromise(() => git(root, ["init", "-b", "main"]));
      yield* Effect.tryPromise(() =>
        NodeFs.writeFile(NodePath.join(root, "README.md"), "# fixture\n", "utf8"),
      );
      yield* Effect.tryPromise(() => git(root, ["add", "README.md"]));
      yield* Effect.tryPromise(() => git(root, ["commit", "-m", "chore: seed fixture repository"]));
      // Move past the pinned base so the checkout is ahead of `main~0`? No:
      // commit on top of main, then pin the earlier commit by SHA.
      yield* Effect.tryPromise(() =>
        NodeFs.writeFile(NodePath.join(root, "second.txt"), "second\n", "utf8"),
      );
      yield* Effect.tryPromise(() => git(root, ["add", "second.txt"]));
      const headSha = yield* Effect.tryPromise(() =>
        git(root, ["commit", "-m", "chore: second commit"]).then(() =>
          git(root, ["rev-parse", "HEAD"]),
        ),
      );

      // Check out the parent commit, then pin `main` (which is ahead): the
      // checkout is behind the pinned base, which is drift for Later.
      const baseSha = yield* Effect.tryPromise(() => git(root, ["rev-parse", `${headSha}~1`]));
      yield* Effect.tryPromise(() => git(root, ["checkout", "-b", "pinned", baseSha]));

      const resolver = yield* makeResolver(root);
      const failure = yield* resolver
        .resolve({ projectId, baseRef: "main", worktreePolicy: "later" })
        .pipe(Effect.flip);
      expect((failure as TaskWorkspaceSourceError).kind).toBe(
        TaskWorkspaceSourceErrorKind.SourceNotAtBase,
      );
    }),
  );

  it.effect("rejects a project with no repository binding", () =>
    Effect.gen(function* () {
      const layer = TaskWorkspaceSourceResolverLive.pipe(
        Layer.provide(
          Layer.succeed(ProjectionSnapshotQuery, {
            getProjectShellById: () =>
              Effect.succeed(
                Option.some({
                  id: projectId,
                  title: "Unbound project",
                  workspaceRoot: "/tmp/unbound",
                  repositoryIdentity: null,
                  defaultModelSelection: null,
                  scripts: [],
                  createdAt: "2026-08-01T00:00:00.000Z",
                  updatedAt: "2026-08-01T00:00:00.000Z",
                }),
              ),
          } as unknown as ProjectionSnapshotQueryShape),
        ),
      );
      const context = yield* Layer.build(layer);
      const resolver = yield* Effect.service(TaskWorkspaceSourceResolver).pipe(
        Effect.provide(context),
      );
      const failure = yield* resolver
        .resolve({ projectId, baseRef: "main", worktreePolicy: "later" })
        .pipe(Effect.flip);
      expect((failure as TaskWorkspaceSourceError).kind).toBe(
        TaskWorkspaceSourceErrorKind.NotARepository,
      );
    }),
  );
});
