import {
  TaskWorkspaceArtifactKind,
  type EnvironmentId,
  type TaskWorkspace,
  type TaskWorkspaceSessionRole,
  type TaskWorkspaceStage,
} from "@kata-sh/code-contracts";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import type { SidebarThreadSummary } from "../../types";
import type { TaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { shortTaskWorkspaceId } from "./taskWorkspacePresentation";

const SESSION_ROLES: ReadonlyArray<TaskWorkspaceSessionRole> = [
  "primary",
  "alternative",
  "reviewer",
  "debugging",
  "ad-hoc",
];

const ARTIFACT_KINDS: ReadonlyArray<TaskWorkspaceArtifactKind> = TaskWorkspaceArtifactKind.literals;

function manifestRequired(role: TaskWorkspaceSessionRole): boolean {
  return role === "alternative" || role === "reviewer";
}

export function SessionsPanel({
  task,
  commands,
  availableThreads,
  primaryEnvironmentId,
  stage,
}: {
  task: TaskWorkspace;
  commands: TaskWorkspaceCommands;
  availableThreads: readonly SidebarThreadSummary[];
  primaryEnvironmentId: EnvironmentId | null;
  stage: TaskWorkspaceStage;
}) {
  const [linkThreadId, setLinkThreadId] = useState("");
  const [linkRole, setLinkRole] = useState<TaskWorkspaceSessionRole>("primary");
  const [linkManifestId, setLinkManifestId] = useState("");

  const [forkParentId, setForkParentId] = useState("");
  const [forkPoint, setForkPoint] = useState("");
  const [forkThreadId, setForkThreadId] = useState("");
  const [forkRole, setForkRole] = useState<TaskWorkspaceSessionRole>("alternative");
  const [forkManifestId, setForkManifestId] = useState("");

  const [manifestKind, setManifestKind] = useState<TaskWorkspaceArtifactKind>("plan");
  const [manifestRevision, setManifestRevision] = useState("");
  const [manifestBlockIds, setManifestBlockIds] = useState("");
  const [manifestNotes, setManifestNotes] = useState("");
  const [manifestSessionId, setManifestSessionId] = useState("");

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const selectedSession = task.sessions.find((session) => session.id === selectedSessionId) ?? null;
  const inspectedManifest = selectedSession?.contextManifestId
    ? (task.contextManifests.find(
        (manifest) => manifest.id === selectedSession.contextManifestId,
      ) ?? null)
    : null;

  const linkStage: TaskWorkspaceStage | null = linkRole === "ad-hoc" ? null : stage;
  const forkStage: TaskWorkspaceStage | null = forkRole === "ad-hoc" ? null : stage;
  const linkedThreadIds = useMemo(
    () => new Set(task.sessions.map((session) => session.threadId)),
    [task.sessions],
  );
  const unlinkedThreads = useMemo(
    () => availableThreads.filter((thread) => !linkedThreadIds.has(thread.id)),
    [availableThreads, linkedThreadIds],
  );
  const manifestArtifact =
    task.artifacts.find((artifact) => artifact.kind === manifestKind) ?? null;
  const manifestRevisions = useMemo(
    () =>
      manifestArtifact
        ? [...manifestArtifact.revisions].sort((left, right) => left.revision - right.revision)
        : [],
    [manifestArtifact],
  );
  const effectiveManifestRevision = manifestRevisions.some(
    (candidate) => String(candidate.revision) === manifestRevision,
  )
    ? manifestRevision
    : manifestArtifact === null
      ? ""
      : String(manifestArtifact.currentRevision);

  return (
    <section
      data-testid="task-sessions-panel"
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">Sessions</h2>
        <p className="text-xs text-muted-foreground">
          Link, fork, and inspect the agent sessions attached to this task.
        </p>
      </div>

      {task.sessions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No sessions linked yet.</p>
      ) : (
        <ul className="divide-y divide-border/70 rounded-lg border border-border/70">
          {task.sessions.map((session) => {
            const isSelected = session.id === selectedSessionId;
            return (
              <li
                key={session.id}
                data-testid={`task-session-${session.id}`}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
                data-active={isSelected || undefined}
              >
                <Badge size="sm" variant="secondary">
                  {session.role}
                </Badge>
                <span className="text-muted-foreground">
                  stage {session.stage ?? "ad-hoc"} · provider {session.provider ?? "—"} ·{" "}
                  {session.status} · thread {shortTaskWorkspaceId(session.threadId)}
                  {session.parentSessionId
                    ? ` · parent ${shortTaskWorkspaceId(session.parentSessionId)} · fork ${
                        session.forkPoint ?? "—"
                      }`
                    : ""}
                </span>
                <div className="ml-auto flex gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSelectedSessionId(session.id)}
                  >
                    Inspect
                  </Button>
                  {primaryEnvironmentId ? (
                    <Button
                      size="xs"
                      variant="outline"
                      render={
                        <Link
                          to="/$environmentId/$threadId"
                          params={{
                            environmentId: primaryEnvironmentId,
                            threadId: session.threadId,
                          }}
                        />
                      }
                    >
                      Open
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Link session
          </p>
          <select
            aria-label="Link thread"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={linkThreadId}
            onChange={(event) => setLinkThreadId(event.currentTarget.value)}
          >
            <option value="">Select thread</option>
            {unlinkedThreads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Link role"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={linkRole}
            onChange={(event) => setLinkRole(event.currentTarget.value as TaskWorkspaceSessionRole)}
          >
            {SESSION_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            aria-label="Link context manifest"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={linkManifestId}
            onChange={(event) => setLinkManifestId(event.currentTarget.value)}
          >
            <option value="">
              {manifestRequired(linkRole)
                ? "Context manifest (required)"
                : "Context manifest (optional)"}
            </option>
            {task.contextManifests.map((manifest) => (
              <option key={manifest.id} value={manifest.id}>
                {manifest.id}
              </option>
            ))}
          </select>
          <p className="text-[0.625rem] text-muted-foreground">
            Stage {linkStage ?? "null (ad-hoc)"}
            {manifestRequired(linkRole) ? " · manifest required for this role" : ""}
          </p>
          <Button
            data-testid="task-link-session"
            size="sm"
            variant="outline"
            className="w-full"
            disabled={
              !linkThreadId || commands.isBusy || (manifestRequired(linkRole) && !linkManifestId)
            }
            onClick={() => {
              const thread = unlinkedThreads.find((candidate) => candidate.id === linkThreadId);
              if (!thread) return;
              void commands.dispatch(
                {
                  ...commands.commandBase("task.session.link"),
                  stage: linkStage,
                  threadId: thread.id,
                  role: linkRole,
                  contextManifestId: linkManifestId || null,
                },
                "link-session",
              );
            }}
          >
            Link session
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-border/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fork session
          </p>
          <select
            aria-label="Fork parent session"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={forkParentId}
            onChange={(event) => setForkParentId(event.currentTarget.value)}
          >
            <option value="">Parent session</option>
            {task.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.role} · {shortTaskWorkspaceId(session.id)}
              </option>
            ))}
          </select>
          <input
            aria-label="Fork point"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            placeholder="Fork point"
            value={forkPoint}
            onChange={(event) => setForkPoint(event.currentTarget.value)}
          />
          <select
            aria-label="Fork thread"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={forkThreadId}
            onChange={(event) => setForkThreadId(event.currentTarget.value)}
          >
            <option value="">Select thread</option>
            {unlinkedThreads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Fork role"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={forkRole}
            onChange={(event) => setForkRole(event.currentTarget.value as TaskWorkspaceSessionRole)}
          >
            {SESSION_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select
            aria-label="Fork context manifest"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={forkManifestId}
            onChange={(event) => setForkManifestId(event.currentTarget.value)}
          >
            <option value="">Context manifest (required)</option>
            {task.contextManifests.map((manifest) => (
              <option key={manifest.id} value={manifest.id}>
                {manifest.id}
              </option>
            ))}
          </select>
          <Button
            data-testid="task-fork-session"
            size="sm"
            variant="outline"
            className="w-full"
            disabled={
              !forkParentId ||
              !forkPoint.trim() ||
              !forkThreadId ||
              !forkManifestId ||
              commands.isBusy
            }
            onClick={() => {
              const thread = unlinkedThreads.find((candidate) => candidate.id === forkThreadId);
              if (!forkParentId || !thread || !forkManifestId) return;
              void commands.dispatch(
                {
                  ...commands.commandBase("task.session.fork"),
                  parentSessionId: forkParentId,
                  threadId: thread.id,
                  forkPoint: forkPoint.trim(),
                  role: forkRole,
                  contextManifestId: forkManifestId,
                  stage: forkStage,
                },
                "fork-session",
              );
            }}
          >
            Fork session
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 rounded-lg border border-border/70 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Create context manifest
          </p>
          <div className="flex gap-2">
            <select
              aria-label="Manifest artifact kind"
              className="h-8 flex-1 rounded-lg border border-input bg-background px-2 text-xs"
              value={manifestKind}
              onChange={(event) =>
                setManifestKind(event.currentTarget.value as TaskWorkspaceArtifactKind)
              }
            >
              {ARTIFACT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <select
              aria-label="Manifest revision"
              className="h-8 w-20 rounded-lg border border-input bg-background px-2 text-xs"
              value={effectiveManifestRevision}
              onChange={(event) => setManifestRevision(event.currentTarget.value)}
            >
              <option value="">Revision</option>
              {manifestRevisions.map((revision) => (
                <option key={revision.id} value={revision.revision}>
                  r{revision.revision}
                </option>
              ))}
            </select>
          </div>
          <select
            aria-label="Manifest target session"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            value={manifestSessionId}
            onChange={(event) => setManifestSessionId(event.currentTarget.value)}
          >
            <option value="">No target session</option>
            {task.sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.role} · {shortTaskWorkspaceId(session.id)}
              </option>
            ))}
          </select>
          <input
            aria-label="Manifest block ids"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            placeholder="Block ids (comma separated)"
            value={manifestBlockIds}
            onChange={(event) => setManifestBlockIds(event.currentTarget.value)}
          />
          <input
            aria-label="Manifest notes"
            className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
            placeholder="Notes (optional)"
            value={manifestNotes}
            onChange={(event) => setManifestNotes(event.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            disabled={commands.isBusy || effectiveManifestRevision === ""}
            onClick={async () => {
              const revision = Number(effectiveManifestRevision);
              if (
                effectiveManifestRevision === "" ||
                !Number.isInteger(revision) ||
                !manifestRevisions.some((candidate) => candidate.revision === revision)
              ) {
                return;
              }
              const blockIds = manifestBlockIds
                .split(",")
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
              await commands.dispatch(
                {
                  ...commands.commandBase("task.context-manifest.create"),
                  artifactRefs: [{ kind: manifestKind, revision, blockIds }],
                  notes: manifestNotes.trim() ? manifestNotes.trim() : null,
                  sessionId: manifestSessionId || null,
                },
                "create-manifest",
              );
            }}
          >
            Create manifest
          </Button>
          {task.contextManifests.length > 0 ? (
            <ul className="space-y-1 text-[0.625rem] text-muted-foreground">
              {task.contextManifests.map((manifest) => (
                <li key={manifest.id}>
                  {manifest.id} · {manifest.artifactRefs.length} ref(s)
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div
          data-testid="task-manifest-inspector"
          className="space-y-2 rounded-lg border border-border/70 p-3"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Manifest inspector
          </p>
          {selectedSession === null ? (
            <p className="text-xs text-muted-foreground">
              Select a session with “Inspect” to view its context manifest.
            </p>
          ) : inspectedManifest === null ? (
            <p className="text-xs text-muted-foreground">
              Session {shortTaskWorkspaceId(selectedSession.id)} has no context manifest.
            </p>
          ) : (
            <div className="space-y-2 text-xs">
              <p className="font-medium">{inspectedManifest.id}</p>
              <ul className="space-y-1">
                {inspectedManifest.artifactRefs.map((ref) => (
                  <li
                    key={`${ref.kind}-${ref.revision}-${ref.blockIds.join(",")}`}
                    className="text-muted-foreground"
                  >
                    {ref.kind} r{ref.revision} · blocks{" "}
                    {ref.blockIds.length > 0 ? ref.blockIds.join(", ") : "—"}
                  </li>
                ))}
              </ul>
              {inspectedManifest.notes ? (
                <p className="text-muted-foreground">Notes: {inspectedManifest.notes}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
