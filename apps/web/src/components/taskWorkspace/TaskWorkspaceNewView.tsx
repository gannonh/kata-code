import { type TaskWorkspaceCommand, type TaskWorkspacePreset } from "@kata-sh/code-contracts";
import {
  TASK_WORKSPACE_PRESET_CATALOG,
  TASK_WORKSPACE_STAGE_LABELS,
  taskWorkspacePresetCatalogEntry,
} from "@kata-sh/code-shared/taskWorkspacePresets";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
  const [preset, setPreset] = useState<TaskWorkspacePreset>("standard");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setProjectId((currentProjectId) =>
      availableProjects.some((project) => project.id === currentProjectId)
        ? currentProjectId
        : (availableProjects[0]?.id ?? ""),
    );
  }, [availableProjects]);

  const selectedProject = availableProjects.find((project) => project.id === projectId) ?? null;
  // The version the task will pin. Displayed rather than assumed so it is
  // obvious which definition a task was created against.
  const selectedPreset = taskWorkspacePresetCatalogEntry(preset);

  async function createTask() {
    if (!selectedProject || !title.trim() || !baseRef.trim()) return;
    setIsSubmitting(true);
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
      preset,
      approvalPolicy: "before-build",
    };
    try {
      await getPrimaryEnvironmentConnection().client.taskWorkspaces.dispatchCommand(command);
      await navigate({ to: "/tasks/$taskId", params: { taskId } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Task creation failed.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          <div>
            <p className="text-xs font-medium text-muted-foreground">Task Workspaces</p>
            <h1 className="text-base font-semibold">Create task</h1>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-8">
          <section className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
            <div>
              <h2 className="text-lg font-semibold">New task workspace</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                One repository, a pinned workflow definition, and approval before Build.
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

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Workflow</legend>
              <div className="grid gap-2" data-testid="task-workflow-picker">
                {TASK_WORKSPACE_PRESET_CATALOG.map((entry) => {
                  const active = entry.preset === preset;
                  return (
                    <label
                      key={entry.preset}
                      data-testid={`task-workflow-option-${entry.preset}`}
                      data-active={active || undefined}
                      className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition-colors ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border/70 hover:border-border"
                      }`}
                    >
                      <input
                        type="radio"
                        name="task-workflow-preset"
                        className="mt-1 size-4 shrink-0"
                        value={entry.preset}
                        checked={active}
                        onChange={() => setPreset(entry.preset)}
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{entry.label}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {entry.currentVersion}
                          </span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {entry.description}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {entry.stages
                            .map((stage) => TASK_WORKSPACE_STAGE_LABELS[stage])
                            .join(" → ")}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Resolved definition</p>
                <p data-testid="task-resolved-definition" className="text-muted-foreground">
                  {selectedPreset.label} · {selectedPreset.currentVersion}
                </p>
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
                disabled={!selectedProject || !title.trim() || !baseRef.trim() || isSubmitting}
                onClick={() => void createTask()}
              >
                {isSubmitting ? "Creating…" : "Create task"}
              </Button>
            </div>
          </section>
        </main>
      </div>
    </SidebarInset>
  );
}
