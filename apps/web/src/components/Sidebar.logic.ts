import * as React from "react";
import type {
  SidebarProjectSortOrder,
  SidebarThreadSortOrder,
} from "@kata-sh/code-contracts/settings";
import {
  getThreadSortTimestamp,
  sortThreads,
  toSortableTimestamp,
  type ThreadSortInput,
} from "../lib/threadSort";
import type { SidebarThreadSummary, Thread } from "../types";
import { cn } from "../lib/utils";
import { isLatestTurnSettled } from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export const THREAD_JUMP_HINT_SHOW_DELAY_MS = 100;
// Visible sidebar rows are prewarmed into the thread-detail cache so opening a
// nearby thread usually reuses an already-hot subscription.
export const SIDEBAR_THREAD_PREWARM_LIMIT = 10;
export type SidebarNewThreadEnvMode = "local" | "worktree";
type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

export type ThreadTraversalDirection = "previous" | "next";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready"
    | "Failed";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 6,
  "Awaiting Input": 5,
  Working: 4,
  Connecting: 4,
  "Plan Ready": 3,
  Failed: 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  SidebarThreadSummary,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "interactionMode"
  | "latestTurn"
  | "session"
  | "updatedAt"
> & {
  lastVisitedAt?: string | undefined;
};

export type { ThreadStatusInput };

export interface ThreadJumpHintVisibilityController {
  sync: (shouldShow: boolean) => void;
  dispose: () => void;
}

export function createThreadJumpHintVisibilityController(input: {
  delayMs: number;
  onVisibilityChange: (visible: boolean) => void;
  setTimeoutFn?: typeof globalThis.setTimeout;
  clearTimeoutFn?: typeof globalThis.clearTimeout;
}): ThreadJumpHintVisibilityController {
  const setTimeoutFn = input.setTimeoutFn ?? globalThis.setTimeout;
  const clearTimeoutFn = input.clearTimeoutFn ?? globalThis.clearTimeout;
  let isVisible = false;
  let timeoutId: NodeJS.Timeout | null = null;

  const clearPendingShow = () => {
    if (timeoutId === null) {
      return;
    }
    clearTimeoutFn(timeoutId);
    timeoutId = null;
  };

  return {
    sync: (shouldShow) => {
      if (!shouldShow) {
        clearPendingShow();
        if (isVisible) {
          isVisible = false;
          input.onVisibilityChange(false);
        }
        return;
      }

      if (isVisible || timeoutId !== null) {
        return;
      }

      timeoutId = setTimeoutFn(() => {
        timeoutId = null;
        isVisible = true;
        input.onVisibilityChange(true);
      }, input.delayMs);
    },
    dispose: () => {
      clearPendingShow();
    },
  };
}

export function useThreadJumpHintVisibility(): {
  showThreadJumpHints: boolean;
  updateThreadJumpHintsVisibility: (shouldShow: boolean) => void;
} {
  const [showThreadJumpHints, setShowThreadJumpHints] = React.useState(false);
  const controllerRef = React.useRef<ThreadJumpHintVisibilityController | null>(null);

  React.useEffect(() => {
    const controller = createThreadJumpHintVisibilityController({
      delayMs: THREAD_JUMP_HINT_SHOW_DELAY_MS,
      onVisibilityChange: (visible) => {
        setShowThreadJumpHints(visible);
      },
      setTimeoutFn: window.setTimeout.bind(window),
      clearTimeoutFn: window.clearTimeout.bind(window),
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const updateThreadJumpHintsVisibility = React.useCallback((shouldShow: boolean) => {
    controllerRef.current?.sync(shouldShow);
  }, []);

  return {
    showThreadJumpHints,
    updateThreadJumpHintsVisibility,
  };
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveSidebarNewThreadSeedContext(input: {
  projectId: string;
  defaultEnvMode: SidebarNewThreadEnvMode;
  activeThread?: {
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
  } | null;
  activeDraftThread?: {
    projectId: string;
    branch: string | null;
    worktreePath: string | null;
    envMode: SidebarNewThreadEnvMode;
  } | null;
}): {
  branch?: string | null;
  worktreePath?: string | null;
  envMode: SidebarNewThreadEnvMode;
} {
  if (input.defaultEnvMode === "worktree") {
    return {
      envMode: "worktree",
    };
  }

  if (input.activeDraftThread?.projectId === input.projectId) {
    return {
      branch: input.activeDraftThread.branch,
      worktreePath: input.activeDraftThread.worktreePath,
      envMode: input.activeDraftThread.envMode,
    };
  }

  if (input.activeThread?.projectId === input.projectId) {
    return {
      branch: input.activeThread.branch,
      worktreePath: input.activeThread.worktreePath,
      envMode: input.activeThread.worktreePath ? "worktree" : "local",
    };
  }

  return {
    envMode: input.defaultEnvMode,
  };
}

export function orderItemsByPreferredIds<TItem, TId>(input: {
  items: readonly TItem[];
  preferredIds: readonly TId[];
  getId: (item: TItem) => TId;
}): TItem[] {
  const { getId, items, preferredIds } = input;
  if (preferredIds.length === 0) {
    return [...items];
  }

  const itemsById = new Map(items.map((item) => [getId(item), item] as const));
  const preferredIdSet = new Set(preferredIds);
  const emittedPreferredIds = new Set<TId>();
  const ordered = preferredIds.flatMap((id) => {
    if (emittedPreferredIds.has(id)) {
      return [];
    }
    const item = itemsById.get(id);
    if (!item) {
      return [];
    }
    emittedPreferredIds.add(id);
    return [item];
  });
  const remaining = items.filter((item) => !preferredIdSet.has(getId(item)));
  return [...ordered, ...remaining];
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    shouldShowThreadPanel?: boolean;
    renderedThreadIds: readonly TThreadId[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowThreadPanel === false ? [] : renderedProject.renderedThreadIds,
  );
}

export function getSidebarThreadIdsToPrewarm<TThreadId>(
  visibleThreadIds: readonly TThreadId[],
  limit = SIDEBAR_THREAD_PREWARM_LIMIT,
): TThreadId[] {
  return visibleThreadIds.slice(0, Math.max(0, limit));
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function isContextMenuPointerDown(input: {
  button: number;
  ctrlKey: boolean;
  isMac: boolean;
}): boolean {
  if (input.button === 2) return true;
  return input.isMac && input.button === 0 && input.ctrlKey;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-6 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring sm:h-7";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
}): ThreadStatusPill | null {
  const { thread } = input;

  if (thread.hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (thread.hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !thread.hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    thread.hasActionableProposedPlan;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (thread.session?.lastError) {
    return {
      label: "Failed",
      colorClass: "text-red-600 dark:text-red-300/90",
      dotClass: "bg-red-500 dark:bg-red-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export type ThreadAttentionTier = "waiting" | "working" | "blocked" | "idle";

/** Shell attention sub-state (chip). `idle` from resolveThreadTier maps to settled. */
export type ThreadSubState = "waiting" | "working" | "blocked" | "settled";

export type ThreadSection = "active" | "idle";

export function resolveThreadTier(input: { thread: ThreadStatusInput }): ThreadAttentionTier {
  const pill = resolveThreadStatusPill(input);
  switch (pill?.label) {
    case "Pending Approval":
    case "Awaiting Input":
    case "Plan Ready":
      return "waiting";
    case "Working":
    case "Connecting":
      return "working";
    case "Failed":
      return "blocked";
    default:
      return "idle";
  }
}

export function resolveThreadSubState(input: { thread: ThreadStatusInput }): ThreadSubState {
  const tier = resolveThreadTier(input);
  return tier === "idle" ? "settled" : tier;
}

/** Latest settled-activity timestamp for dwell (ms). Null if unknown. */
export function resolveSettledActivityAtMs(thread: ThreadStatusInput): number | null {
  const candidates = [
    toSortableTimestamp(thread.latestTurn?.completedAt ?? undefined),
    toSortableTimestamp(thread.session?.updatedAt),
    toSortableTimestamp(thread.updatedAt),
  ].filter((value): value is number => value !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

export function resolveThreadSection(input: {
  thread: ThreadStatusInput;
  nowMs?: number;
  idleTimerEnabled: boolean;
  idleTimerMinutes: number;
  pinned?: boolean;
  slept?: boolean;
}): ThreadSection {
  if (input.pinned) {
    return "active";
  }

  const subState = resolveThreadSubState({ thread: input.thread });
  if (subState !== "settled") {
    // Attention always Active; Sleep override is cleared when attention returns.
    return "active";
  }

  if (input.slept) {
    return "idle";
  }

  if (!input.idleTimerEnabled) {
    return "active";
  }

  const minutes = Number.isFinite(input.idleTimerMinutes)
    ? Math.max(1, input.idleTimerMinutes)
    : 60;
  const activityAt = resolveSettledActivityAtMs(input.thread);
  if (activityAt === null) {
    return "active";
  }

  const nowMs = input.nowMs ?? Date.now();
  if (nowMs - activityAt >= minutes * 60_000) {
    return "idle";
  }
  return "active";
}

export type ThreadRowDensity = "rich" | "slim";

export function resolveThreadRowDensity(input: {
  thread: ThreadStatusInput;
  section?: ThreadSection;
}): {
  density: ThreadRowDensity;
  showBlockedDot: boolean;
} {
  const section =
    input.section ?? (resolveThreadTier({ thread: input.thread }) === "idle" ? "idle" : "active");
  const subState = resolveThreadSubState({ thread: input.thread });

  if (section === "idle") {
    return { density: "slim", showBlockedDot: false };
  }

  if (subState === "blocked") {
    const blockedAt = toSortableTimestamp(input.thread.session?.updatedAt);
    const lastVisitedAt = toSortableTimestamp(input.thread.lastVisitedAt);
    const visitedSinceBlocked =
      blockedAt !== null && lastVisitedAt !== null && lastVisitedAt >= blockedAt;

    if (visitedSinceBlocked) {
      return { density: "slim", showBlockedDot: true };
    }

    return { density: "rich", showBlockedDot: false };
  }

  return { density: "rich", showBlockedDot: false };
}

export function resolveThreadWaitDuration(input: {
  thread: ThreadStatusInput;
  nowMs?: number;
  waitSince?: string | null | undefined;
}): {
  startedAt: string;
  durationMs: number;
  approximate: boolean;
} | null {
  if (resolveThreadTier(input) !== "waiting") {
    return null;
  }

  const nowMs = input.nowMs ?? Date.now();
  const explicitWaitSince = input.waitSince ?? null;
  const explicitTimestamp = toSortableTimestamp(explicitWaitSince ?? undefined);
  if (explicitWaitSince && explicitTimestamp !== null) {
    return {
      startedAt: explicitWaitSince,
      durationMs: Math.max(0, nowMs - explicitTimestamp),
      approximate: false,
    };
  }

  const fallbackStartedAt = input.thread.latestTurn?.completedAt ?? null;
  const fallbackTimestamp = toSortableTimestamp(fallbackStartedAt ?? undefined);
  if (!fallbackStartedAt || fallbackTimestamp === null) {
    return null;
  }

  return {
    startedAt: fallbackStartedAt,
    durationMs: Math.max(0, nowMs - fallbackTimestamp),
    approximate: true,
  };
}

export function groupThreadsByAttentionTier<T extends Pick<Thread, "id"> & ThreadSortInput>(input: {
  threads: readonly T[];
  getStatusInput: (thread: T) => ThreadStatusInput;
  sortOrder: SidebarThreadSortOrder;
  nowMs?: number;
  getWaitSince?: (thread: T) => string | null | undefined;
}): {
  waiting: T[];
  working: T[];
  blocked: T[];
  idle: T[];
} {
  const nowMs = input.nowMs ?? Date.now();
  const waiting: T[] = [];
  const working: T[] = [];
  const blocked: T[] = [];
  const idle: T[] = [];

  for (const thread of input.threads) {
    const statusInput = input.getStatusInput(thread);
    switch (resolveThreadTier({ thread: statusInput })) {
      case "waiting":
        waiting.push(thread);
        break;
      case "working":
        working.push(thread);
        break;
      case "blocked":
        blocked.push(thread);
        break;
      case "idle":
        idle.push(thread);
        break;
    }
  }

  const sortByConfiguredOrder = (threads: T[]) => sortThreads(threads, input.sortOrder);

  const sortedWaiting = [...waiting].toSorted((left, right) => {
    const leftWait = resolveThreadWaitDuration({
      thread: input.getStatusInput(left),
      nowMs,
      waitSince: input.getWaitSince?.(left),
    });
    const rightWait = resolveThreadWaitDuration({
      thread: input.getStatusInput(right),
      nowMs,
      waitSince: input.getWaitSince?.(right),
    });
    const leftDuration = leftWait?.durationMs ?? Number.NEGATIVE_INFINITY;
    const rightDuration = rightWait?.durationMs ?? Number.NEGATIVE_INFINITY;
    if (leftDuration !== rightDuration) {
      return rightDuration - leftDuration;
    }

    const rightTimestamp = getThreadSortTimestamp(right, input.sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, input.sortOrder);
    if (rightTimestamp !== leftTimestamp) {
      return rightTimestamp > leftTimestamp ? 1 : -1;
    }
    return right.id.localeCompare(left.id);
  });

  return {
    waiting: sortedWaiting,
    working: sortByConfiguredOrder(working),
    blocked: sortByConfiguredOrder(blocked),
    idle: sortByConfiguredOrder(idle),
  };
}

/** Flatten tier groups into display order: Waiting → Working → Blocked → Idle. */
export function flattenAttentionTierThreads<T>(tiers: {
  waiting: readonly T[];
  working: readonly T[];
  blocked: readonly T[];
  idle: readonly T[];
}): T[] {
  return [...tiers.waiting, ...tiers.working, ...tiers.blocked, ...tiers.idle];
}

const ACTIVE_SUBSTATE_SORT_ORDER: Record<ThreadSubState, number> = {
  waiting: 0,
  blocked: 1,
  working: 2,
  settled: 3,
};

export function groupThreadsBySection<T extends Pick<Thread, "id"> & ThreadSortInput>(input: {
  threads: readonly T[];
  getStatusInput: (thread: T) => ThreadStatusInput;
  sortOrder: SidebarThreadSortOrder;
  nowMs?: number;
  idleTimerEnabled: boolean;
  idleTimerMinutes: number;
  isPinned?: (thread: T) => boolean;
  isSlept?: (thread: T) => boolean;
  getWaitSince?: (thread: T) => string | null | undefined;
}): {
  active: T[];
  idle: T[];
} {
  const nowMs = input.nowMs ?? Date.now();
  const active: T[] = [];
  const idle: T[] = [];

  for (const thread of input.threads) {
    const statusInput = input.getStatusInput(thread);
    const section = resolveThreadSection({
      thread: statusInput,
      nowMs,
      idleTimerEnabled: input.idleTimerEnabled,
      idleTimerMinutes: input.idleTimerMinutes,
      pinned: input.isPinned?.(thread) ?? false,
      slept: input.isSlept?.(thread) ?? false,
    });
    if (section === "active") {
      active.push(thread);
    } else {
      idle.push(thread);
    }
  }

  const sortByConfiguredOrder = (threads: T[]) => sortThreads(threads, input.sortOrder);

  const sortedActive = [...active].toSorted((left, right) => {
    const leftStatus = input.getStatusInput(left);
    const rightStatus = input.getStatusInput(right);
    const leftSub = resolveThreadSubState({ thread: leftStatus });
    const rightSub = resolveThreadSubState({ thread: rightStatus });
    const leftOrder = ACTIVE_SUBSTATE_SORT_ORDER[leftSub];
    const rightOrder = ACTIVE_SUBSTATE_SORT_ORDER[rightSub];
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    if (leftSub === "waiting" && rightSub === "waiting") {
      const leftWait = resolveThreadWaitDuration({
        thread: leftStatus,
        nowMs,
        waitSince: input.getWaitSince?.(left),
      });
      const rightWait = resolveThreadWaitDuration({
        thread: rightStatus,
        nowMs,
        waitSince: input.getWaitSince?.(right),
      });
      const leftDuration = leftWait?.durationMs ?? Number.NEGATIVE_INFINITY;
      const rightDuration = rightWait?.durationMs ?? Number.NEGATIVE_INFINITY;
      if (leftDuration !== rightDuration) {
        return rightDuration - leftDuration;
      }
    }

    const rightTimestamp = getThreadSortTimestamp(right, input.sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, input.sortOrder);
    if (rightTimestamp !== leftTimestamp) {
      return rightTimestamp > leftTimestamp ? 1 : -1;
    }
    return right.id.localeCompare(left.id);
  });

  return {
    active: sortedActive,
    idle: sortByConfiguredOrder(idle),
  };
}

export function flattenSectionThreads<T>(sections: {
  active: readonly T[];
  idle: readonly T[];
}): T[] {
  return [...sections.active, ...sections.idle];
}

export function formatSidebarWaitLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${Math.max(1, totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

/** Working-card elapsed like the C prototype (`0:12`, `1:05`). */
export function formatSidebarElapsedClock(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function projectColorClass(projectKey: string): string {
  let hash = 0;
  for (let index = 0; index < projectKey.length; index += 1) {
    hash = (hash + projectKey.charCodeAt(index) * (index + 1)) % 5;
  }
  return `c${hash}`;
}

/** Two-letter initials for project identity avatars (same rules as new-session panel). */
export function projectInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/[\s/_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]!.slice(0, 1)}${parts[1]!.slice(0, 1)}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function countWaitingOutsideProjectFilter(input: {
  allThreads: readonly ThreadStatusInput[];
  filteredThreads: readonly ThreadStatusInput[];
}): number {
  const filteredWaiting = input.filteredThreads.filter(
    (thread) => resolveThreadTier({ thread }) === "waiting",
  ).length;
  const allWaiting = input.allThreads.filter(
    (thread) => resolveThreadTier({ thread }) === "waiting",
  ).length;
  return Math.max(0, allWaiting - filteredWaiting);
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getFallbackThreadIdAfterDelete<
  T extends Pick<Thread, "id" | "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(input: {
  threads: readonly T[];
  deletedThreadId: T["id"];
  sortOrder: SidebarThreadSortOrder;
  deletedThreadIds?: ReadonlySet<T["id"]>;
}): T["id"] | null {
  const { deletedThreadId, deletedThreadIds, sortOrder, threads } = input;
  const deletedThread = threads.find((thread) => thread.id === deletedThreadId);
  if (!deletedThread) {
    return null;
  }

  return (
    sortThreads(
      threads.filter(
        (thread) =>
          thread.projectId === deletedThread.projectId &&
          thread.id !== deletedThreadId &&
          !deletedThreadIds?.has(thread.id),
      ),
      sortOrder,
    )[0]?.id ?? null
  );
}
export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly ThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<
  TProject extends SidebarProject,
  TThread extends Pick<Thread, "projectId" | "createdAt" | "updatedAt"> & ThreadSortInput,
>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
