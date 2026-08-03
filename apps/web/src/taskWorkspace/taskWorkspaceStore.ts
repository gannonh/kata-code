import type {
  EnvironmentId,
  TaskWorkspace,
  TaskWorkspaceId,
  TaskWorkspaceStreamItem,
} from "@kata-sh/code-contracts";
import { create } from "zustand";

export function taskWorkspaceKey(environmentId: EnvironmentId, taskId: TaskWorkspaceId): string {
  return `${environmentId}:${taskId}`;
}

export interface TaskWorkspaceRef {
  readonly environmentId: EnvironmentId;
  readonly taskId: TaskWorkspaceId;
}

interface TaskWorkspaceState {
  sequenceByEnvironment: Record<string, number>;
  taskByRef: Record<string, TaskWorkspace>;
  applyStreamItem: (environmentId: EnvironmentId, item: TaskWorkspaceStreamItem) => void;
  resetEnvironment: (environmentId: EnvironmentId) => void;
  reset: () => void;
}

const initialState = {
  sequenceByEnvironment: {} as Record<string, number>,
  taskByRef: {} as Record<string, TaskWorkspace>,
};

function sortRefs(taskByRef: Record<string, TaskWorkspace>): TaskWorkspaceRef[] {
  return Object.values(taskByRef)
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title),
    )
    .map((task) => ({ environmentId: task.environmentId!, taskId: task.id }));
}

export const useTaskWorkspaceStore = create<TaskWorkspaceState>((set) => ({
  ...initialState,
  applyStreamItem: (environmentId, item) =>
    set((state) => {
      const priorSequence = state.sequenceByEnvironment[environmentId] ?? 0;
      if (item.kind === "snapshot") {
        const taskByRef = { ...state.taskByRef };
        for (const task of item.snapshot.tasks) {
          if (task.environmentId === null) continue;
          taskByRef[taskWorkspaceKey(task.environmentId, task.id)] = task;
        }
        return {
          sequenceByEnvironment: {
            ...state.sequenceByEnvironment,
            [environmentId]: item.snapshot.sequence,
          },
          taskByRef,
        };
      }
      if (item.sequence < priorSequence) {
        return state;
      }
      if (item.task.environmentId === null) {
        return state;
      }
      const taskByRef = {
        ...state.taskByRef,
        [taskWorkspaceKey(item.task.environmentId, item.task.id)]: item.task,
      };
      return {
        sequenceByEnvironment: {
          ...state.sequenceByEnvironment,
          [environmentId]: item.sequence,
        },
        taskByRef,
      };
    }),
  resetEnvironment: (environmentId) =>
    set((state) => {
      const taskByRef = { ...state.taskByRef };
      for (const key of Object.keys(taskByRef)) {
        if (key.startsWith(`${environmentId}:`)) {
          delete taskByRef[key];
        }
      }
      const sequenceByEnvironment = { ...state.sequenceByEnvironment };
      delete sequenceByEnvironment[environmentId];
      return { taskByRef, sequenceByEnvironment };
    }),
  reset: () => set(initialState),
}));

export const selectTaskWorkspaces = (state: TaskWorkspaceState): TaskWorkspace[] =>
  sortRefs(state.taskByRef).flatMap((ref) => {
    const task = state.taskByRef[taskWorkspaceKey(ref.environmentId, ref.taskId)];
    return task ? [task] : [];
  });

export const selectTaskByRef = (
  state: TaskWorkspaceState,
  environmentId: EnvironmentId,
  taskId: TaskWorkspaceId,
): TaskWorkspace | null => state.taskByRef[taskWorkspaceKey(environmentId, taskId)] ?? null;

/**
 * Environment-scoped lookup for the compatibility route: a task id may exist in
 * more than one connected environment. Ordered newest first, matching the
 * sidebar.
 */
export const selectTaskRefsById = (
  state: TaskWorkspaceState,
  taskId: TaskWorkspaceId,
): TaskWorkspaceRef[] =>
  Object.values(state.taskByRef)
    .filter((task) => task.id === taskId)
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((task) => ({
      environmentId: task.environmentId as EnvironmentId,
      taskId: task.id,
    }))
    .filter((ref) => ref.environmentId !== null);

export function currentTaskStage(
  task: TaskWorkspace,
): TaskWorkspace["workflowRuns"][number]["currentStage"] {
  return task.workflowRuns.at(-1)?.currentStage ?? "questions";
}
