import { ArchiveIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import type { ScopedThreadRef } from "@kata-sh/code-contracts";
import { scopedThreadKey, scopeThreadRef } from "@kata-sh/code-client-runtime";
import type { SidebarThreadSummary } from "../../types";
import {
  formatSidebarElapsedClock,
  formatSidebarWaitLabel,
  hasUnseenCompletion,
  projectColorClass,
  resolveThreadRowDensity,
  resolveThreadStatusPill,
  resolveThreadWaitDuration,
  type ThreadAttentionTier,
} from "../Sidebar.logic";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { ThreadRowTrailingStatus } from "../ThreadStatusIndicators";

export interface ThreadItemV2ProjectMeta {
  projectKey: string;
  displayName: string;
}

export interface ThreadItemV2Props {
  thread: SidebarThreadSummary;
  project: ThreadItemV2ProjectMeta | null;
  lastVisitedAt: string | null | undefined;
  isActive: boolean;
  tier: ThreadAttentionTier;
  nowMs: number;
  idleExpanded: boolean;
  remoteEnvLabel: string | null;
  orderedThreadKeys: readonly string[];
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadKey: string | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: React.RefObject<HTMLInputElement | null>;
  renamingCommittedRef: React.RefObject<boolean>;
  confirmingArchiveThreadKey: string | null;
  setConfirmingArchiveThreadKey: React.Dispatch<React.SetStateAction<string | null>>;
  confirmArchiveButtonRefs: React.RefObject<Map<string, HTMLButtonElement>>;
  handleThreadClick: (
    event: React.MouseEvent,
    threadRef: ScopedThreadRef,
    orderedThreadKeys: readonly string[],
  ) => void;
  navigateToThread: (threadRef: ScopedThreadRef) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadRef: ScopedThreadRef) => Promise<void>;
  onToggleIdleExpand: (threadKey: string) => void;
}

function waitingKind(pillLabel: string | undefined): "" | "input" | "plan" {
  if (pillLabel === "Awaiting Input") return "input";
  if (pillLabel === "Plan Ready") return "plan";
  return "";
}

function waitingAskLine(pillLabel: string | undefined): React.ReactNode {
  if (pillLabel === "Pending Approval") {
    return (
      <>
        <b style={{ color: "var(--sb-amber)" }}>Approve:</b> Waiting on your approval
      </>
    );
  }
  if (pillLabel === "Awaiting Input") {
    return (
      <>
        <b style={{ color: "var(--sb-indigo)" }}>Asked:</b> Waiting on your answer
      </>
    );
  }
  if (pillLabel === "Plan Ready") {
    return (
      <>
        <b style={{ color: "var(--sb-violet)" }}>Plan ready:</b> Review plan
      </>
    );
  }
  return "Needs your attention";
}

export const ThreadItemV2 = memo(function ThreadItemV2(props: ThreadItemV2Props) {
  const {
    thread,
    project,
    lastVisitedAt,
    isActive,
    tier,
    nowMs,
    idleExpanded,
    remoteEnvLabel,
    orderedThreadKeys,
    appSettingsConfirmThreadArchive,
    renamingThreadKey,
    renamingTitle,
    setRenamingTitle,
    renamingInputRef,
    renamingCommittedRef,
    confirmingArchiveThreadKey,
    setConfirmingArchiveThreadKey,
    confirmArchiveButtonRefs,
    handleThreadClick,
    navigateToThread,
    handleMultiSelectContextMenu,
    handleThreadContextMenu,
    clearSelection,
    commitRename,
    cancelRename,
    attemptArchiveThread,
    onToggleIdleExpand,
  } = props;

  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const threadKey = scopedThreadKey(threadRef);
  const isSelected = useThreadSelectionStore((state) => state.selectedThreadKeys.has(threadKey));
  const statusInput = useMemo(
    () => ({
      ...thread,
      ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
    }),
    [lastVisitedAt, thread],
  );
  const pill = resolveThreadStatusPill({ thread: statusInput });
  const density = resolveThreadRowDensity({ thread: statusInput });
  const wait = resolveThreadWaitDuration({ thread: statusInput, nowMs });
  const unread = hasUnseenCompletion(statusInput);
  const isConfirmingArchive = confirmingArchiveThreadKey === threadKey;
  const isThreadRunning =
    thread.session?.status === "running" && thread.session.activeTurnId != null;
  const isRenaming = renamingThreadKey === threadKey;
  const selected = isActive || isSelected;

  const clearConfirmingArchive = useCallback(() => {
    setConfirmingArchiveThreadKey((current) => (current === threadKey ? null : current));
  }, [setConfirmingArchiveThreadKey, threadKey]);

  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      if (tier === "idle" && density.density === "slim" && !idleExpanded) {
        event.preventDefault();
        onToggleIdleExpand(threadKey);
        return;
      }
      handleThreadClick(event, threadRef, orderedThreadKeys);
    },
    [
      density.density,
      handleThreadClick,
      idleExpanded,
      onToggleIdleExpand,
      orderedThreadKeys,
      threadKey,
      threadRef,
      tier,
    ],
  );

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (tier === "idle" && density.density === "slim" && !idleExpanded) {
        onToggleIdleExpand(threadKey);
        return;
      }
      navigateToThread(threadRef);
    },
    [
      density.density,
      idleExpanded,
      navigateToThread,
      onToggleIdleExpand,
      threadKey,
      threadRef,
      tier,
    ],
  );

  const handleRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const hasSelection = useThreadSelectionStore.getState().hasSelection();
      if (hasSelection && isSelected) {
        void handleMultiSelectContextMenu({ x: event.clientX, y: event.clientY });
        return;
      }
      if (hasSelection) {
        clearSelection();
      }
      void handleThreadContextMenu(threadRef, { x: event.clientX, y: event.clientY });
    },
    [clearSelection, handleMultiSelectContextMenu, handleThreadContextMenu, isSelected, threadRef],
  );

  const stopPropagationOnPointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      event.stopPropagation();
    },
    [],
  );

  const handleConfirmArchiveClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearConfirmingArchive();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, clearConfirmingArchive, threadRef],
  );

  const handleStartArchiveConfirmation = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setConfirmingArchiveThreadKey(threadKey);
      requestAnimationFrame(() => {
        confirmArchiveButtonRefs.current.get(threadKey)?.focus();
      });
    },
    [confirmArchiveButtonRefs, setConfirmingArchiveThreadKey, threadKey],
  );

  const handleArchiveImmediateClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void attemptArchiveThread(threadRef);
    },
    [attemptArchiveThread, threadRef],
  );

  const handleConfirmArchiveRef = useCallback(
    (element: HTMLButtonElement | null) => {
      if (element) {
        confirmArchiveButtonRefs.current.set(threadKey, element);
      } else {
        confirmArchiveButtonRefs.current.delete(threadKey);
      }
    },
    [confirmArchiveButtonRefs, threadKey],
  );

  const handleRenameInputRef = useCallback(
    (element: HTMLInputElement | null) => {
      if (element && renamingInputRef.current !== element) {
        renamingInputRef.current = element;
        element.focus();
        element.select();
      }
    },
    [renamingInputRef],
  );

  const handleRenameInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setRenamingTitle(event.target.value);
    },
    [setRenamingTitle],
  );

  const handleRenameInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        void commitRename(threadRef, renamingTitle, thread.title);
      } else if (event.key === "Escape") {
        event.preventDefault();
        renamingCommittedRef.current = true;
        cancelRename();
      }
    },
    [cancelRename, commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef],
  );

  const handleRenameInputBlur = useCallback(() => {
    if (!renamingCommittedRef.current) {
      void commitRename(threadRef, renamingTitle, thread.title);
    }
  }, [commitRename, renamingCommittedRef, renamingTitle, thread.title, threadRef]);

  const handleRenameInputClick = useCallback((event: React.MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();
  }, []);

  const archiveControl =
    isConfirmingArchive && !isThreadRunning ? (
      <button
        ref={handleConfirmArchiveRef}
        type="button"
        data-thread-selection-safe
        data-testid={`thread-archive-confirm-${thread.id}`}
        aria-label={`Confirm archive ${thread.title}`}
        className="sb-archive-confirm"
        onPointerDown={stopPropagationOnPointerDown}
        onClick={handleConfirmArchiveClick}
      >
        Confirm
      </button>
    ) : !isThreadRunning ? (
      <button
        type="button"
        data-thread-selection-safe
        data-testid={`thread-archive-${thread.id}`}
        aria-label={`Archive ${thread.title}`}
        className="sb-archive"
        onPointerDown={stopPropagationOnPointerDown}
        onClick={
          appSettingsConfirmThreadArchive
            ? handleStartArchiveConfirmation
            : handleArchiveImmediateClick
        }
      >
        <ArchiveIcon className="size-3.5" />
      </button>
    ) : null;

  const titleNode = isRenaming ? (
    <input
      ref={handleRenameInputRef}
      className="sb-title min-w-0 flex-1 bg-transparent outline-none border border-[var(--sb-sky)] rounded px-0.5"
      value={renamingTitle}
      onChange={handleRenameInputChange}
      onKeyDown={handleRenameInputKeyDown}
      onBlur={handleRenameInputBlur}
      onClick={handleRenameInputClick}
      data-testid={`thread-title-${thread.id}`}
    />
  ) : (
    <span className="sb-title" data-testid={`thread-title-${thread.id}`}>
      {thread.title}
    </span>
  );

  const metaRow = (
    <div className="sb-meta">
      {project ? (
        <span className="sb-pchip">
          <span className={`sb-pdot ${projectColorClass(project.projectKey)}`} />
          {project.displayName}
        </span>
      ) : null}
      {thread.branch ? <span className="sb-branch">{thread.branch}</span> : null}
      {remoteEnvLabel ? <span className="sb-env-badge remote">{remoteEnvLabel}</span> : null}
      <span className="sb-time">
        {formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        )}
      </span>
    </div>
  );

  const showRich =
    density.density === "rich" ||
    (tier === "idle" && idleExpanded) ||
    (density.showBlockedDot && idleExpanded);

  if (!showRich) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-thread-item
        data-testid={`thread-row-${thread.id}`}
        data-tier={tier}
        data-density="slim"
        className={`sb-row${selected ? " selected" : ""}${unread || density.showBlockedDot ? " unread" : ""}`}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleRowContextMenu}
        onMouseLeave={clearConfirmingArchive}
      >
        <span
          className={`sb-dot${density.showBlockedDot ? " blocked" : ""}`}
          style={
            density.showBlockedDot
              ? undefined
              : unread
                ? { background: "var(--sb-emerald)" }
                : undefined
          }
        />
        {titleNode}
        <ThreadRowTrailingStatus thread={thread} />
        {tier === "idle" ? <span className="sb-expand-hint">expand</span> : null}
        {archiveControl}
      </div>
    );
  }

  const kind = waitingKind(pill?.label);
  const cardClass = [
    "sb-card",
    tier === "waiting" ? `waiting ${kind}`.trim() : "",
    tier === "blocked" ? "blocked" : "",
    selected ? "selected" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const workingStartedAt = thread.latestTurn?.startedAt ?? null;
  const workingElapsedMs =
    workingStartedAt != null ? Math.max(0, nowMs - Date.parse(workingStartedAt)) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      data-thread-item
      data-testid={`thread-row-${thread.id}`}
      data-tier={tier}
      data-density="rich"
      className={cardClass}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
      onContextMenu={handleRowContextMenu}
      onMouseLeave={clearConfirmingArchive}
    >
      <div className="sb-top">
        {tier === "working" ? <span className="sb-spin" aria-hidden /> : null}
        {tier === "blocked" ? (
          <span className="sb-dot blocked" style={{ width: 8, height: 8 }} aria-hidden />
        ) : null}
        {titleNode}
        {tier === "waiting" && wait ? (
          <span
            className="sb-wait"
            style={{
              color:
                kind === "input"
                  ? "var(--sb-indigo)"
                  : kind === "plan"
                    ? "var(--sb-violet)"
                    : "var(--sb-amber)",
            }}
            title={wait.approximate ? "Approximate wait time" : undefined}
          >
            {formatSidebarWaitLabel(wait.durationMs)}
          </span>
        ) : null}
        {tier === "working" && workingElapsedMs != null ? (
          <span className="sb-elapsed">{formatSidebarElapsedClock(workingElapsedMs)}</span>
        ) : null}
        {tier === "blocked" ? (
          <span className="sb-wait" style={{ color: "var(--sb-red)" }}>
            blocked
          </span>
        ) : null}
        {tier === "idle" ? (
          <span className="sb-wait" style={{ color: "var(--sb-text-3)" }}>
            idle
          </span>
        ) : null}
        <ThreadRowTrailingStatus thread={thread} />
      </div>
      {tier === "waiting" ? <div className="sb-ask">{waitingAskLine(pill?.label)}</div> : null}
      {tier === "working" ? (
        <div className="sb-ask" style={{ color: "var(--sb-text-3)" }}>
          {pill?.label === "Connecting" ? "Connecting…" : "Working…"}
        </div>
      ) : null}
      {tier === "blocked" ? (
        <div className="sb-ask" style={{ color: "var(--sb-red)" }}>
          {thread.session?.lastError ?? "Session error"}
        </div>
      ) : null}
      {tier === "idle" ? (
        <div className="sb-ask" style={{ color: "var(--sb-text-3)" }}>
          Idle
        </div>
      ) : null}
      {tier === "working" ? (
        <div className="sb-progress">
          <div className="sb-bar" />
        </div>
      ) : null}
      {metaRow}
      {archiveControl}
    </div>
  );
});
