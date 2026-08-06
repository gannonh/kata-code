import { createFileRoute } from "@tanstack/react-router";

import { TaskWorkspaceNewView } from "../components/taskWorkspace/TaskWorkspaceNewView";
import { requireTaskMode } from "./-taskModeRouteGuard";

export const Route = createFileRoute("/tasks/new")({
  beforeLoad: requireTaskMode,
  component: TaskWorkspaceNewView,
});
