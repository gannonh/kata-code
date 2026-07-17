import { ArchiveIcon, PinIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";
import type { ScopedThreadRef } from "@kata-sh/code-contracts";
import { scopedThreadKey, scopeThreadRef } from "@kata-sh/code-client-runtime";
import type { SidebarThreadSummary } from "../../types";
import {
  formatSidebarElapsedClock,
  formatSidebarWaitLabel,
  hasUnseenCompletion,
  resolveThreadRowDensity,
  resolveThreadStatusPill,
  resolveThreadWaitDuration,
  type ThreadSection,
  type ThreadSubState,
} from "../Sidebar.logic";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useUiStateStore } from "../../uiStateStore";
import { ThreadRowTrailingStatus } from "../ThreadStatusIndicators";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ThreadItemV2ProjectMeta {
  projectKey: string;
  displayName: string;
}

export interface ThreadItemV2Props {
  thread: SidebarThreadSummary;
  project: ThreadItemV2ProjectMeta | null;
  lastVisitedAt: string | null | undefined;
  isActive: boolean;
  section: ThreadSection;
  subState: ThreadSubState;
  pinned?: boolean;
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

function subStateChipLabel(subState: ThreadSubState, pillLabel: string | undefined): string {
  if (subState === "settled") return "Done";
  if (subState === "working" && pillLabel === "Connecting") return "Connecting";
  if (subState === "working") return "Working";
  if (subState === "waiting") {
    if (pillLabel === "Pending Approval") return "Waiting";
    if (pillLabel === "Awaiting Input") return "Input";
    if (pillLabel === "Plan Ready") return "Plan";
    return "Waiting";
  }
  if (subState === "blocked") return "Blocked";
  return subState;
}

export const ThreadItemV2 = memo(function ThreadItemV2(props: ThreadItemV2Props) {
  const {
    thread,
    project,
    lastVisitedAt,
    isActive,
    section,
    subState,
    pinned = false,
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
  const setThreadPinned = useUiStateStore((state) => state.setThreadPinned);
  const statusInput = useMemo(
    () => ({
      ...thread,
      ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
    }),
    [lastVisitedAt, thread],
  );
  const pill = resolveThreadStatusPill({ thread: statusInput });
  const density = resolveThreadRowDensity({ thread: statusInput, section });
  const wait = resolveThreadWaitDuration({ thread: statusInput, nowMs });
  const unread = hasUnseenCompletion(statusInput);
  const isConfirmingArchive = confirmingArchiveThreadKey === threadKey;
  const isRenaming = renamingThreadKey === threadKey;
  const selected = isActive || isSelected;

  const clearConfirmingArchive = useCallback(() => {
    setConfirmingArchiveThreadKey((current) => (current === threadKey ? null : current));
  }, [setConfirmingArchiveThreadKey, threadKey]);

  const handleRowClick = useCallback(
    (event: React.MouseEvent) => {
      if (section === "idle" && density.density === "slim") {
        onToggleIdleExpand(threadKey);
        if (!isActive) {
          handleThreadClick(event, threadRef, orderedThreadKeys);
        }
        return;
      }
      handleThreadClick(event, threadRef, orderedThreadKeys);
    },
    [
      density.density,
      handleThreadClick,
      isActive,
      onToggleIdleExpand,
      orderedThreadKeys,
      section,
      threadKey,
      threadRef,
    ],
  );

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (section === "idle" && density.density === "slim") {
        onToggleIdleExpand(threadKey);
        if (!isActive) {
          navigateToThread(threadRef);
        }
        return;
      }
      navigateToThread(threadRef);
    },
    [
      density.density,
      isActive,
      navigateToThread,
      onToggleIdleExpand,
      section,
      threadKey,
      threadRef,
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

  const archiveControl = isConfirmingArchive ? (
    <button
      type="button"
      ref={handleConfirmArchiveRef}
      className="sb-archive confirming"
      data-testid={`thread-archive-confirm-${thread.id}`}
      onPointerDown={stopPropagationOnPointerDown}
      onClick={handleConfirmArchiveClick}
      onBlur={clearConfirmingArchive}
      aria-label="Confirm archive thread"
    >
      Archive?
    </button>
  ) : (
    <button
      type="button"
      className="sb-archive"
      data-testid={`thread-archive-${thread.id}`}
      onPointerDown={stopPropagationOnPointerDown}
      onClick={
        appSettingsConfirmThreadArchive
          ? handleStartArchiveConfirmation
          : handleArchiveImmediateClick
      }
      aria-label="Archive thread"
    >
      <ArchiveIcon className="size-3.5" aria-hidden />
    </button>
  );

  const titleNode = isRenaming ? (
    <input
      ref={handleRenameInputRef}
      className="sb-rename"
      value={renamingTitle}
      aria-label="Rename thread"
      data-testid={`thread-rename-${thread.id}`}
      onChange={(event) => setRenamingTitle(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          renamingCommittedRef.current = true;
          void commitRename(threadRef, renamingTitle, thread.title);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelRename();
        }
      }}
      onBlur={() => {
        if (renamingCommittedRef.current) {
          renamingCommittedRef.current = false;
          return;
        }
        void commitRename(threadRef, renamingTitle, thread.title);
      }}
    />
  ) : (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="sb-title" data-testid={`thread-title-${thread.id}`}>
            {thread.title}
          </span>
        }
      />
      <TooltipPopup side="right" sideOffset={6}>
        {thread.title}
      </TooltipPopup>
    </Tooltip>
  );

  const projectIdentity = project ? <span className="sb-pchip">{project.displayName}</span> : null;
  const branch = thread.branch ? <span className="sb-branch">{thread.branch}</span> : null;
  const environmentBadge = (
    <span className={`sb-env-badge ${remoteEnvLabel ? "remote" : "local"}`}>
      {remoteEnvLabel ?? "Local"}
    </span>
  );
  const relativeTime = (
    <span className="sb-time">
      {formatRelativeTimeLabel(thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt)}
    </span>
  );
  const metaRow = (
    <div className="sb-meta">
      {projectIdentity}
      {branch}
      {environmentBadge}
      {relativeTime}
    </div>
  );
  const settledEnvironmentRow = (
    <div className="sb-meta sb-environment-row">
      {environmentBadge}
      {relativeTime}
    </div>
  );

  const usesStructuredActiveRows =
    section === "active" && (subState === "settled" || subState === "working");
  const chip =
    section === "active" ? (
      <span
        className={`sb-chip ${subState}${pill?.label === "Connecting" ? " connecting" : ""}`}
        data-testid={`thread-chip-${thread.id}`}
      >
        {subStateChipLabel(subState, pill?.label)}
      </span>
    ) : null;

  const showRich =
    density.density === "rich" ||
    (section === "idle" && idleExpanded) ||
    (density.showBlockedDot && idleExpanded);

  if (!showRich) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-thread-item
        data-testid={`thread-row-${thread.id}`}
        data-section={section}
        data-sub-state={subState}
        data-density="slim"
        className={`sb-row${selected ? " selected" : ""}${unread || density.showBlockedDot ? " unread" : ""}`}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        onContextMenu={handleRowContextMenu}
        onMouseLeave={clearConfirmingArchive}
      >
        {section !== "idle" ? (
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
        ) : null}
        {titleNode}
        {chip}
        <ThreadRowTrailingStatus thread={thread} />
        {archiveControl}
      </div>
    );
  }

  const kind = waitingKind(pill?.label);
  const cardClass = [
    "sb-card",
    subState === "waiting" ? `waiting ${kind}`.trim() : "",
    subState === "blocked" ? "blocked" : "",
    subState === "settled" && section === "active" ? "settled" : "",
    section === "idle" ? "idle-expanded" : "",
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
      data-section={section}
      data-sub-state={subState}
      data-density="rich"
      className={cardClass}
      onClick={handleRowClick}
      onKeyDown={handleRowKeyDown}
      onContextMenu={handleRowContextMenu}
      onMouseLeave={clearConfirmingArchive}
    >
      <div className="sb-top">
        {!usesStructuredActiveRows && subState === "working" ? (
          <span className="sb-spin" aria-hidden />
        ) : null}
        {subState === "blocked" ? (
          <span className="sb-dot blocked" style={{ width: 8, height: 8 }} aria-hidden />
        ) : null}
        {titleNode}
        {pinned ? (
          <button
            type="button"
            className="sb-pin-icon"
            data-thread-selection-safe
            aria-label="Unpin thread"
            title="Unpin"
            onPointerDown={stopPropagationOnPointerDown}
            onClick={(event) => {
              event.stopPropagation();
              setThreadPinned(threadKey, false);
            }}
          >
            <PinIcon aria-hidden />
          </button>
        ) : null}
        {!usesStructuredActiveRows ? chip : null}
        {subState === "waiting" && wait ? (
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
        {!usesStructuredActiveRows && subState === "working" && workingElapsedMs != null ? (
          <span className="sb-elapsed">{formatSidebarElapsedClock(workingElapsedMs)}</span>
        ) : null}
        {subState === "blocked" ? (
          <span className="sb-wait" style={{ color: "var(--sb-red)" }}>
            blocked
          </span>
        ) : null}
        {!usesStructuredActiveRows ? <ThreadRowTrailingStatus thread={thread} /> : null}
      </div>
      {usesStructuredActiveRows ? (
        <div className="sb-meta sb-project-row">
          {projectIdentity}
          {branch}
          <span className="sb-status-slot">
            <span className="sb-active-status">
              {chip}
              {subState === "working" && workingElapsedMs != null ? (
                <span className="sb-elapsed">{formatSidebarElapsedClock(workingElapsedMs)}</span>
              ) : null}
              <ThreadRowTrailingStatus thread={thread} />
            </span>
            {archiveControl}
          </span>
        </div>
      ) : null}
      {subState === "waiting" ? <div className="sb-ask">{waitingAskLine(pill?.label)}</div> : null}
      {subState === "blocked" ? (
        <div className="sb-ask" style={{ color: "var(--sb-red)" }}>
          {thread.session?.lastError ?? "Session error"}
        </div>
      ) : null}
      {subState === "working" ? (
        <div className="sb-progress">
          <div className="sb-bar" />
        </div>
      ) : null}
      {usesStructuredActiveRows ? settledEnvironmentRow : metaRow}
      {!usesStructuredActiveRows ? archiveControl : null}
    </div>
  );
});
