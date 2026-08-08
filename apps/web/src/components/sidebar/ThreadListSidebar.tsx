import { FolderPlusIcon, PlusIcon, SearchIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ScopedThreadRef, ThreadId } from "@kata-sh/code-contracts";
import type { SidebarThreadSortOrder } from "@kata-sh/code-contracts/settings";
import {
  scopedProjectKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "@kata-sh/code-client-runtime";
import { useRouter } from "@tanstack/react-router";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../../environments/runtime";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings } from "~/hooks/useSettings";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useThreadActions } from "../../hooks/useThreadActions";
import { isMacPlatform, newCommandId } from "../../lib/utils";
import { readEnvironmentApi } from "../../environmentApi";
import { readLocalApi } from "../../localApi";
import { useStore } from "../../store";
import { useChatThreads } from "../../hooks/useChatThreads";
import { useThreadSelectionStore } from "../../threadSelectionStore";
import { useUiStateStore } from "../../uiStateStore";
import type { SidebarThreadSummary } from "../../types";
import { buildThreadRouteParams } from "../../threadRoutes";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { CommandDialogTrigger } from "../ui/command";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  countWaitingOutsideProjectFilter,
  flattenSectionThreads,
  groupThreadsBySection,
  resolveThreadSubState,
} from "../Sidebar.logic";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { SidebarProjectPicker } from "./SidebarProjectPicker";
import { SidebarNewSessionPanel } from "./SidebarNewSessionPanel";
import { ThreadItemV2 } from "./ThreadItemV2";
import { useSidebarNowMs } from "./useSidebarNowMs";
import "./sidebar-v2.css";

const LIST_SECTIONS = [
  { key: "active" as const, label: "Active" },
  { key: "idle" as const, label: "Idle" },
];

interface ThreadListSidebarProps {
  sortedProjects: readonly SidebarProjectSnapshot[];
  activeRouteThreadKey: string | null;
  threadJumpLabelByKey: ReadonlyMap<string, string>;
  commandPaletteShortcutLabel: string | null;
  newThreadShortcutLabel: string | null;
  openAddProject: () => void;
  handleNewThread: ReturnType<typeof useNewThreadHandler>["handleNewThread"];
  archiveThread: ReturnType<typeof useThreadActions>["archiveThread"];
  deleteThread: ReturnType<typeof useThreadActions>["deleteThread"];
  onOrderedThreadKeysChange?: (threadKeys: readonly string[]) => void;
}

export const ThreadListSidebar = memo(function ThreadListSidebar(props: ThreadListSidebarProps) {
  const {
    sortedProjects,
    activeRouteThreadKey,
    commandPaletteShortcutLabel,
    newThreadShortcutLabel,
    openAddProject,
    handleNewThread,
    archiveThread,
    deleteThread,
    onOrderedThreadKeysChange,
  } = props;

  const nowMs = useSidebarNowMs(1000);
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const threadSortOrder = useSettings<SidebarThreadSortOrder>(
    (settings) => settings.sidebarThreadSortOrder,
  );
  const idleTimerEnabled = useSettings<boolean>((settings) => settings.sidebarIdleTimerEnabled);
  const idleTimerMinutes = useSettings<number>((settings) => settings.sidebarIdleTimerMinutes);
  const appSettingsConfirmThreadDelete = useSettings<boolean>(
    (settings) => settings.confirmThreadDelete,
  );
  const appSettingsConfirmThreadArchive = useSettings<boolean>(
    (settings) => settings.confirmThreadArchive,
  );

  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [expandedIdleThreadKeys, setExpandedIdleThreadKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renamingThreadKey, setRenamingThreadKey] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadKey, setConfirmingArchiveThreadKey] = useState<string | null>(null);
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const markThreadUnread = useUiStateStore((state) => state.markThreadUnread);
  const setThreadPinned = useUiStateStore((state) => state.setThreadPinned);
  const setThreadSlept = useUiStateStore((state) => state.setThreadSlept);
  const clearThreadSleep = useUiStateStore((state) => state.clearThreadSleep);
  const threadPinnedById = useUiStateStore((state) => state.threadPinnedById);
  const threadSleptById = useUiStateStore((state) => state.threadSleptById);
  const toggleThreadSelection = useThreadSelectionStore((state) => state.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((state) => state.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const removeFromSelection = useThreadSelectionStore((state) => state.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((state) => state.setAnchor);

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy thread ID",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy path",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    },
  });

  const allThreads = useChatThreads();
  const threadLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);

  const projectByMemberScopedKey = useMemo(() => {
    const map = new Map<string, SidebarProjectSnapshot>();
    for (const project of sortedProjects) {
      for (const member of project.memberProjects) {
        map.set(scopedProjectKey(scopeProjectRef(member.environmentId, member.id)), project);
      }
    }
    return map;
  }, [sortedProjects]);

  const visibleThreads = useMemo(
    () => allThreads.filter((thread) => thread.archivedAt === null),
    [allThreads],
  );

  const threadCountsByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of visibleThreads) {
      const project = projectByMemberScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      if (!project) continue;
      counts.set(project.projectKey, (counts.get(project.projectKey) ?? 0) + 1);
    }
    return counts;
  }, [projectByMemberScopedKey, visibleThreads]);

  const pickerProjects = useMemo(
    () =>
      sortedProjects.map((project) => ({
        projectKey: project.projectKey,
        displayName: project.displayName,
        threadCount: threadCountsByProject.get(project.projectKey) ?? 0,
      })),
    [sortedProjects, threadCountsByProject],
  );

  const filteredThreads = useMemo(() => {
    if (!selectedProjectKey) return visibleThreads;
    return visibleThreads.filter((thread) => {
      const project = projectByMemberScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      return project?.projectKey === selectedProjectKey;
    });
  }, [projectByMemberScopedKey, selectedProjectKey, visibleThreads]);

  const statusInputFor = useCallback(
    (thread: SidebarThreadSummary) => {
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      const lastVisitedAt = threadLastVisitedAtById[threadKey];
      return {
        ...thread,
        ...(lastVisitedAt !== null && lastVisitedAt !== undefined ? { lastVisitedAt } : {}),
      };
    },
    [threadLastVisitedAtById],
  );

  const sections = useMemo(
    () =>
      groupThreadsBySection({
        threads: filteredThreads,
        getStatusInput: statusInputFor,
        sortOrder: threadSortOrder,
        nowMs,
        idleTimerEnabled,
        idleTimerMinutes,
        isPinned: (thread) =>
          threadPinnedById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))] ===
          true,
        isSlept: (thread) =>
          threadSleptById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))] ===
          true,
      }),
    [
      filteredThreads,
      idleTimerEnabled,
      idleTimerMinutes,
      nowMs,
      statusInputFor,
      threadPinnedById,
      threadSleptById,
      threadSortOrder,
    ],
  );

  const orderedThreadKeys = useMemo(
    () =>
      flattenSectionThreads(sections).map((thread) =>
        scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)),
      ),
    [sections],
  );

  // Clear Sleep when attention sub-state returns.
  useEffect(() => {
    for (const thread of filteredThreads) {
      const threadKey = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
      if (threadSleptById[threadKey] !== true) continue;
      if (resolveThreadSubState({ thread: statusInputFor(thread) }) !== "settled") {
        clearThreadSleep(threadKey);
      }
    }
  }, [clearThreadSleep, filteredThreads, statusInputFor, threadSleptById]);

  const sidebarThreadByKey = useMemo(
    () =>
      new Map(
        visibleThreads.map(
          (thread) =>
            [scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id)), thread] as const,
        ),
      ),
    [visibleThreads],
  );
  const sidebarThreadByKeyRef = useRef(sidebarThreadByKey);
  sidebarThreadByKeyRef.current = sidebarThreadByKey;

  const waitingOutsideFilter = useMemo(() => {
    if (!selectedProjectKey) return 0;
    return countWaitingOutsideProjectFilter({
      allThreads: visibleThreads.map(statusInputFor),
      filteredThreads: filteredThreads.map(statusInputFor),
    });
  }, [filteredThreads, selectedProjectKey, statusInputFor, visibleThreads]);

  // Keep parent keyboard traversal / prewarm in sync with flat list order.
  useEffect(() => {
    onOrderedThreadKeysChange?.(orderedThreadKeys);
  }, [onOrderedThreadKeysChange, orderedThreadKeys]);

  const navigateToThread = useCallback(
    (threadRef: ScopedThreadRef) => {
      if (useThreadSelectionStore.getState().selectedThreadKeys.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(scopedThreadKey(threadRef));
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [clearSelection, isMobile, router, setOpenMobile, setSelectionAnchor],
  );

  const handleThreadClick = useCallback(
    (event: React.MouseEvent, threadRef: ScopedThreadRef, orderedKeys: readonly string[]) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;
      const threadKey = scopedThreadKey(threadRef);
      const currentSelectionCount = useThreadSelectionStore.getState().selectedThreadKeys.size;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadKey);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadKey, orderedKeys);
        return;
      }

      if (currentSelectionCount > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadKey);
      if (isMobile) {
        setOpenMobile(false);
      }
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(threadRef),
      });
    },
    [
      clearSelection,
      isMobile,
      rangeSelectTo,
      router,
      setOpenMobile,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKeys = [...useThreadSelectionStore.getState().selectedThreadKeys];
      if (threadKeys.length === 0) return;
      const count = threadKeys.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const threadKey of threadKeys) {
          const thread = sidebarThreadByKeyRef.current.get(threadKey);
          markThreadUnread(threadKey, thread?.latestTurn?.completedAt);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettingsConfirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedThreadKeys = new Set(threadKeys);
      let failed = 0;
      for (const threadKey of threadKeys) {
        const thread = sidebarThreadByKeyRef.current.get(threadKey);
        if (!thread) continue;
        try {
          await deleteThread(scopeThreadRef(thread.environmentId, thread.id), {
            deletedThreadKeys,
          });
        } catch (error) {
          failed += 1;
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Failed to delete thread",
              description: error instanceof Error ? error.message : "An error occurred.",
            }),
          );
        }
      }
      removeFromSelection(threadKeys);
      if (failed > 0 && failed < threadKeys.length) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Some deletes failed",
            description: `${failed} of ${threadKeys.length} thread${threadKeys.length === 1 ? "" : "s"} could not be deleted.`,
          }),
        );
      }
    },
    [
      appSettingsConfirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
    ],
  );

  const attemptArchiveThread = useCallback(
    async (threadRef: ScopedThreadRef) => {
      try {
        await archiveThread(threadRef);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to archive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [archiveThread],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadKey(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadRef: ScopedThreadRef, newTitle: string, originalTitle: string) => {
      const threadKey = scopedThreadKey(threadRef);
      const finishRename = () => {
        setRenamingThreadKey((current) => {
          if (current !== threadKey) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readEnvironmentApi(threadRef.environmentId);
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadRef.threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to rename thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      finishRename();
    },
    [],
  );

  const handleThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const threadKey = scopedThreadKey(threadRef);
      const thread = sidebarThreadByKeyRef.current.get(threadKey) ?? null;
      if (!thread) return;
      const project = projectByMemberScopedKey.get(
        scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
      );
      const member = project?.memberProjects.find(
        (entry) => entry.environmentId === thread.environmentId && entry.id === thread.projectId,
      );
      const threadWorkspacePath = thread.worktreePath ?? member?.cwd ?? project?.cwd ?? null;
      const pinned = threadPinnedById[threadKey] === true;
      const slept = threadSleptById[threadKey] === true;
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename thread" },
          { id: "mark-unread", label: "Mark unread" },
          pinned ? { id: "unpin", label: "Unpin" } : { id: "pin", label: "Pin" },
          pinned
            ? { id: "sleep", label: "Sleep", disabled: true }
            : slept
              ? { id: "wake", label: "Wake" }
              : { id: "sleep", label: "Sleep" },
          { id: "copy-path", label: "Copy Path" },
          { id: "copy-thread-id", label: "Copy Thread ID" },
          { id: "delete", label: "Delete", destructive: true, icon: "trash" },
        ],
        position,
      );

      if (clicked === "rename") {
        setRenamingThreadKey(threadKey);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadKey, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "pin") {
        setThreadPinned(threadKey, true);
        return;
      }
      if (clicked === "unpin") {
        setThreadPinned(threadKey, false);
        return;
      }
      if (clicked === "sleep") {
        setThreadSlept(threadKey, true);
        return;
      }
      if (clicked === "wake") {
        setThreadSlept(threadKey, false);
        return;
      }
      if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Path unavailable",
              description: "This thread does not have a workspace path to copy.",
            }),
          );
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(thread.id, { threadId: thread.id });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettingsConfirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      try {
        await deleteThread(threadRef);
      } catch (error) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Failed to delete thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
    },
    [
      appSettingsConfirmThreadDelete,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      markThreadUnread,
      projectByMemberScopedKey,
      setThreadPinned,
      setThreadSlept,
      threadPinnedById,
      threadSleptById,
    ],
  );

  const handleToggleIdleExpand = useCallback((threadKey: string) => {
    setExpandedIdleThreadKeys((current) =>
      current.has(threadKey) ? new Set() : new Set([threadKey]),
    );
  }, []);

  const handleGlobalNewThread = useCallback(() => {
    if (sortedProjects.length === 0) {
      openAddProject();
      return;
    }
    setNewSessionOpen(true);
  }, [openAddProject, sortedProjects.length]);

  const handleCloseNewSession = useCallback(() => {
    setNewSessionOpen(false);
  }, []);

  const remoteLabelFor = useCallback(
    (thread: SidebarThreadSummary): string | null => {
      if (primaryEnvironmentId === null || thread.environmentId === primaryEnvironmentId) {
        return null;
      }
      const runtimeLabel =
        useSavedEnvironmentRuntimeStore.getState().byId[thread.environmentId]?.descriptor?.label ??
        null;
      const savedLabel =
        useSavedEnvironmentRegistryStore.getState().byId[thread.environmentId]?.label ?? null;
      return savedLabel ?? runtimeLabel ?? "Remote";
    },
    [primaryEnvironmentId],
  );

  const hasAnyThreads = filteredThreads.length > 0;

  return (
    <div className="sidebar-v2 flex min-h-0 flex-1 flex-col" data-testid="sidebar-v2-list">
      <div className="sb-frame-head">
        <CommandDialogTrigger
          render={
            <button type="button" className="sb-search" data-testid="command-palette-trigger" />
          }
        >
          <SearchIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search</span>
          {commandPaletteShortcutLabel ? (
            <kbd className="sb-kbd">{commandPaletteShortcutLabel}</kbd>
          ) : null}
        </CommandDialogTrigger>
      </div>

      <div className="sb-picker-row">
        <SidebarProjectPicker
          projects={pickerProjects}
          selectedProjectKey={selectedProjectKey}
          onSelect={setSelectedProjectKey}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="sb-new-btn"
                aria-label={
                  newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"
                }
                data-testid="new-thread-button"
                onClick={handleGlobalNewThread}
              />
            }
          >
            <PlusIcon className="size-4" />
          </TooltipTrigger>
          <TooltipPopup side="bottom" sideOffset={2}>
            {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
          </TooltipPopup>
        </Tooltip>
      </div>
      {waitingOutsideFilter > 0 ? (
        <div className="sb-scope-hint" data-testid="sidebar-waiting-scope-hint">
          {waitingOutsideFilter} waiting in other projects
        </div>
      ) : null}

      <div className="sb-list-scroll" data-testid="sidebar-thread-list">
        {!hasAnyThreads ? (
          <div className="sb-empty">
            {sortedProjects.length === 0 ? "No projects yet" : "No threads yet"}
          </div>
        ) : (
          LIST_SECTIONS.map((section) => {
            const threads = sections[section.key];
            if (threads.length === 0) return null;
            return (
              <section key={section.key} data-testid={`sidebar-section-${section.key}`}>
                <div className={`sb-sec ${section.key}`}>
                  {section.label}
                  <span className="sb-count">{threads.length}</span>
                  <span className="sb-line" />
                </div>
                {threads.map((thread) => {
                  const threadKey = scopedThreadKey(
                    scopeThreadRef(thread.environmentId, thread.id),
                  );
                  const project =
                    projectByMemberScopedKey.get(
                      scopedProjectKey(scopeProjectRef(thread.environmentId, thread.projectId)),
                    ) ?? null;
                  const lastVisitedAt = threadLastVisitedAtById[threadKey];
                  const statusInput = statusInputFor(thread);
                  const subState = resolveThreadSubState({ thread: statusInput });
                  return (
                    <ThreadItemV2
                      key={threadKey}
                      thread={thread}
                      project={
                        project
                          ? {
                              projectKey: project.projectKey,
                              displayName: project.displayName,
                            }
                          : null
                      }
                      lastVisitedAt={lastVisitedAt}
                      isActive={activeRouteThreadKey === threadKey}
                      section={section.key}
                      subState={subState}
                      pinned={threadPinnedById[threadKey] === true}
                      nowMs={nowMs}
                      idleExpanded={expandedIdleThreadKeys.has(threadKey)}
                      remoteEnvLabel={remoteLabelFor(thread)}
                      orderedThreadKeys={orderedThreadKeys}
                      appSettingsConfirmThreadArchive={appSettingsConfirmThreadArchive}
                      renamingThreadKey={renamingThreadKey}
                      renamingTitle={renamingTitle}
                      setRenamingTitle={setRenamingTitle}
                      renamingInputRef={renamingInputRef}
                      renamingCommittedRef={renamingCommittedRef}
                      confirmingArchiveThreadKey={confirmingArchiveThreadKey}
                      setConfirmingArchiveThreadKey={setConfirmingArchiveThreadKey}
                      confirmArchiveButtonRefs={confirmArchiveButtonRefs}
                      handleThreadClick={handleThreadClick}
                      navigateToThread={navigateToThread}
                      handleMultiSelectContextMenu={handleMultiSelectContextMenu}
                      handleThreadContextMenu={handleThreadContextMenu}
                      clearSelection={clearSelection}
                      commitRename={commitRename}
                      cancelRename={cancelRename}
                      attemptArchiveThread={attemptArchiveThread}
                      onToggleIdleExpand={handleToggleIdleExpand}
                    />
                  );
                })}
              </section>
            );
          })
        )}

        <button
          type="button"
          className="sb-add-project"
          data-testid="sidebar-add-project-trigger"
          onClick={openAddProject}
        >
          <span className="inline-flex items-center gap-2">
            <FolderPlusIcon className="size-3.5" />
            Add project
          </span>
        </button>
      </div>

      <SidebarNewSessionPanel
        open={newSessionOpen}
        projects={sortedProjects}
        threads={visibleThreads}
        preselectedProjectKey={selectedProjectKey}
        openAddProject={openAddProject}
        handleNewThread={handleNewThread}
        onClose={handleCloseNewSession}
      />
    </div>
  );
});
