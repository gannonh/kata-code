import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { scopeThreadRef, scopedThreadKey } from "@kata-sh/code-client-runtime";

import { selectSidebarThreadsAcrossEnvironments, useStore } from "../store";
import {
  selectTaskOwnedThreadKeys,
  useTaskWorkspaceStore,
} from "../taskWorkspace/taskWorkspaceStore";
import type { SidebarThreadSummary } from "../types";

/**
 * The threads that belong to Chat.
 *
 * Task-owned stage conversations are internal to the Task route: they are
 * stages of a Task, not peer chats. Every Chat surface — the sidebar list, the
 * jump shortcuts, and the command palette — reads this one list, so a Task can
 * never leak its stages into Chat through a surface that forgot to subtract
 * them.
 */
export function useChatThreads(): SidebarThreadSummary[] {
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const taskOwnedThreadKeys = useTaskWorkspaceStore(selectTaskOwnedThreadKeys);

  return useMemo(() => {
    if (taskOwnedThreadKeys.size === 0) return threads;
    return threads.filter(
      (thread) =>
        !taskOwnedThreadKeys.has(scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))),
    );
  }, [taskOwnedThreadKeys, threads]);
}
