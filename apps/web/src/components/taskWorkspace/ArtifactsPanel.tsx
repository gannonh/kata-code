import type {
  TaskWorkspace,
  TaskWorkspaceArtifact,
  TaskWorkspaceArtifactKind,
} from "@kata-sh/code-contracts";
import { useMemo, useState } from "react";

import type { TaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const ARTIFACT_KIND_LABELS: Record<TaskWorkspaceArtifactKind, string> = {
  questions: "Questions",
  plan: "Plan",
  verification: "Verification",
};

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function revisionMarkdown(artifact: TaskWorkspaceArtifact, revision: number): string {
  return artifact.revisions.find((entry) => entry.revision === revision)?.markdown ?? "";
}

export function ArtifactsPanel({
  task,
  commands,
}: {
  task: TaskWorkspace;
  commands: TaskWorkspaceCommands;
}) {
  const [selectedKind, setSelectedKind] = useState<TaskWorkspaceArtifactKind | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [compareLeft, setCompareLeft] = useState<number | null>(null);
  const [compareRight, setCompareRight] = useState<number | null>(null);

  const artifact = useMemo(() => {
    return (
      task.artifacts.find((candidate) => candidate.kind === selectedKind) ??
      task.artifacts[0] ??
      null
    );
  }, [selectedKind, task.artifacts]);

  const revisions = useMemo(
    () => (artifact ? [...artifact.revisions].sort((a, b) => a.revision - b.revision) : []),
    [artifact],
  );

  const effectiveSelected = selectedRevision ?? artifact?.currentRevision ?? null;
  const left = compareLeft ?? revisions[0]?.revision ?? null;
  const right = compareRight ?? artifact?.currentRevision ?? null;

  return (
    <section
      data-testid="task-artifacts-panel"
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">Artifacts</h2>
        <p className="text-xs text-muted-foreground">
          Browse artifact kinds, revision lineage, compare revisions, and select the current one.
        </p>
      </div>

      {task.artifacts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No artifacts yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {task.artifacts.map((candidate) => {
              const active = candidate.id === artifact?.id;
              return (
                <Button
                  key={candidate.id}
                  size="xs"
                  variant={active ? "default" : "outline"}
                  onClick={() => {
                    setSelectedKind(candidate.kind);
                    setSelectedRevision(null);
                    setCompareLeft(null);
                    setCompareRight(null);
                  }}
                >
                  {ARTIFACT_KIND_LABELS[candidate.kind]}
                  <Badge size="sm" variant="secondary">
                    r{candidate.currentRevision}
                  </Badge>
                </Button>
              );
            })}
          </div>

          {artifact ? (
            <div className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {ARTIFACT_KIND_LABELS[artifact.kind]} revisions
                </p>
                <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
                  {revisions.map((revision) => {
                    const isCurrent = revision.revision === artifact.currentRevision;
                    const isSelected = revision.revision === effectiveSelected;
                    return (
                      <li
                        key={revision.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                        data-active={isSelected || undefined}
                      >
                        <button
                          type="button"
                          data-testid={`task-artifact-revision-${revision.revision}`}
                          className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                          onClick={() => setSelectedRevision(revision.revision)}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            Revision {revision.revision}
                            {isCurrent ? (
                              <Badge size="sm" variant="success">
                                current
                              </Badge>
                            ) : null}
                            {isSelected ? (
                              <Badge size="sm" variant="outline">
                                selected
                              </Badge>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground">
                            id {shortId(revision.id)} · supersedes{" "}
                            {shortId(revision.supersedesRevisionId)} · {revision.createdAt}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex justify-end">
                  <Button
                    data-testid="task-select-revision"
                    size="sm"
                    variant="outline"
                    disabled={
                      effectiveSelected === null ||
                      effectiveSelected === artifact.currentRevision ||
                      commands.busy
                    }
                    onClick={() => {
                      if (effectiveSelected === null) return;
                      void commands.dispatch(
                        {
                          ...commands.commandBase("task.artifact.select-revision"),
                          kind: artifact.kind,
                          revision: effectiveSelected,
                        },
                        "select-revision",
                      );
                    }}
                  >
                    Use as current
                  </Button>
                </div>
              </div>

              {revisions.length >= 2 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-medium text-muted-foreground">Compare</span>
                    <select
                      aria-label="Compare left revision"
                      className="h-7 rounded-lg border border-input bg-background px-2 text-xs"
                      value={left ?? ""}
                      onChange={(event) => setCompareLeft(Number(event.currentTarget.value))}
                    >
                      {revisions.map((revision) => (
                        <option key={revision.id} value={revision.revision}>
                          r{revision.revision}
                        </option>
                      ))}
                    </select>
                    <span className="text-muted-foreground">vs</span>
                    <select
                      aria-label="Compare right revision"
                      className="h-7 rounded-lg border border-input bg-background px-2 text-xs"
                      value={right ?? ""}
                      onChange={(event) => setCompareRight(Number(event.currentTarget.value))}
                    >
                      {revisions.map((revision) => (
                        <option key={revision.id} value={revision.revision}>
                          r{revision.revision}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Revision {left}</p>
                      <pre className="max-h-56 overflow-auto rounded-lg bg-muted/35 p-3 text-xs whitespace-pre-wrap">
                        {left !== null ? revisionMarkdown(artifact, left) : ""}
                      </pre>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Revision {right}</p>
                      <pre className="max-h-56 overflow-auto rounded-lg bg-muted/35 p-3 text-xs whitespace-pre-wrap">
                        {right !== null ? revisionMarkdown(artifact, right) : ""}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
