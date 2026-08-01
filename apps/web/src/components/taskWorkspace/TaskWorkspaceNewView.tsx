import {
  type ProviderOptionSelection,
  type TaskWorkspaceCommand,
  type TaskWorkspacePreset,
  type TaskWorkspaceWorktreePolicy,
} from "@kata-sh/code-contracts";
import {
  currentCatalogEntryForPreset,
  TASK_WORKSPACE_WORKFLOW_CATALOG,
  type TaskWorkspaceCatalogEntry,
} from "@kata-sh/code-shared/taskWorkspaceCatalog";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { newCommandId } from "../../lib/utils";
import {
  deriveProviderInstanceEntries,
  getProviderInstanceModels,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { useServerProviders } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";

const WORKTREE_POLICY_OPTIONS: ReadonlyArray<{
  readonly value: TaskWorkspaceWorktreePolicy;
  readonly label: string;
  readonly description: string;
}> = [
  {
    value: "now",
    label: "Now",
    description: "Provision the task worktree from the pinned base commit before Clarify starts.",
  },
  {
    value: "later",
    label: "Later",
    description: "Plan against the source repository; provision the worktree after Plan approval.",
  },
  {
    value: "never",
    label: "Never",
    description:
      "Planning-only for this slice. Implement stays unavailable unless you switch to Now or Later.",
  },
];

const TASK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function validateSlug(slug: string): string | null {
  if (slug.length === 0) return "The task slug cannot be empty.";
  if (slug.length > 80) return "The task slug must be 80 characters or fewer.";
  if (!TASK_SLUG_PATTERN.test(slug)) {
    return "The task slug must use lowercase letters, digits, and single dashes, and start and end with an alphanumeric character.";
  }
  return null;
}

function catalogCapabilityLabel(entry: TaskWorkspaceCatalogEntry): string {
  return entry.availableInFirstSlice ? "Available through approved Plan" : "Preview shell";
}

export function TaskWorkspaceNewView() {
  const navigate = useNavigate();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const providers = useServerProviders();
  const instanceEntries = useMemo(
    () => sortProviderInstanceEntries(deriveProviderInstanceEntries(providers)),
    [providers],
  );
  const availableProjects = useMemo(
    () => projects.filter((project) => project.environmentId === primaryEnvironmentId),
    [primaryEnvironmentId, projects],
  );
  const [title, setTitle] = useState("Guided onboarding");
  const [slug, setSlug] = useState("guided-onboarding");
  const [brief, setBrief] = useState("");
  const [projectId, setProjectId] = useState(availableProjects[0]?.id ?? "");
  const [baseRef, setBaseRef] = useState("main");
  const [preset, setPreset] = useState<TaskWorkspacePreset>("guided");
  const [worktreePolicy, setWorktreePolicy] = useState<TaskWorkspaceWorktreePolicy>("later");
  const [instanceId, setInstanceId] = useState(instanceEntries[0]?.instanceId ?? "");
  const [modelSlug, setModelSlug] = useState("");
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const selectableInstanceEntries = useMemo(
    () =>
      preset === "guided"
        ? instanceEntries.filter(
            (entry) =>
              entry.driverKind !== "pi" &&
              entry.enabled &&
              entry.installed &&
              entry.isAvailable &&
              entry.status !== "disabled" &&
              entry.status !== "error",
          )
        : instanceEntries,
    [instanceEntries, preset],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setProjectId((currentProjectId) =>
      availableProjects.some((project) => project.id === currentProjectId)
        ? currentProjectId
        : (availableProjects[0]?.id ?? ""),
    );
  }, [availableProjects]);

  useEffect(() => {
    setInstanceId((currentInstanceId) =>
      selectableInstanceEntries.some((entry) => entry.instanceId === currentInstanceId)
        ? currentInstanceId
        : (selectableInstanceEntries[0]?.instanceId ?? ""),
    );
  }, [selectableInstanceEntries]);

  const selectedProject = availableProjects.find((project) => project.id === projectId) ?? null;
  const catalogEntry = currentCatalogEntryForPreset(preset);
  const instanceModels = useMemo(
    () =>
      instanceId
        ? getProviderInstanceModels(
            providers,
            instanceId as Parameters<typeof getProviderInstanceModels>[1],
          )
        : [],
    [instanceId, providers],
  );

  useEffect(() => {
    setModelSlug((currentModel) =>
      instanceModels.some((model) => model.slug === currentModel)
        ? currentModel
        : (instanceModels[0]?.slug ?? ""),
    );
  }, [instanceModels]);

  const selectedModel = instanceModels.find((model) => model.slug === modelSlug) ?? null;
  const optionDescriptors = selectedModel?.capabilities?.optionDescriptors ?? [];
  const optionSelections: ProviderOptionSelection[] = optionDescriptors.flatMap(
    (descriptor): ReadonlyArray<ProviderOptionSelection> => {
      if (descriptor.type === "select") {
        const value = optionValues[descriptor.id] ?? descriptor.options[0]?.id;
        return value ? [{ id: descriptor.id, value }] : [];
      }
      return [{ id: descriptor.id, value: true }];
    },
  );

  const slugError = validateSlug(slug);
  const canSubmit =
    selectedProject !== null &&
    title.trim().length > 0 &&
    brief.trim().length > 0 &&
    slugError === null &&
    instanceId !== "" &&
    modelSlug !== "" &&
    !isSubmitting;

  async function createTask() {
    if (!selectedProject || !canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    const createdAt = new Date().toISOString();
    const trimmedBrief = brief.trim();
    const command: TaskWorkspaceCommand = {
      type: "task.create",
      commandId: newCommandId(),
      taskId: slug,
      createdAt,
      title: title.trim(),
      brief: trimmedBrief,
      source: { kind: "inline", body: trimmedBrief },
      projectId: selectedProject.id,
      baseRef: baseRef.trim(),
      preset,
      approvalPolicy: "before-build",
      operationKey: `task-create-${newCommandId()}`,
      worktreePolicy,
      modelSelection: {
        instanceId: instanceId as Parameters<typeof getProviderInstanceModels>[1],
        model: modelSlug,
        options: optionSelections,
      },
    };
    try {
      const result =
        await getPrimaryEnvironmentConnection().client.taskWorkspaces.dispatchCommand(command);
      const route = result.taskRoute ?? { environmentId: primaryEnvironmentId!, taskId: slug };
      await navigate({
        to: "/tasks/$environmentId/$taskId",
        params: { environmentId: route.environmentId, taskId: route.taskId },
      });
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
            <p className="text-xs font-medium text-muted-foreground">Tasks</p>
            <h1 className="text-base font-semibold">Create task</h1>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-auto p-4 sm:p-8">
          <section className="mx-auto max-w-2xl space-y-6 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
            <div>
              <h2 className="text-lg font-semibold">New task</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A brief, a workflow, and a conversation. Kata owns the stage sessions; you work
                through the normal composer.
              </p>
            </div>

            <label className="block space-y-2 text-sm font-medium">
              Workflow
              <div className="grid gap-2" data-testid="task-workflow-picker">
                {TASK_WORKSPACE_WORKFLOW_CATALOG.map((entry) => {
                  const active = entry.preset === preset;
                  return (
                    <label
                      key={entry.version}
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
                            {entry.version}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                              entry.availableInFirstSlice
                                ? "bg-success/10 text-success-foreground"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {catalogCapabilityLabel(entry)}
                          </span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {entry.description}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {entry.stages.map((stage) => stage.presentation).join(" → ")}
                        </span>
                        {!entry.availableInFirstSlice ? (
                          <span className="block text-xs text-warning-foreground">
                            Preview: only the conversation shell is created; stage progression
                            arrives with the {entry.label} slice.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </label>

            <label className="block space-y-2 text-sm font-medium">
              Task name
              <Input
                nativeInput
                data-testid="task-title-input"
                value={title}
                onChange={(event) => {
                  const next = event.currentTarget.value;
                  setTitle(next);
                  setSlug(slugFromTitle(next) || slug);
                }}
              />
            </label>

            <label className="block space-y-2 text-sm font-medium">
              Task slug (immutable task id)
              <Input
                nativeInput
                data-testid="task-slug-input"
                value={slug}
                onChange={(event) => setSlug(event.currentTarget.value)}
              />
              {slugError ? <span className="text-xs text-destructive">{slugError}</span> : null}
            </label>

            <label className="block space-y-2 text-sm font-medium">
              Brief
              <textarea
                data-testid="task-brief-input"
                className="min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                placeholder="What should this task accomplish?"
                value={brief}
                onChange={(event) => setBrief(event.currentTarget.value)}
              />
              <span className="block text-xs text-muted-foreground">
                {brief.length.toLocaleString()} / 100,000 characters
              </span>
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
              <legend className="text-sm font-medium">Worktree timing</legend>
              <div className="grid gap-2" data-testid="task-worktree-policy-picker">
                {WORKTREE_POLICY_OPTIONS.map((option) => {
                  const active = option.value === worktreePolicy;
                  return (
                    <label
                      key={option.value}
                      data-testid={`task-worktree-option-${option.value}`}
                      data-active={active || undefined}
                      className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-sm transition-colors ${
                        active
                          ? "border-primary bg-primary/5"
                          : "border-border/70 hover:border-border"
                      }`}
                    >
                      <input
                        type="radio"
                        name="task-worktree-policy"
                        className="mt-1 size-4 shrink-0"
                        value={option.value}
                        checked={active}
                        onChange={() => setWorktreePolicy(option.value)}
                      />
                      <span className="min-w-0 space-y-1">
                        <span className="font-medium">{option.label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Coding agent</legend>
              <label className="block space-y-2 text-sm font-medium">
                Agent
                <select
                  data-testid="task-agent-select"
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={instanceId}
                  disabled={selectableInstanceEntries.length === 0}
                  onChange={(event) => {
                    setInstanceId(event.currentTarget.value);
                    setModelSlug("");
                    setOptionValues({});
                  }}
                >
                  {selectableInstanceEntries.map((entry) => (
                    <option key={entry.instanceId} value={entry.instanceId}>
                      {entry.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-2 text-sm font-medium">
                Model
                <select
                  data-testid="task-model-select"
                  className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  value={modelSlug}
                  onChange={(event) => {
                    setModelSlug(event.currentTarget.value);
                    setOptionValues({});
                  }}
                >
                  {instanceModels.map((model) => (
                    <option key={model.slug} value={model.slug}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </label>
              {optionDescriptors.length > 0 ? (
                <div className="space-y-2">
                  {optionDescriptors.map((descriptor) => {
                    if (descriptor.type === "select") {
                      return (
                        <label key={descriptor.id} className="block space-y-2 text-sm font-medium">
                          {descriptor.label}
                          <select
                            data-testid={`task-model-option-${descriptor.id}`}
                            className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                            value={optionValues[descriptor.id] ?? descriptor.options[0]?.id}
                            onChange={(event) =>
                              setOptionValues((current) => ({
                                ...current,
                                [descriptor.id]: event.currentTarget.value,
                              }))
                            }
                          >
                            {descriptor.options.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    }
                    return (
                      <label
                        key={descriptor.id}
                        className="flex items-center gap-2 text-sm font-medium"
                      >
                        <input
                          type="checkbox"
                          data-testid={`task-model-option-${descriptor.id}`}
                          defaultChecked
                        />
                        {descriptor.label}
                      </label>
                    );
                  })}
                </div>
              ) : null}
            </fieldset>

            <div className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-medium">Resolved workflow</p>
                <p data-testid="task-resolved-definition" className="text-muted-foreground">
                  {catalogEntry.label} · {catalogEntry.version}
                </p>
              </div>
              <div>
                <p className="font-medium">Capability</p>
                <p className="text-muted-foreground">{catalogCapabilityLabel(catalogEntry)}</p>
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
                disabled={!canSubmit}
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
