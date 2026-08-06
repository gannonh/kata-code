import { redirect } from "@tanstack/react-router";

import { isTaskModeEnabled } from "../featureFlags";

export function requireTaskMode(): void {
  if (!isTaskModeEnabled) {
    throw redirect({ to: "/" });
  }
}
