import type {
  TaskWorkspace,
  TaskWorkspaceArtifactKind,
  TaskWorkspaceCommentAuthor,
  TaskWorkspaceCommentStatus,
} from "@kata-sh/code-contracts";
import { useMemo, useState } from "react";

import type { TaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

const STATUS_VARIANT: Record<
  TaskWorkspaceCommentStatus,
  "success" | "warning" | "outline" | "secondary"
> = {
  open: "secondary",
  resolved: "success",
  outdated: "warning",
  orphaned: "outline",
};

function blockLabel(headingPath: readonly string[], id: string): string {
  return headingPath.length > 0 ? `${headingPath.join(" / ")} (${id})` : id;
}

export function CommentsPanel({
  task,
  commands,
  currentUser,
}: {
  task: TaskWorkspace;
  commands: TaskWorkspaceCommands;
  currentUser: TaskWorkspaceCommentAuthor;
}) {
  const [selectedKind, setSelectedKind] = useState<TaskWorkspaceArtifactKind>("plan");
  const [anchorBlockId, setAnchorBlockId] = useState("");
  const [body, setBody] = useState("");
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const artifact = useMemo(
    () =>
      task.artifacts.find((candidate) => candidate.kind === selectedKind) ??
      task.artifacts.find((candidate) => candidate.kind === "plan") ??
      task.artifacts[0] ??
      null,
    [selectedKind, task.artifacts],
  );

  const currentRevision = useMemo(
    () =>
      artifact
        ? (artifact.revisions.find((revision) => revision.revision === artifact.currentRevision) ??
          null)
        : null,
    [artifact],
  );

  const threads = useMemo(
    () => (artifact ? task.comments.filter((thread) => thread.artifactId === artifact.id) : []),
    [artifact, task.comments],
  );

  const blockIndex = currentRevision?.blockIndex ?? [];

  return (
    <section
      data-testid="task-comments-panel"
      className="space-y-4 rounded-xl border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold">Comments</h2>
        <p className="text-xs text-muted-foreground">
          Comment on stable artifact blocks; threads track outdated and orphaned lifecycle.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {task.artifacts.map((candidate) => (
          <Button
            key={candidate.id}
            size="xs"
            variant={candidate.id === artifact?.id ? "default" : "outline"}
            onClick={() => setSelectedKind(candidate.kind)}
          >
            {candidate.kind}
          </Button>
        ))}
      </div>

      {artifact === null ? (
        <p className="text-xs text-muted-foreground">No artifacts to comment on yet.</p>
      ) : (
        <>
          {threads.length === 0 ? (
            <p className="text-xs text-muted-foreground">No comment threads yet.</p>
          ) : (
            <ul className="space-y-3">
              {threads.map((thread) => {
                const canReply = thread.status === "open" || thread.status === "outdated";
                return (
                  <li
                    key={thread.id}
                    data-testid={`task-comment-${thread.id}`}
                    className="space-y-2 rounded-lg border border-border/70 p-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge size="sm" variant={STATUS_VARIANT[thread.status]}>
                        {thread.status}
                      </Badge>
                      <span className="text-muted-foreground">block {thread.anchorBlockId}</span>
                    </div>
                    <ul className="space-y-1">
                      {thread.messages.map((message) => (
                        <li key={message.id}>
                          <span className="font-medium">{message.author.displayName}</span>{" "}
                          <span className="text-muted-foreground">{message.body}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex gap-1.5">
                      {canReply ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => {
                            setReplyThreadId(thread.id);
                            setReplyBody("");
                          }}
                        >
                          Reply
                        </Button>
                      ) : null}
                      {thread.status !== "resolved" ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={commands.isBusy}
                          onClick={() =>
                            void commands.dispatch(
                              {
                                ...commands.commandBase("task.comment.resolve"),
                                threadId: thread.id,
                                resolvedBy: currentUser,
                              },
                              "resolve-comment",
                            )
                          }
                        >
                          Resolve
                        </Button>
                      ) : null}
                    </div>
                    {replyThreadId === thread.id && canReply ? (
                      <div className="space-y-2">
                        <Textarea
                          aria-label="Reply body"
                          className="min-h-16 text-xs"
                          value={replyBody}
                          onChange={(event) => setReplyBody(event.currentTarget.value)}
                        />
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!replyBody.trim() || commands.isBusy}
                          onClick={async () => {
                            if (!replyBody.trim()) return;
                            const succeeded = await commands.dispatch(
                              {
                                ...commands.commandBase("task.comment.reply"),
                                threadId: thread.id,
                                author: currentUser,
                                body: replyBody.trim(),
                              },
                              "reply-comment",
                            );
                            if (!succeeded) return;
                            setReplyThreadId(null);
                            setReplyBody("");
                          }}
                        >
                          Send reply
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-2 rounded-lg border border-border/70 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              New comment
            </p>
            {blockIndex.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Add <code>{"<!-- kata:block:id -->"}</code> markers to the current revision to
                anchor comments.
              </p>
            ) : (
              <>
                <select
                  aria-label="Comment block"
                  className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs"
                  value={anchorBlockId}
                  onChange={(event) => setAnchorBlockId(event.currentTarget.value)}
                >
                  <option value="">Select block</option>
                  {blockIndex.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {blockLabel(entry.headingPath, entry.id)}
                    </option>
                  ))}
                </select>
                <Textarea
                  aria-label="Comment body"
                  className="min-h-16 text-xs"
                  value={body}
                  onChange={(event) => setBody(event.currentTarget.value)}
                  placeholder="Leave a comment on the selected block"
                />
                <Button
                  data-testid="task-comment-create"
                  size="sm"
                  variant="outline"
                  disabled={!anchorBlockId || !body.trim() || !currentRevision || commands.isBusy}
                  onClick={async () => {
                    if (!anchorBlockId || !body.trim() || !currentRevision) return;
                    const succeeded = await commands.dispatch(
                      {
                        ...commands.commandBase("task.comment.create"),
                        artifactId: artifact.id,
                        anchorBlockId,
                        baseRevisionId: currentRevision.id,
                        author: currentUser,
                        body: body.trim(),
                      },
                      "create-comment",
                    );
                    if (!succeeded) return;
                    setBody("");
                    setAnchorBlockId("");
                  }}
                >
                  Add comment
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}
