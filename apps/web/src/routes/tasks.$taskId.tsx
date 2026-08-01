import { TaskWorkspaceId } from "@kata-sh/code-contracts";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { useEffect } from "react";

import { selectTaskRefsById, useTaskWorkspaceStore } from "../taskWorkspace/taskWorkspaceStore";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";

/**
 * Compatibility route `/tasks/$taskId`.
 *
 * Performs a read-only fanout across authenticated connected environments:
 * one match redirects to the canonical route, multiple matches show an
 * environment chooser, and zero matches show Not found with
 * unavailable-environment guidance. Lookup never mutates a task.
 */
function TaskCompatRouteView() {
  const { taskId } = Route.useParams();
  const navigate = useNavigate();
  const refs = useTaskWorkspaceStore((state) =>
    selectTaskRefsById(state, TaskWorkspaceId.make(taskId)),
  );

  useEffect(() => {
    if (refs.length !== 1) return;
    void navigate({
      to: "/tasks/$environmentId/$taskId",
      params: { environmentId: refs[0]!.environmentId, taskId },
      replace: true,
    });
  }, [navigate, refs, taskId]);

  if (refs.length === 1) {
    return null;
  }

  if (refs.length > 1) {
    return (
      <Card className="mx-auto w-full max-w-xl">
        <CardHeader>
          <CardTitle>Choose an environment</CardTitle>
          <CardDescription>
            The task id `{taskId}` exists in more than one connected environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {refs.map((ref) => (
            <Button
              key={ref.environmentId}
              variant="outline"
              className="justify-start"
              render={
                <Link
                  to="/tasks/$environmentId/$taskId"
                  params={{ environmentId: ref.environmentId, taskId }}
                />
              }
            >
              {ref.environmentId}
            </Button>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SearchXIcon className="size-5 text-muted-foreground" />
          Task not found
        </CardTitle>
        <CardDescription>No connected environment owns a task with id `{taskId}`.</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        If the task lives in a saved environment, connect that environment first, then reload this
        route.
      </CardContent>
    </Card>
  );
}

export const Route = createFileRoute("/tasks/$taskId")({
  component: TaskCompatRouteView,
});
