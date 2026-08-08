/**
 * Operation key for a task workspace command.
 *
 * Shared by every surface that dispatches task commands so concurrent commands
 * stay distinguished by the same key shape (`task-<action>-<commandId>`)
 * across the shell, the panel, and the standalone workspace view.
 */
export function operationKey(commandId: string, action: string): string {
  return `task-${action}-${commandId}`;
}
