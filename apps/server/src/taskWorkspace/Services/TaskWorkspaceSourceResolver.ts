import type { ProjectId, TaskWorkspaceWorktreePolicy } from "@kata-sh/code-contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export const TaskWorkspaceSourceErrorKind = {
  ProjectNotFound: "project-not-found",
  NotARepository: "not-a-repository",
  InvalidBaseRef: "invalid-base-ref",
  DirtySource: "dirty-source",
  SourceNotAtBase: "source-not-at-base",
} as const;
export type TaskWorkspaceSourceErrorKind =
  (typeof TaskWorkspaceSourceErrorKind)[keyof typeof TaskWorkspaceSourceErrorKind];

export class TaskWorkspaceSourceError extends Error {
  readonly _tag = "TaskWorkspaceSourceError";
  readonly kind: TaskWorkspaceSourceErrorKind;
  readonly detail: string;
  constructor(kind: TaskWorkspaceSourceErrorKind, detail: string, options?: ErrorOptions) {
    super(`${kind}: ${detail}`, options);
    this.kind = kind;
    this.detail = detail;
  }
}

export interface TaskWorkspaceSourceResolution {
  /** Server-resolved repository path derived from the project projection. */
  readonly workspaceRoot: string;
  /** Pinned base commit resolved from `baseRef`. */
  readonly baseCommitSha: string;
  /**
   * SHA-256 over the planning root's HEAD SHA, a newline, and canonical
   * `git status --porcelain=v2` output. `now` records it after worktree
   * provisioning; `later`/`never` record it from the clean source checkout.
   */
  readonly planningRootFingerprint: string | null;
}

/**
 * Server-authoritative source resolution for first-slice task creation.
 *
 * The client never supplies an authoritative repository path. This service
 * resolves the project through the environment's projection, verifies the
 * repository binding, pins the base ref to a commit, and enforces a clean
 * source state for Later and Never policies before any task is created.
 */
export interface TaskWorkspaceSourceResolverShape {
  readonly resolve: (input: {
    readonly projectId: ProjectId;
    readonly baseRef: string;
    readonly worktreePolicy: TaskWorkspaceWorktreePolicy;
  }) => Effect.Effect<TaskWorkspaceSourceResolution, TaskWorkspaceSourceError>;
}

export class TaskWorkspaceSourceResolver extends Context.Service<
  TaskWorkspaceSourceResolver,
  TaskWorkspaceSourceResolverShape
>()("@kata-sh/code-cli/taskWorkspace/Services/TaskWorkspaceSourceResolver") {}
