import type { TaskWorkspaceCommand } from "@kata-sh/code-contracts";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { newCommandId, randomUUID } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";

export function TaskWorkspaceNewView() {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const availableProjects = useMemo(
    () => projects.filter((project) => project.environmentId === primaryEnvironmentId),
    [primaryEnvironmentId, projects],
  );
  const [title, setTitle] = useState("Slice 1 task workspace");
  const [projectId, setProjectId] = useState(availableProjects[0]?.id ?? "");
  const [baseRef, setBaseRef] = useState("main");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedProject = availableProjects.find((project) => project.id === projectId) ?? null;

  async function createTask() {
    if (!selectedProject || !title.trim() || !baseRef.trim()) return;
    setSubmitting(true);
    setError(null);
    const taskId = `task-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    const command: TaskWorkspaceCommand = {
      type: "task.create",
      commandId: newCommandId(),
      taskId,
      createdAt,
      title: title.trim(),
      projectId: selectedProject.id,
      workspaceRoot: selectedProject.cwd,
      baseRef: baseRef.trim(),
      preset: "standard",
      approvalPolicy: "before-build",
    };
    try {
      await getPrimaryEnvironmentConnection().client.taskWorkspaces.dispatchCommand(command);
      await navigate({ to: "/tasks/$taskId", params: { taskId } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task creation failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Task Workspaces</p>
            <h1 className="text-base font-semibold">Create Standard task</h1>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-8">
          <section className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
            <div>
              <h2 className="text-lg font-semibold">Walking skeleton</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                One repository, Standard workflow, and approval before Build.
              </p>
            </div>

            <label className="block space-y-2 text-sm font-medium">
              Task title
              <Input
                nativeInput
                data-testid="task-title-input"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </label>

            <label className="block space-y-2 text-sm font-medium">
              Repository
              <select
                data-testid="task-repository-select"
                className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                value={projectId}
                onChange={(event) => setProjectId(event.currentTarget.value)}
              >
                {availableProjects.map((project) => (
                  <option key={`${project.environmentId}:${project.id}`} value={project.id}>
                    {project.name} — {project.cwd}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-2 text-sm font-medium">
              Base ref
              <Input
                nativeInput
                data-testid="task-base-ref-input"
                value={baseRef}
                onChange={(event) => setBaseRef(event.currentTarget.value)}
              />
            </label>

            <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Workflow</p>
                <p className="text-muted-foreground">Standard · standard@0.1.0</p>
              </div>
              <div>
                <p className="font-medium">Approval policy</p>
                <p className="text-muted-foreground">before-build</p>
              </div>
            </div>

            {availableProjects.length === 0 ? (
              <p className="rounded-lg border border-warning/40 bg-warning/8 p-3 text-sm text-warning-foreground">
                Add a repository project before creating a task.
              </p>
            ) : null}
            {error ? (
              <p data-testid="task-create-error" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end">
              <Button
                data-testid="task-create-submit"
                disabled={!selectedProject || !title.trim() || !baseRef.trim() || submitting}
                onClick={() => void createTask()}
              >
                {submitting ? "Creating…" : "Create task"}
              </Button>
            </div>
          </section>
        </main>
      </div>
    </SidebarInset>
  );
}
