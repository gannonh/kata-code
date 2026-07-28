import type {
  TaskWorkspace,
  TaskWorkspaceId,
  TaskWorkspaceStreamItem,
} from "@kata-sh/code-contracts";
import { create } from "zustand";

interface TaskWorkspaceState {
  sequence: number;
  taskIds: TaskWorkspaceId[];
  taskById: Record<string, TaskWorkspace>;
  applyStreamItem: (item: TaskWorkspaceStreamItem) => void;
  reset: () => void;
}

const initialState = {
  sequence: 0,
  taskIds: [] as TaskWorkspaceId[],
  taskById: {} as Record<string, TaskWorkspace>,
};

function sortTaskIds(taskById: Record<string, TaskWorkspace>): TaskWorkspaceId[] {
  return Object.values(taskById)
    .toSorted(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title),
    )
    .map((task) => task.id);
}

export const useTaskWorkspaceStore = create<TaskWorkspaceState>((set) => ({
  ...initialState,
  applyStreamItem: (item) =>
    set((state) => {
      if (item.kind === "snapshot") {
        const taskById = Object.fromEntries(item.snapshot.tasks.map((task) => [task.id, task]));
        return {
          sequence: item.snapshot.sequence,
          taskById,
          taskIds: sortTaskIds(taskById),
        };
      }
      if (item.sequence < state.sequence) {
        return state;
      }
      const taskById = { ...state.taskById, [item.task.id]: item.task };
      return {
        sequence: item.sequence,
        taskById,
        taskIds: sortTaskIds(taskById),
      };
    }),
  reset: () => set(initialState),
}));

export const selectTaskWorkspaces = (state: TaskWorkspaceState): TaskWorkspace[] =>
  state.taskIds.flatMap((taskId) => {
    const task = state.taskById[taskId];
    return task ? [task] : [];
  });
