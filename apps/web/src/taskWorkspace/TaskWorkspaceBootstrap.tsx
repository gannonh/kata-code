import { useEffect } from "react";

import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { useTaskWorkspaceStore } from "./taskWorkspaceStore";

export function TaskWorkspaceBootstrap() {
  useEffect(() => {
    const connection = getPrimaryEnvironmentConnection();
    return connection.client.taskWorkspaces.subscribe(
      (item) => useTaskWorkspaceStore.getState().applyStreamItem(item),
      {
        onResubscribe: () => useTaskWorkspaceStore.getState().reset(),
      },
    );
  }, []);

  return null;
}
