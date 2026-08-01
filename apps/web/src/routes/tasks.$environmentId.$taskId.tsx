import { EnvironmentId, TaskWorkspaceId } from "@kata-sh/code-contracts";
import { createFileRoute } from "@tanstack/react-router";

import { TaskRouteView } from "../components/taskWorkspace/TaskRouteView";

function TaskRouteViewWrapper() {
  const { environmentId, taskId } = Route.useParams();
  return (
    <TaskRouteView
      environmentId={EnvironmentId.make(environmentId)}
      taskId={TaskWorkspaceId.make(taskId)}
    />
  );
}

export const Route = createFileRoute("/tasks/$environmentId/$taskId")({
  component: TaskRouteViewWrapper,
});
