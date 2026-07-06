/**
 * Phase 3a: surface `terminal.open` RPC failures instead of swallowing them.
 *
 * Every `api.terminal.open(...)` call site previously ended with
 * `.catch(() => undefined)`, so a broken in-container terminal (the Docker
 * sandbox case) showed a dead drawer with no error. On failure we now emit a
 * non-blocking error toast naming the terminal so the user sees a real error
 * and a retry affordance (AC-3a.4). The in-drawer `[terminal] failed to open:
 * <message>` system message is written by `ThreadTerminalDrawer` from the
 * attach stream's `error` event when the server-side spawn fails; this helper
 * covers the RPC-rejection case where no session was created at all.
 */
import { toastManager } from "../components/ui/toast";

/** Format the failure message for the toast. */
export function formatTerminalOpenErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to open terminal.";
}

/**
 * Handle a `terminal.open` rejection by surfacing a non-blocking error toast.
 * Returns `undefined` so it can be used in a `.catch(handleTerminalOpenError)`
 * chain without changing the surrounding control flow.
 */
export function handleTerminalOpenError(error: unknown): void {
  console.error("[terminal] failed to open", error);
  toastManager.add({
    type: "error",
    title: "Terminal failed to open",
    description: formatTerminalOpenErrorMessage(error),
  });
}
