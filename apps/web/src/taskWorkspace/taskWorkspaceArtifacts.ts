import type {
  TaskWorkspace,
  TaskWorkspaceArtifactKind,
  TaskWorkspaceArtifactRevision,
} from "@kata-sh/code-contracts";

/**
 * The revision of `kind` that the task currently points at.
 *
 * Artifacts are append-only: `currentRevision` is the live one and the rest are
 * history a stage occurrence can still be inspected against.
 */
export function latestArtifact(
  task: TaskWorkspace,
  kind: TaskWorkspaceArtifactKind,
): TaskWorkspaceArtifactRevision | null {
  const artifact = task.artifacts.find((candidate) => candidate.kind === kind);
  if (!artifact) return null;
  return (
    artifact.revisions.find((revision) => revision.revision === artifact.currentRevision) ?? null
  );
}
