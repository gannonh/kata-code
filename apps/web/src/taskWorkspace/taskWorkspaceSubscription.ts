import type { EnvironmentId, TaskWorkspaceStreamItem } from "@kata-sh/code-contracts";

import {
  listEnvironmentConnections,
  subscribeEnvironmentConnections,
  type EnvironmentConnection,
} from "../environments/runtime";
import { useTaskWorkspaceStore } from "./taskWorkspaceStore";

function subscribeEnvironmentTasks(connection: EnvironmentConnection): () => void {
  return connection.client.taskWorkspaces.subscribe(
    (item: TaskWorkspaceStreamItem) =>
      useTaskWorkspaceStore.getState().applyStreamItem(connection.environmentId, item),
    {
      onResubscribe: () =>
        useTaskWorkspaceStore.getState().resetEnvironment(connection.environmentId),
    },
  );
}

/**
 * Environment-scoped task subscription manager.
 *
 * Follows authenticated environment connections: subscribes once per connected
 * environment, keys snapshots and sequences by `(environmentId, taskId)`,
 * retains disconnected entries as offline until reconnect or removal, and
 * resets only the affected environment partition on resubscribe.
 */
export function startTaskWorkspaceSubscriptionService(): () => void {
  const subscriptions = new Map<EnvironmentId, () => void>();
  let stopped = false;

  const reconcile = () => {
    if (stopped) return;
    const connections = listEnvironmentConnections();
    for (const connection of connections) {
      if (!subscriptions.has(connection.environmentId)) {
        subscriptions.set(connection.environmentId, subscribeEnvironmentTasks(connection));
      }
    }
    for (const [environmentId, dispose] of subscriptions) {
      if (!connections.some((connection) => connection.environmentId === environmentId)) {
        dispose();
        subscriptions.delete(environmentId);
        useTaskWorkspaceStore.getState().resetEnvironment(environmentId);
      }
    }
  };

  const unsubscribeConnections = subscribeEnvironmentConnections(reconcile);
  reconcile();

  return () => {
    stopped = true;
    unsubscribeConnections();
    for (const dispose of subscriptions.values()) {
      dispose();
    }
    subscriptions.clear();
  };
}
