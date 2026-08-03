import type { EnvironmentId, TaskWorkspaceId } from "@kata-sh/code-contracts";
import { AlertTriangleIcon, CircleDotIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react";
import { useCallback } from "react";

import { readEnvironmentConnection } from "../../environments/runtime";
import { useTaskWorkspaceCommands } from "../../taskWorkspace/useTaskWorkspaceCommands";
import { selectTaskByRef, useTaskWorkspaceStore } from "../../taskWorkspace/taskWorkspaceStore";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../ui/card";
import { TaskWorkspaceView } from "./TaskWorkspaceView";

/**
 * State machine for the canonical task route.
 *
 * - Starting: durable bootstrap or handoff work is pending;
 * - Ready: the task exists and its current conversation is available;
 * - Failed: the transition failed and exposes an idempotent Retry action;
 * - Needs repair: the repository or legacy association needs explicit repair;
 * - offline: the owning environment connection is not available.
 */
export function TaskRouteView(props: {
  readonly environmentId: EnvironmentId;
  readonly taskId: TaskWorkspaceId;
}) {
  const { environmentId, taskId } = props;
  const connection = readEnvironmentConnection(environmentId);
  const task = useTaskWorkspaceStore((state) => selectTaskByRef(state, environmentId, taskId));
  const commands = useTaskWorkspaceCommands(taskId);

  const retry = useCallback(async () => {
    if (!task?.bootstrap) return;
    await commands.dispatch(
      {
        type: "task.operation.retry",
        commandId: commands.commandBase("task.operation.retry").commandId,
        taskId,
        createdAt: new Date().toISOString(),
        expectedTaskRevision: task.taskRevision,
        targetOperationKey: task.bootstrap.operationKey,
      },
      "retry-bootstrap",
    );
  }, [commands, task, taskId]);

  if (!connection) {
    return (
      <RouteStateCard
        icon={<CircleDotIcon className="size-5 text-muted-foreground" />}
        title="Environment offline"
        description="The environment that owns this task is not connected. Reconnect the environment to open the task."
      />
    );
  }

  if (task === null) {
    return (
      <RouteStateCard
        icon={<LoaderCircleIcon className="size-5 animate-spin" />}
        title="Starting task"
        description="Preparing the task conversation. The route stays here until the initial conversation is ready."
      />
    );
  }

  if (task.environmentId === null || task.workspace.repositories.length === 0) {
    return (
      <RouteStateCard
        icon={<AlertTriangleIcon className="size-5 text-warning-foreground" />}
        title="Needs repair"
        description="This task has no repository binding for the current environment. Repair the association to continue."
      />
    );
  }

  if (task.bootstrap?.status === "failed") {
    return (
      <Card className="mx-auto w-full max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangleIcon className="size-5 text-destructive" />
            Transition failed
          </CardTitle>
          <CardDescription>
            {task.bootstrap.failure?.message ??
              "The task bootstrap failed and can be retried idempotently."}
          </CardDescription>
        </CardHeader>
        <CardFooter className="gap-2">
          <Button
            variant="default"
            data-testid="task-retry-bootstrap"
            disabled={commands.isBusy}
            onClick={() => void retry()}
          >
            <RefreshCwIcon className="size-4" />
            Retry
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return <TaskWorkspaceView taskId={taskId} />;
}

function RouteStateCard(props: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
}) {
  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {props.icon}
          {props.title}
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        The URL stays stable across stage handoffs; the task route resolves the current conversation
        from durable state.
      </CardContent>
    </Card>
  );
}
