import {
  type TaskWorkspace,
  type TaskWorkspaceContextManifest,
} from "@kata-sh/code-contracts";
import { TASK_WORKSPACE_STAGE_LABELS } from "@kata-sh/code-shared/taskWorkspacePresets";
import { AlertTriangleIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

function blockCount(manifest: TaskWorkspaceContextManifest): number {
  return manifest.artifactRefs.reduce((total, ref) => total + ref.blockIds.length, 0);
}

function budgetLabel(manifest: TaskWorkspaceContextManifest): string {
  if (manifest.budget === null) return `${manifest.tokenEstimate} tokens · unbudgeted`;
  return `${manifest.tokenEstimate} / ${manifest.budget} tokens`;
}

/**
 * Context manifest inspector.
 *
 * Shows the provenance of a next-stage session's context: which artifact blocks
 * were carried, the token estimate, and the budget it was measured against.
 *
 * When the selection overflowed the budget it was replaced by a generated
 * summary artifact. That is lossy, so this panel states it outright — a person
 * reviewing a downstream artifact has to be able to tell that the upstream
 * context was compressed. Summarization is automatic, never silent.
 */
export function ContextManifestPanel({ task }: { task: TaskWorkspace }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const compressedCount = task.contextManifests.filter(
    (manifest) => manifest.compressedBlockCount > 0,
  ).length;

  return (
    <section
      data-testid="task-context-manifests-panel"
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Context manifests</h2>
          <p className="text-xs text-muted-foreground">
            Exactly which artifact blocks each next-stage session started from, and how they
            measured against the budget.
          </p>
        </div>
        {compressedCount > 0 ? (
          <Badge data-testid="task-context-compressed-summary" variant="warning">
            {compressedCount} compressed
          </Badge>
        ) : null}
      </div>

      {task.contextManifests.length === 0 ? (
        <p className="text-xs text-muted-foreground">No context manifests yet.</p>
      ) : (
        <ul className="space-y-2">
          {task.contextManifests.map((manifest) => {
            const carried = blockCount(manifest);
            const compressed = manifest.compressedBlockCount > 0;
            const expanded = expandedId === manifest.id;
            const session = task.sessions.find((candidate) => candidate.id === manifest.sessionId);
            return (
              <li
                key={manifest.id}
                data-testid={`task-context-manifest-${manifest.id}`}
                data-compressed={compressed || undefined}
                className={`rounded-lg border p-3 text-xs ${
                  compressed ? "border-warning/50 bg-warning/8" : "border-border/70"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{manifest.id}</span>
                    {/* Distinguish manifest context from the session navigator's stage labels. */}
                    {session ? (
                      <Badge size="sm" variant="outline">
                        {session.stage === null
                          ? "Ad-hoc"
                          : TASK_WORKSPACE_STAGE_LABELS[session.stage]}{" "}
                        context
                      </Badge>
                    ) : null}
                    <span
                      data-testid={`task-context-manifest-${manifest.id}-budget`}
                      className="text-muted-foreground"
                    >
                      {budgetLabel(manifest)}
                    </span>
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setExpandedId(expanded ? null : manifest.id)}
                  >
                    {expanded ? "Hide blocks" : `${carried} block${carried === 1 ? "" : "s"}`}
                  </Button>
                </div>

                {compressed ? (
                  <p
                    data-testid={`task-context-manifest-${manifest.id}-compressed`}
                    className="mt-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 font-medium text-warning-foreground"
                  >
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {manifest.compressedBlockCount} block
                      {manifest.compressedBlockCount === 1 ? "" : "s"} compressed — this session
                      started from a generated summary
                      {manifest.summaryArtifactRef
                        ? ` (summary r${manifest.summaryArtifactRef.revision})`
                        : ""}
                      , not the full text above.
                    </span>
                  </p>
                ) : null}

                {expanded ? (
                  <ul className="mt-2 space-y-1">
                    {manifest.artifactRefs.map((ref) => (
                      <li key={`${ref.kind}-${ref.revision}`} className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {ref.kind} r{ref.revision}
                        </span>
                        {ref.blockIds.length > 0 ? `: ${ref.blockIds.join(", ")}` : ": (no blocks)"}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {manifest.notes ? (
                  <p className="mt-2 text-muted-foreground">{manifest.notes}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
