import { createFileRoute } from "@tanstack/react-router";

import { TaskModePlaygroundPage } from "../components/playground/taskMode/TaskModePlaygroundPage";

export const Route = createFileRoute("/playground/task-mode")({
  component: TaskModePlaygroundPage,
});
