import { createFileRoute } from "@tanstack/react-router";

import { TaskWorkspaceNewView } from "../components/taskWorkspace/TaskWorkspaceNewView";

export const Route = createFileRoute("/tasks/new")({
  component: TaskWorkspaceNewView,
});
