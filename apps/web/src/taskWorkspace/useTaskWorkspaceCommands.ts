import type { TaskWorkspaceCommand } from "@kata-sh/code-contracts";
import { useCallback, useState } from "react";

import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { newCommandId } from "../lib/utils";

export type TaskCommandBase<T extends TaskWorkspaceCommand["type"]> = {
  readonly type: T;
  readonly commandId: ReturnType<typeof newCommandId>;
  readonly taskId: string;
  readonly createdAt: string;
};

export interface TaskWorkspaceCommands {
  readonly dispatch: (command: TaskWorkspaceCommand, action: string) => Promise<void>;
  readonly commandBase: <T extends TaskWorkspaceCommand["type"]>(type: T) => TaskCommandBase<T>;
  readonly pendingAction: string | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setError: (message: string | null) => void;
}

/**
 * Shared task-workspace command runner. Centralizes dispatch, pending-action
 * tracking, and error surfacing so the workspace view and each panel share one
 * consistent error banner instead of duplicating request plumbing.
 */
export function useTaskWorkspaceCommands(taskId: string): TaskWorkspaceCommands {
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback(async (command: TaskWorkspaceCommand, action: string) => {
    setPendingAction(action);
    setError(null);
    try {
      await getPrimaryEnvironmentConnection().client.taskWorkspaces.dispatchCommand(command);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task command failed.");
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
    busy: pendingAction !== null,
    error,
    setError,
  };
}
