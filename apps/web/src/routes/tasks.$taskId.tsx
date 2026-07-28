import { createFileRoute } from "@tanstack/react-router";

import { TaskWorkspaceView } from "../components/taskWorkspace/TaskWorkspaceView";

function TaskWorkspaceRouteView() {
  const { taskId } = Route.useParams();
  return <TaskWorkspaceView taskId={taskId} />;
}

export const Route = createFileRoute("/tasks/$taskId")({
  component: TaskWorkspaceRouteView,
});
