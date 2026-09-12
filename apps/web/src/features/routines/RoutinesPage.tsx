import {
  DEFAULT_RUNTIME_MODE,
  ModelSelection,
  ProviderInstanceId,
  type ProviderOptionSelection,
  Routine,
  RoutineDraft,
  RoutineId,
  RoutineRequestId,
  type EnvironmentId,
  type RoutineRun,
  type RuntimeMode,
  type ServerProvider,
  type ScheduleTrigger,
} from "@kata-sh/code-contracts";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import * as Schema from "effect/Schema";
import type { ReactNode } from "react";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleAlertIcon,
  Clock3Icon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  Settings2Icon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { routineEnvironment } from "../../state/routines";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { SidebarInset } from "../../components/ui/sidebar";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../../components/ui/empty";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);

type RoutineWithOwner = Routine & {
  readonly ownerLabel: string;
  readonly connectionPhase: string;
};

type DraftState = {
  readonly id: RoutineId;
  readonly environmentId: EnvironmentId;
  readonly expectedRevision: number;
  readonly configuration: RoutineDraft;
};

const EMPTY_ROUTINES: readonly RoutineWithOwner[] = [];
let draftSequence = 0;
const nextDraftId = () => `routine-draft-${Date.now().toString(36)}-${++draftSequence}`;

const statusLabel: Record<Routine["state"], string> = {
  enabled: "Active",
  paused: "Paused",
  deleted: "Deleted",
};

const runStatusLabel: Record<RoutineRun["status"], string> = {
  queued: "Queued",
  starting: "Starting",
  running: "Running",
  "waiting-for-approval": "Waiting for approval",
  succeeded: "Succeeded",
  failed: "Failed",
  interrupted: "Interrupted",
  "needs-attention": "Needs attention",
  skipped: "Skipped",
  blocked: "Blocked",
};

function firstProviderModel(providers: readonly ServerProvider[]): RoutineDraft["modelSelection"] {
  const provider = providers.find(
    (candidate) => candidate.enabled && candidate.models.length > 0 && candidate.instanceId,
  );
  const model = provider?.models.find((candidate) => !candidate.isLegacy) ?? provider?.models[0];
  return decodeModelSelection({
    instanceId: provider?.instanceId ?? ProviderInstanceId.make("codex"),
    model: model?.slug ?? "gpt-5.4",
  });
}

function defaultDraft(
  environmentId: EnvironmentId,
  projects: readonly ReturnType<typeof useProjects>[number][],
  providers: readonly ServerProvider[],
): DraftState | null {
  const project = projects.find((candidate) => candidate.environmentId === environmentId);
  if (!project) return null;
  // `repositoryIdentity` is optional on cached shells from older servers. A
  // missing value means the server has not resolved the repository yet; keep
  // the safe Git worktree default and let the editor expose shared storage
  // explicitly. A resolved null is the definitive non-Git result.
  const workspace =
    project.repositoryIdentity !== null
      ? {
          kind: "worktree" as const,
          baseBranch: "main",
          startFromOrigin: true,
          runSetupScript: true,
        }
      : { kind: "shared" as const, directory: project.workspaceRoot };
  return {
    id: RoutineId.make(nextDraftId()),
    environmentId,
    expectedRevision: 0,
    configuration: {
      name: "",
      instruction: "",
      projectId: project.id,
      modelSelection: firstProviderModel(providers),
      runtimeMode: "approval-required",
      workspace,
      trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
    },
  };
}

function formatSchedule(routine: Routine): string {
  const trigger = routine.configuration.trigger;
  const triggerText =
    trigger.kind === "cron"
      ? trigger.expression
      : trigger.kind === "weekly"
        ? `Weekly on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][trigger.weekday]} at ${trigger.time}`
        : trigger.kind === "weekdays"
          ? `Weekdays at ${trigger.time}`
          : `Daily at ${trigger.time}`;
  return `${triggerText} · ${trigger.timezone}`;
}

function formatDateInTimezone(value: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
      timeZoneName: "shortOffset",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function errorMessage(value: unknown): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "The routine request failed. Try again.";
}

function RoutineEnvironmentRows({
  environmentId,
  ownerLabel,
  connectionPhase,
  onLoaded,
}: {
  readonly environmentId: EnvironmentId;
  readonly ownerLabel: string;
  readonly connectionPhase: string;
  readonly onLoaded: (environmentId: EnvironmentId, routines: readonly RoutineWithOwner[]) => void;
}) {
  const query = useEnvironmentQuery(routineEnvironment.list({ environmentId, input: {} }));
  useEffect(() => {
    if (query.data === null) return;
    onLoaded(
      environmentId,
      query.data.map((routine) => ({
        ...routine,
        ownerLabel,
        connectionPhase,
      })),
    );
  }, [connectionPhase, onLoaded, ownerLabel, query.data]);
  return null;
}

function RoutineCard({
  routine,
  projectLabel,
  selected,
  onSelect,
}: {
  readonly routine: RoutineWithOwner;
  readonly projectLabel: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const offline = routine.connectionPhase !== "connected";
  return (
    <button
      type="button"
      className={cn(
        "group min-w-0 rounded-xl border p-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/60 bg-primary/8 shadow-sm"
          : "border-border/60 bg-card/40 hover:border-border hover:bg-card/75",
        offline && "opacity-75",
      )}
      onClick={onSelect}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-background/75 text-muted-foreground ring-1 ring-border/50">
          <Clock3Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {routine.configuration.name}
            </span>
            {offline ? (
              <Badge variant="outline" size="sm">
                Offline
              </Badge>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {formatSchedule(routine)}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground/70">
            {routine.ownerLabel} · {projectLabel}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground/70">
            {routine.configuration.workspace.kind === "worktree" ? "Worktree" : "Shared folder"}
          </span>
        </span>
      </div>
    </button>
  );
}

function FieldLabel({
  children,
  htmlFor,
}: {
  readonly children: ReactNode;
  readonly htmlFor: string;
}) {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
      {children}
    </label>
  );
}

function RoutineEditor({
  draft,
  routine,
  projects,
  providers,
  offline,
  onDraftChange,
  onSaved,
  onCancel,
}: {
  readonly draft: DraftState;
  readonly routine: RoutineWithOwner | null;
  readonly projects: readonly ReturnType<typeof useProjects>[number][];
  readonly providers: readonly ServerProvider[];
  readonly offline: boolean;
  readonly onDraftChange: (draft: DraftState) => void;
  readonly onSaved: (routine: Routine) => void;
  readonly onCancel: () => void;
}) {
  const save = useAtomCommand(routineEnvironment.save, { reportFailure: false });
  const change = useAtomCommand(routineEnvironment.change, { reportFailure: false });
  const test = useAtomCommand(routineEnvironment.test, { reportFailure: false });
  const history = useEnvironmentQuery(
    routine
      ? routineEnvironment.history({
          environmentId: routine.environmentId,
          input: { id: routine.id, limit: 20 },
        })
      : null,
  );
  const preview = useEnvironmentQuery(
    routineEnvironment.preview({
      environmentId: draft.environmentId,
      input: { trigger: draft.configuration.trigger },
    }),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<RoutineRun | null>(null);

  const configuration = draft.configuration;
  const setConfiguration = (patch: Partial<RoutineDraft>) =>
    onDraftChange({ ...draft, configuration: { ...configuration, ...patch } });
  const setTrigger = (patch: Partial<ScheduleTrigger>) =>
    setConfiguration({ trigger: { ...configuration.trigger, ...patch } as ScheduleTrigger });
  const project = projects.find((candidate) => candidate.id === configuration.projectId);
  const provider = providers.find(
    (candidate) => candidate.instanceId === configuration.modelSelection.instanceId,
  );
  const availableModels = provider?.models ?? [];
  const selectedModel = availableModels.find(
    (candidate) => candidate.slug === configuration.modelSelection.model,
  );
  const optionDescriptors = selectedModel?.capabilities?.optionDescriptors ?? [];
  const selectedOptions = configuration.modelSelection.options ?? [];
  const selectedOption = (id: string) => selectedOptions.find((option) => option.id === id)?.value;
  const setModelOption = (id: string, value: string | boolean) => {
    const nextOptions: ProviderOptionSelection[] = [
      ...selectedOptions.filter((option) => option.id !== id),
      { id, value },
    ];
    setConfiguration({
      modelSelection: decodeModelSelection({
        ...configuration.modelSelection,
        options: nextOptions,
      }),
    });
  };
  const canSave =
    configuration.name.trim().length > 0 &&
    configuration.instruction.trim().length > 0 &&
    project !== undefined &&
    !offline &&
    !busy;
  const isSaved = routine !== null;

  const submitSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setMessage(null);
    const result = await save({
      environmentId: draft.environmentId,
      input: { id: draft.id, expectedRevision: draft.expectedRevision, configuration },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setMessage(errorMessage(result.cause));
      return;
    }
    setMessage("Saved");
    onSaved(result.value);
  };

  const applyChange = async (action: "pause" | "resume" | "delete") => {
    if (!routine || offline || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await change({
      environmentId: routine.environmentId,
      input: { id: routine.id, expectedRevision: routine.revision, action },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setMessage(errorMessage(result.cause));
      return;
    }
    setMessage(
      action === "delete"
        ? "Routine deleted"
        : action === "pause"
          ? "Routine paused"
          : "Routine resumed",
    );
    onSaved(result.value);
    if (action === "delete") onCancel();
  };

  const runTest = async () => {
    if (!routine || offline || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await test({
      environmentId: routine.environmentId,
      input: {
        id: routine.id,
        expectedRevision: routine.revision,
        requestId: RoutineRequestId.make(nextDraftId()),
      },
    });
    setBusy(false);
    if (result._tag === "Failure") {
      setMessage(errorMessage(result.cause));
      return;
    }
    setTestRun(result.value);
    setMessage("Test run admitted");
  };

  return (
    <section className="border-t border-border/60 pt-5" aria-label="Routine editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">
            {isSaved ? configuration.name || "Routine" : "New routine"}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {isSaved
              ? `${statusLabel[routine.state]} · ${routine.ownerLabel}`
              : "Configure a saved prompt for an owning environment."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isSaved && routine.state !== "deleted" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={runTest}
              disabled={offline || busy || routine.state !== "enabled"}
            >
              <RotateCcwIcon className="size-3.5" /> Test run
            </Button>
          ) : null}
          <Button size="sm" onClick={submitSave} disabled={!canSave}>
            <SaveIcon className="size-3.5" /> {busy ? "Saving…" : "Save"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      {message ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      ) : null}
      {offline ? (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
          This environment is offline. Saved routines remain visible, and changes are disabled until
          it reconnects.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-name">Name</FieldLabel>
            <Input
              id="routine-name"
              value={configuration.name}
              onValueChange={(value) => setConfiguration({ name: value })}
              placeholder="Daily project brief"
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-instruction">Instruction</FieldLabel>
            <Textarea
              id="routine-instruction"
              rows={5}
              value={configuration.instruction}
              onChange={(event) => setConfiguration({ instruction: event.target.value })}
              placeholder="Review recent changes and summarize what needs attention."
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-project">Project</FieldLabel>
            <select
              id="routine-project"
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              value={configuration.projectId}
              onChange={(event) => {
                const nextProject = projects.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (!nextProject) return;
                setConfiguration({
                  projectId: nextProject.id,
                  workspace:
                    nextProject.repositoryIdentity !== null
                      ? {
                          kind: "worktree",
                          baseBranch: "main",
                          startFromOrigin: true,
                          runSetupScript: true,
                        }
                      : { kind: "shared", directory: nextProject.workspaceRoot },
                });
              }}
            >
              {projects.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title} · {candidate.workspaceRoot}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-provider">Provider and model</FieldLabel>
            <select
              id="routine-provider"
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              value={`${configuration.modelSelection.instanceId}:${configuration.modelSelection.model}`}
              onChange={(event) => {
                const [instanceId, ...modelParts] = event.target.value.split(":");
                if (!instanceId) return;
                setConfiguration({
                  modelSelection: decodeModelSelection({
                    instanceId,
                    model: modelParts.join(":"),
                    options: undefined,
                  }),
                });
              }}
            >
              {providers.flatMap((candidate) =>
                candidate.models
                  .filter((model) => !model.isLegacy)
                  .map((model) => (
                    <option
                      key={`${candidate.instanceId}:${model.slug}`}
                      value={`${candidate.instanceId}:${model.slug}`}
                    >
                      {candidate.displayName ?? candidate.instanceId} · {model.name}
                    </option>
                  )),
              )}
            </select>
            {availableModels.length === 0 ? (
              <p className="text-xs text-warning-foreground">
                No models are available on this environment.
              </p>
            ) : null}
            {optionDescriptors.length > 0 ? (
              <div className="mt-2 grid gap-2 rounded-lg border border-border/50 bg-muted/15 p-3">
                <span className="text-xs font-medium text-muted-foreground">Model options</span>
                {optionDescriptors.map((descriptor) => {
                  const storedValue = selectedOption(descriptor.id);
                  if (descriptor.type === "boolean") {
                    const value =
                      typeof storedValue === "boolean"
                        ? storedValue
                        : (descriptor.currentValue ?? false);
                    return (
                      <label
                        key={descriptor.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <span>{descriptor.label}</span>
                        <select
                          className="h-7 rounded-md border border-input bg-background px-2"
                          value={value ? "true" : "false"}
                          onChange={(event) =>
                            setModelOption(descriptor.id, event.target.value === "true")
                          }
                        >
                          <option value="false">Off</option>
                          <option value="true">On</option>
                        </select>
                      </label>
                    );
                  }
                  const defaultValue =
                    descriptor.options.find((option) => option.isDefault)?.id ??
                    descriptor.options[0]?.id ??
                    "";
                  const value =
                    typeof storedValue === "string"
                      ? storedValue
                      : (descriptor.currentValue ?? defaultValue);
                  return (
                    <label
                      key={descriptor.id}
                      className="flex items-center justify-between gap-3 text-xs"
                    >
                      <span>{descriptor.label}</span>
                      <select
                        className="h-7 max-w-44 rounded-md border border-input bg-background px-2"
                        value={value}
                        onChange={(event) => setModelOption(descriptor.id, event.target.value)}
                      >
                        {descriptor.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid content-start gap-4">
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-permission">Permission mode</FieldLabel>
            <select
              id="routine-permission"
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              value={configuration.runtimeMode}
              onChange={(event) =>
                setConfiguration({ runtimeMode: event.target.value as RuntimeMode })
              }
            >
              <option value="approval-required">Supervised · ask before changes</option>
              <option value="auto-accept-edits">Auto accept edits</option>
              <option value="auto">Auto</option>
              <option value="full-access">Full access</option>
            </select>
          </div>
          <div className="grid gap-2 rounded-xl border border-border/60 bg-muted/15 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarClockIcon className="size-4 text-muted-foreground" /> When to run
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(["daily", "weekdays", "weekly", "cron"] as const).map((kind) => (
                <Button
                  key={kind}
                  size="sm"
                  variant={configuration.trigger.kind === kind ? "default" : "outline"}
                  onClick={() => {
                    if (kind === "cron")
                      setConfiguration({
                        trigger: { kind, expression: "0 9 * * 1-5", timezone: "UTC" },
                      });
                    else if (kind === "weekly")
                      setConfiguration({
                        trigger: { kind, weekday: 1, time: "09:00", timezone: "UTC" },
                      });
                    else setConfiguration({ trigger: { kind, time: "09:00", timezone: "UTC" } });
                  }}
                >
                  {kind[0]!.toUpperCase() + kind.slice(1)}
                </Button>
              ))}
            </div>
            {configuration.trigger.kind === "cron" ? (
              <Input
                aria-label="Cron expression"
                value={configuration.trigger.expression}
                onValueChange={(value) => setTrigger({ expression: value })}
                placeholder="0 9 * * 1-5"
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  aria-label="Schedule time"
                  type="time"
                  value={configuration.trigger.time}
                  onValueChange={(value) => setTrigger({ time: value })}
                />
                {configuration.trigger.kind === "weekly" ? (
                  <select
                    aria-label="Weekday"
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
                    value={String(configuration.trigger.weekday)}
                    onChange={(event) => setTrigger({ weekday: Number(event.target.value) })}
                  >
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                    <option value="0">Sunday</option>
                  </select>
                ) : (
                  <span />
                )}
              </div>
            )}
            <Input
              aria-label="IANA timezone"
              value={configuration.trigger.timezone}
              onValueChange={(value) => setTrigger({ timezone: value })}
              placeholder="America/Los_Angeles"
            />
            {preview.data ? (
              <div className="grid gap-1 text-xs text-muted-foreground">
                <span>Next runs</span>
                {preview.data.dates.map((date) => (
                  <span key={date}>
                    {formatDateInTimezone(date, configuration.trigger.timezone)}
                  </span>
                ))}
              </div>
            ) : preview.error ? (
              <p className="text-xs text-destructive">{preview.error}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-workspace">Workspace</FieldLabel>
            <select
              id="routine-workspace"
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
              value={configuration.workspace.kind}
              onChange={(event) => {
                if (event.target.value === "worktree")
                  setConfiguration({
                    workspace: {
                      kind: "worktree",
                      baseBranch: "main",
                      startFromOrigin: true,
                      runSetupScript: true,
                    },
                  });
                else
                  setConfiguration({
                    workspace: { kind: "shared", directory: project?.workspaceRoot ?? "" },
                  });
              }}
            >
              <option value="worktree">Isolated Git worktree</option>
              <option value="shared">Shared project directory</option>
            </select>
            {configuration.workspace.kind === "worktree" ? (
              <Input
                aria-label="Base branch"
                value={configuration.workspace.baseBranch}
                onValueChange={(value) =>
                  setConfiguration({
                    workspace: {
                      kind: "worktree",
                      baseBranch: value,
                      startFromOrigin: true,
                      runSetupScript: true,
                    },
                  })
                }
                placeholder="main"
              />
            ) : (
              <Input
                aria-label="Shared directory"
                value={configuration.workspace.directory}
                onValueChange={(value) =>
                  setConfiguration({ workspace: { kind: "shared", directory: value } })
                }
              />
            )}
          </div>
        </div>
      </div>

      {isSaved ? (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-4">
          <div className="flex flex-wrap gap-2">
            {routine.state === "enabled" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void applyChange("pause")}
                disabled={busy || offline}
              >
                <PauseIcon className="size-3.5" /> Pause
              </Button>
            ) : routine.state === "paused" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void applyChange("resume")}
                disabled={busy || offline}
              >
                <PlayIcon className="size-3.5" /> Resume
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void applyChange("delete")}
              disabled={busy || offline}
            >
              <Trash2Icon className="size-3.5 text-destructive" /> Delete
            </Button>
          </div>
          <Menu>
            <MenuTrigger
              render={<Button size="icon-sm" variant="ghost" aria-label="Routine actions" />}
            >
              <MoreHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={onCancel}>
                <Settings2Icon className="size-4" /> Close editor
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      ) : null}

      {isSaved ? (
        <div className="mt-6 border-t border-border/60 pt-4">
          <h3 className="text-sm font-semibold">Recent runs</h3>
          {history.data?.runs.length ? (
            <div className="mt-3 grid gap-2">
              {history.data.runs.map((run) => (
                <div
                  key={run.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/30 px-3 py-2 text-xs"
                >
                  <span className="flex items-center gap-2">
                    {run.status === "succeeded" ? (
                      <CheckCircle2Icon className="size-3.5 text-success" />
                    ) : (
                      <CircleAlertIcon className="size-3.5 text-muted-foreground" />
                    )}
                    {runStatusLabel[run.status]}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                  {run.conversation.kind === "confirmed" ? (
                    <Link
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      to="/$environmentId/$threadId"
                      params={{
                        environmentId: run.environmentId,
                        threadId: run.conversation.threadId,
                      }}
                    >
                      <ExternalLinkIcon className="size-3" /> Open conversation
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          ) : history.error ? (
            <p className="mt-2 text-xs text-destructive">{history.error}</p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">No runs yet.</p>
          )}
          {testRun?.conversation.kind === "confirmed" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Test run ready:{" "}
              <Link
                className="text-primary hover:underline"
                to="/$environmentId/$threadId"
                params={{
                  environmentId: testRun.environmentId,
                  threadId: testRun.conversation.threadId,
                }}
              >
                open the conversation
              </Link>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function RoutinesPage() {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [routinesByEnvironment, setRoutinesByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, readonly RoutineWithOwner[]>
  >(new Map());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editing, setEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const newRoutineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const allRoutines = useMemo(
    () => Array.from(routinesByEnvironment.values()).flatMap((values) => values),
    [routinesByEnvironment],
  );
  const selectedRoutine =
    allRoutines.find((routine) => `${routine.environmentId}:${routine.id}` === selectedKey) ?? null;
  const selectedEnvironment = environments.find(
    (environment) =>
      environment.environmentId === (draft?.environmentId ?? selectedRoutine?.environmentId),
  );
  const selectedProviders = useAtomValue(
    serverEnvironment.providersValueAtom(
      draft?.environmentId ??
        selectedRoutine?.environmentId ??
        primaryEnvironmentId ??
        environments[0]?.environmentId ??
        ("" as EnvironmentId),
    ),
  );
  const saveDraftEnvironment =
    draft?.environmentId ??
    selectedRoutine?.environmentId ??
    primaryEnvironmentId ??
    environments[0]?.environmentId ??
    null;

  const onLoaded = useCallback(
    (environmentId: EnvironmentId, values: readonly RoutineWithOwner[]) => {
      setRoutinesByEnvironment((previous) => new Map(previous).set(environmentId, values));
    },
    [],
  );

  const startNew = () => {
    const environmentId = primaryEnvironmentId ?? environments[0]?.environmentId;
    if (!environmentId) return;
    setShowMenu(false);
    setSelectedKey(null);
    setDraft(null);
    setEditing(true);
  };

  useEffect(() => {
    if (!editing || draft !== null || saveDraftEnvironment === null) return;
    // The provider snapshot is read through the atom registry by the next
    // render. This effect only chooses a concrete owner and project.
    const environmentId = saveDraftEnvironment;
    const environmentProjects = projects.filter(
      (project) => project.environmentId === environmentId,
    );
    const providers = selectedProviders ?? [];
    const next = defaultDraft(environmentId, environmentProjects, providers);
    if (next) setDraft(next);
  }, [draft, editing, projects, saveDraftEnvironment, selectedProviders]);

  const selectRoutine = (routine: RoutineWithOwner) => {
    setSelectedKey(`${routine.environmentId}:${routine.id}`);
    setDraft({
      id: routine.id,
      environmentId: routine.environmentId,
      expectedRevision: routine.revision,
      configuration: routine.configuration,
    });
    setEditing(true);
    setShowMenu(false);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft(null);
    setSelectedKey(null);
    queueMicrotask(() => newRoutineTriggerRef.current?.focus());
  };

  const ownerOffline = selectedEnvironment?.connection.phase !== "connected";
  const updateSavedRoutine = (routine: Routine) => {
    setDraft({
      id: routine.id,
      environmentId: routine.environmentId,
      expectedRevision: routine.revision,
      configuration: routine.configuration,
    });
    setSelectedKey(`${routine.environmentId}:${routine.id}`);
    setEditing(true);
    setRoutinesByEnvironment((previous) => {
      const next = new Map(previous);
      const existing = next.get(routine.environmentId) ?? [];
      if (routine.state === "deleted") {
        next.set(
          routine.environmentId,
          existing.filter((entry) => entry.id !== routine.id),
        );
        return next;
      }
      const owner = existing.find((entry) => entry.id === routine.id);
      const replacement: RoutineWithOwner = {
        ...routine,
        ownerLabel: owner?.ownerLabel ?? "Environment",
        connectionPhase: owner?.connectionPhase ?? "connected",
      };
      next.set(
        routine.environmentId,
        existing.some((entry) => entry.id === routine.id)
          ? existing.map((entry) => (entry.id === routine.id ? replacement : entry))
          : [...existing, replacement],
      );
      return next;
    });
  };

  if (!isReady)
    return (
      <SidebarInset className="min-h-0 bg-background">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Loading routines…</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );

  return (
    <SidebarInset className="min-h-0 overflow-auto bg-background text-foreground">
      <WorkspacePageHeader className="border-b border-border/60">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-foreground">Routines</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="text-muted-foreground">All projects</span>
        </div>
      </WorkspacePageHeader>
      <main className="mx-auto w-full max-w-5xl px-4 py-7 sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Routines</h1>
            <p className="mt-1 max-w-lg text-sm text-muted-foreground">
              Prompts that run on a schedule. Each routine stays owned by the environment where it
              was saved.
            </p>
          </div>
          <Menu open={showMenu} onOpenChange={setShowMenu}>
            <MenuTrigger render={<Button ref={newRoutineTriggerRef} aria-expanded={showMenu} />}>
              <PlusIcon className="size-4" /> New routine <ChevronDownIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-48">
              <MenuItem onClick={startNew}>
                <Settings2Icon className="size-4 text-muted-foreground" /> Set up manually
              </MenuItem>
              <MenuItem disabled>
                <CalendarClockIcon className="size-4 text-muted-foreground" /> Create in chat
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {environments.map((environment) => (
            <RoutineEnvironmentRows
              key={environment.environmentId}
              environmentId={environment.environmentId}
              ownerLabel={environment.label}
              connectionPhase={environment.connection.phase}
              onLoaded={onLoaded}
            />
          ))}
          {allRoutines.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
              <CalendarClockIcon className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">No routines yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Create a manual routine to run a saved prompt later.
              </p>
            </div>
          ) : (
            allRoutines.map((routine) => {
              const project = projects.find(
                (candidate) =>
                  candidate.environmentId === routine.environmentId &&
                  candidate.id === routine.configuration.projectId,
              );
              const projectLabel = project
                ? `${project.title} · ${project.workspaceRoot}`
                : String(routine.configuration.projectId);
              return (
                <RoutineCard
                  key={`${routine.environmentId}:${routine.id}`}
                  routine={routine}
                  projectLabel={projectLabel}
                  selected={selectedKey === `${routine.environmentId}:${routine.id}`}
                  onSelect={() => selectRoutine(routine)}
                />
              );
            })
          )}
        </div>
        {editing && draft ? (
          <RoutineEditor
            draft={draft}
            routine={selectedRoutine}
            projects={projects.filter((project) => project.environmentId === draft.environmentId)}
            providers={selectedProviders ?? []}
            offline={ownerOffline === true}
            onDraftChange={setDraft}
            onSaved={updateSavedRoutine}
            onCancel={cancelEditing}
          />
        ) : null}
      </main>
    </SidebarInset>
  );
}
