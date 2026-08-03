import { useEffect } from "react";

import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { startTaskWorkspaceSubscriptionService } from "./taskWorkspaceSubscription";

export function TaskWorkspaceBootstrap() {
  useEffect(() => {
    // Ensure the primary connection exists before the subscription manager
    // reconciles connected environments.
    getPrimaryEnvironmentConnection();
    const stop = startTaskWorkspaceSubscriptionService();
    return stop;
  }, []);

  return null;
}
