import type { TaskWorkspaceCommand } from "@kata-sh/code-contracts";
import { useCallback, useState } from "react";

import {
  getPrimaryEnvironmentConnection,
  requireEnvironmentConnection,
} from "../environments/runtime";
import { newCommandId } from "../lib/utils";
import { selectTaskRefsById, useTaskWorkspaceStore } from "./taskWorkspaceStore";

export type TaskCommandBase<T extends TaskWorkspaceCommand["type"]> = {
  readonly type: T;
  readonly commandId: ReturnType<typeof newCommandId>;
  readonly taskId: string;
  readonly createdAt: string;
};

export interface TaskWorkspaceCommands {
  readonly dispatch: (command: TaskWorkspaceCommand, action: string) => Promise<boolean>;
  readonly commandBase: <T extends TaskWorkspaceCommand["type"]>(type: T) => TaskCommandBase<T>;
  readonly pendingAction: string | null;
  readonly isBusy: boolean;
  readonly error: string | null;
  readonly setError: (message: string | null) => void;
}

/**
 * Shared task-workspace command runner. Centralizes dispatch, pending-action
 * tracking, and error surfacing so the workspace view and each panel share one
 * consistent error banner instead of duplicating request plumbing.
 *
 * Commands are dispatched through the task's owning environment connection:
 * the client never supplies an authoritative environment id, so the connection
 * is resolved from the task's environment partition in the store.
 */
export function useTaskWorkspaceCommands(taskId: string): TaskWorkspaceCommands {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(async (command: TaskWorkspaceCommand, action: string) => {
    setPendingAction(action);
    setError(null);
    try {
      const refs = selectTaskRefsById(useTaskWorkspaceStore.getState(), command.taskId);
      const environmentId = refs[0]?.environmentId;
      const connection =
        environmentId !== undefined
          ? requireEnvironmentConnection(environmentId)
          : getPrimaryEnvironmentConnection();
      await connection.client.taskWorkspaces.dispatchCommand(command);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task command failed.");
      return false;
    } finally {
      setPendingAction(null);
    }
  }, []);

  const commandBase = useCallback(
    <T extends TaskWorkspaceCommand["type"]>(type: T): TaskCommandBase<T> => ({
      type,
      commandId: newCommandId(),
      taskId,
      createdAt: new Date().toISOString(),
    }),
    [taskId],
  );

  return {
    dispatch,
    commandBase,
    pendingAction,
    isBusy: pendingAction !== null,
    error,
    setError,
  };
}
