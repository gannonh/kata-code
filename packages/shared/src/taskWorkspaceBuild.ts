import type { TaskWorkspaceBuildPhase, TaskWorkspaceWorkItem } from "@kata-sh/code-contracts";

/**
 * Return whether every dependency of a work item has completed in its phase.
 *
 * Build validation runs in the server reducer and the shared web/desktop
 * panel. Keeping this predicate here makes the UI's disabled state agree with
 * the command authority without putting runtime logic in the schema package.
 */
export function dependenciesPass(
  phase: Pick<TaskWorkspaceBuildPhase, "workItems">,
  workItem: Pick<TaskWorkspaceWorkItem, "dependsOn">,
): boolean {
  return workItem.dependsOn.every((dependencyId) => {
    const dependency = phase.workItems.find((candidate) => candidate.id === dependencyId);
    return dependency?.status === "completed";
  });
}
