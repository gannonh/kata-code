import {
  ModelSelection,
  type ProviderOptionSelection,
  Routine,
  type RoutineId,
  isScheduleTrigger,
  type EnvironmentId,
  type GitHubRoutineConnection,
  type LinearRoutineConnection,
  type RoutineRun,
  type RuntimeMode,
  type ServerProvider,
  type ScheduleTrigger,
} from "@kata-sh/code-contracts";
import * as Schema from "effect/Schema";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  Settings2Icon,
  SquareKanbanIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { routineEnvironment } from "../../state/routines";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import type { useProjects } from "../../state/entities";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { requestConfirmDialog } from "../../confirmDialog";
import {
  canSaveRoutineDraft,
  confirmDialogAccepted,
  defaultGitHubTrigger,
  defaultLinearTrigger,
  DELETE_ROUTINE_MESSAGE,
  DISCARD_UNSAVED_ROUTINE_MESSAGE,
  enabledProviders,
  errorMessage,
  gitHubEditorTrigger,
  isRoutineEditorDraftComplete,
  isRoutineEditorScheduleTrigger,
  isRoutineDraftDirty,
  linearEditorTrigger,
  newRoutineRequestId,
  preferredWorktreeBaseBranch,
  routineDraftBaselineAfterAutomaticChange,
  ROUTINE_CANCEL_HINT,
  ROUTINE_CONTROL_CLASS,
  ROUTINE_EDITOR_COLUMN_CLASS,
  ROUTINE_EDITOR_FIELDS_CLASS,
  ROUTINE_PERMISSION_MODE_LABELS,
  ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS,
  routineTriggerKind,
  selectableConnections,
  switchRoutineEditorTrigger,
  worktreeWorkspace,
  type GitHubTriggerPatch,
  type LinearTriggerPatch,
  type RoutineEditorDraft,
  type RoutineTriggerKind,
} from "./RoutinesPage.logic";
import { FieldLabel } from "./FieldLabel";
import { GitHubTriggerSection, LinearTriggerSection } from "./EventTriggerSections";
import { ScheduleTriggerFields } from "./RoutineTriggerFields";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);

export type RoutineWithOwner = Routine & {
  readonly ownerLabel: string;
  readonly connectionPhase: string;
};

export type DraftState = {
  readonly id: RoutineId;
  readonly environmentId: EnvironmentId;
  readonly expectedRevision: number;
  readonly configuration: RoutineEditorDraft;
};

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

export function RoutineEditor({
  draft,
  routine,
  projects,
  providers,
  owners,
  offline,
  onDraftChange,
  onOwnerChange,
  onSaved,
  onCancel,
  baseline,
  onBaselineChange,
}: {
  readonly draft: DraftState;
  readonly routine: RoutineWithOwner | null;
  readonly projects: readonly ReturnType<typeof useProjects>[number][];
  readonly providers: readonly ServerProvider[];
  readonly owners: readonly {
    readonly environmentId: EnvironmentId;
    readonly label: string;
  }[];
  readonly offline: boolean;
  readonly onDraftChange: (draft: DraftState) => void;
  readonly onOwnerChange: (environmentId: EnvironmentId) => void;
  readonly onSaved: (routine: Routine) => void;
  readonly onCancel: () => void;
  readonly baseline: RoutineEditorDraft;
  readonly onBaselineChange: (baseline: RoutineEditorDraft) => void;
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
  const [historyBefore, setHistoryBefore] = useState<string | null>(null);
  const olderHistory = useEnvironmentQuery(
    routine && historyBefore
      ? routineEnvironment.history({
          environmentId: routine.environmentId,
          input: { id: routine.id, limit: 20, before: historyBefore },
        })
      : null,
  );
  const [extraRuns, setExtraRuns] = useState<readonly RoutineRun[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const firstPageKey = history.data?.runs.map((run) => run.id).join(",") ?? "";
  useEffect(() => {
    setExtraRuns([]);
    setHistoryBefore(null);
    setOlderCursor(history.data?.nextCursor ?? null);
  }, [firstPageKey, history.data?.nextCursor, routine?.id]);
  useEffect(() => {
    if (!historyBefore || olderHistory.data === null) return;
    setExtraRuns((previous) => [...previous, ...olderHistory.data!.runs]);
    setOlderCursor(olderHistory.data.nextCursor);
    setHistoryBefore(null);
  }, [historyBefore, olderHistory.data]);
  const connections = useEnvironmentQuery(
    routineEnvironment.connections({ environmentId: draft.environmentId, input: {} }),
  );
  // Editor-only: the schedule restored when the user switches back from an
  // event kind. It never enters the draft, the save payload, or the dirty check.
  const [returnSchedule, setReturnSchedule] = useState<ScheduleTrigger>(() =>
    isRoutineEditorScheduleTrigger(draft.configuration.trigger)
      ? draft.configuration.trigger
      : { kind: "daily", time: "09:00", timezone: "UTC" },
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<RoutineRun | null>(null);

  const configuration = draft.configuration;
  const setConfiguration = (patch: Partial<RoutineEditorDraft>) =>
    onDraftChange({ ...draft, configuration: { ...configuration, ...patch } });
  const trigger = configuration.trigger;
  const gitHubTrigger =
    trigger.kind === "github" || trigger.kind === "github-draft" ? trigger : null;
  const linearTrigger =
    trigger.kind === "linear" || trigger.kind === "linear-draft" ? trigger : null;
  const scheduleTrigger = isRoutineEditorScheduleTrigger(trigger) ? trigger : null;
  const setGitHubTrigger = (patch: GitHubTriggerPatch) => {
    if (gitHubTrigger === null) return;
    setConfiguration({ trigger: gitHubEditorTrigger({ ...gitHubTrigger, ...patch }) });
  };
  const setLinearTrigger = (patch: LinearTriggerPatch) => {
    if (linearTrigger === null) return;
    setConfiguration({ trigger: linearEditorTrigger({ ...linearTrigger, ...patch }) });
  };
  const triggerKind = routineTriggerKind(trigger);
  const savedConnectionId =
    routine && !isScheduleTrigger(routine.configuration.trigger)
      ? routine.configuration.trigger.connectionId
      : null;
  const availableConnections = selectableConnections(connections.data ?? [], savedConnectionId);
  const githubConnections = availableConnections.filter(
    (connection): connection is GitHubRoutineConnection => connection.provider === "github",
  );
  const linearConnections = availableConnections.filter(
    (connection): connection is LinearRoutineConnection => connection.provider === "linear",
  );
  const allConnections = connections.data ?? [];
  const gitHubConnectionId = trigger.kind === "github" ? trigger.connectionId : undefined;
  const selectedGitHubConnection =
    gitHubConnectionId === undefined
      ? undefined
      : allConnections.find(
          (candidate): candidate is GitHubRoutineConnection =>
            candidate.provider === "github" && candidate.id === gitHubConnectionId,
        );
  const linearConnectionId = linearTrigger?.connectionId;
  const selectedLinearConnection =
    linearConnectionId === undefined
      ? undefined
      : allConnections.find(
          (candidate): candidate is LinearRoutineConnection =>
            candidate.provider === "linear" && candidate.id === linearConnectionId,
        );
  const selectedConnection =
    triggerKind === "linear" ? selectedLinearConnection : selectedGitHubConnection;
  const switchTriggerKind = (kind: RoutineTriggerKind) => {
    if (scheduleTrigger !== null && kind !== "schedule") setReturnSchedule(scheduleTrigger);
    const next = switchRoutineEditorTrigger(trigger, kind, {
      githubConnections,
      linearConnections,
      returnSchedule,
    });
    if (next !== trigger) setConfiguration({ trigger: next });
  };
  const project = projects.find((candidate) => candidate.id === configuration.projectId);
  const selectableProviders = enabledProviders(providers);
  const refs = useEnvironmentQuery(
    project && configuration.workspace.kind === "worktree"
      ? vcsEnvironment.listRefs({
          environmentId: draft.environmentId,
          input: { cwd: project.workspaceRoot, refKind: "all", limit: 100 },
        })
      : null,
  );
  useEffect(() => {
    if (configuration.workspace.kind !== "worktree" || refs.data === null) return;
    const preferred = preferredWorktreeBaseBranch(refs.data.refs);
    if (!preferred || preferred === configuration.workspace.baseBranch) return;
    if (configuration.workspace.baseBranch !== "main") return;
    const next = { ...configuration, workspace: worktreeWorkspace(preferred) };
    onDraftChange({ ...draft, configuration: next });
    onBaselineChange(routineDraftBaselineAfterAutomaticChange(configuration, baseline, next));
  }, [baseline, configuration, draft, onBaselineChange, onDraftChange, refs.data]);
  const provider = selectableProviders.find(
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
  const hasCompleteTrigger = isRoutineEditorDraftComplete(configuration);
  const canSave =
    canSaveRoutineDraft({
      name: configuration.name,
      instruction: configuration.instruction,
      hasProject: project !== undefined,
      offline,
      busy,
      provider,
    }) &&
    hasCompleteTrigger &&
    (triggerKind === "schedule" || selectedConnection !== undefined);
  const isSaved = routine !== null;
  const historyRuns = [...(history.data?.runs ?? []), ...extraRuns];

  const submitSave = async () => {
    if (!canSave || !isRoutineEditorDraftComplete(configuration)) return;
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

  const requestClose = async () => {
    if (!isRoutineDraftDirty(configuration, baseline)) {
      onCancel();
      return;
    }
    const confirmation = requestConfirmDialog(DISCARD_UNSAVED_ROUTINE_MESSAGE);
    if (confirmDialogAccepted(await confirmation)) onCancel();
  };

  const applyChange = async (action: "pause" | "resume" | "delete") => {
    if (!routine || offline || busy) return;
    if (action === "delete") {
      const confirmation = requestConfirmDialog(DELETE_ROUTINE_MESSAGE, { variant: "destructive" });
      if (!confirmDialogAccepted(await confirmation)) return;
    }
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
        requestId: newRoutineRequestId(),
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
    <section
      className="min-w-0 overflow-x-clip border-t border-border/60 pt-5"
      aria-label="Routine editor"
    >
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
          {routine?.state !== "deleted" ? (
            <Button size="sm" onClick={submitSave} disabled={!canSave}>
              <SaveIcon className="size-3.5" /> {busy ? "Saving…" : "Save"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            title={ROUTINE_CANCEL_HINT}
            onClick={() => void requestClose()}
          >
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
      {routine?.state === "deleted" ? (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This routine is deleted. Conversations and run history stay available below. It will not
          start again on the schedule.
        </div>
      ) : null}

      <div className={ROUTINE_EDITOR_FIELDS_CLASS}>
        <div className={ROUTINE_EDITOR_COLUMN_CLASS}>
          {!isSaved && owners.length > 1 ? (
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="routine-environment">Environment</FieldLabel>
              <select
                id="routine-environment"
                className={ROUTINE_CONTROL_CLASS}
                value={draft.environmentId}
                onChange={(event) => onOwnerChange(event.target.value as EnvironmentId)}
              >
                {owners.map((owner) => (
                  <option key={owner.environmentId} value={owner.environmentId}>
                    {owner.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
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
              className={ROUTINE_CONTROL_CLASS}
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
                      ? worktreeWorkspace(
                          preferredWorktreeBaseBranch(refs.data?.refs ?? []) ?? "main",
                        )
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
              className={ROUTINE_CONTROL_CLASS}
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
              {selectableProviders.flatMap((candidate) =>
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
            {selectableProviders.length === 0 ? (
              <p className="text-xs text-warning-foreground">
                No enabled provider is available on this environment.
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

        <div className={ROUTINE_EDITOR_COLUMN_CLASS}>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-permission">Permission mode</FieldLabel>
            <select
              id="routine-permission"
              className={ROUTINE_CONTROL_CLASS}
              value={configuration.runtimeMode}
              onChange={(event) =>
                setConfiguration({ runtimeMode: event.target.value as RuntimeMode })
              }
            >
              {(Object.entries(ROUTINE_PERMISSION_MODE_LABELS) as [RuntimeMode, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="grid min-w-0 gap-2 rounded-xl border border-border/60 bg-muted/15 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CalendarClockIcon className="size-4 text-muted-foreground" /> When to run
            </div>
            <div
              className={ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS}
              role="group"
              aria-label="Trigger kind"
            >
              <Button
                size="sm"
                className="min-w-0 shrink"
                variant={triggerKind === "schedule" ? "default" : "outline"}
                aria-pressed={triggerKind === "schedule"}
                onClick={() => switchTriggerKind("schedule")}
              >
                <Clock3Icon className="size-3.5" /> Schedule
              </Button>
              <Button
                size="sm"
                className="min-w-0 shrink"
                variant={triggerKind === "github" ? "default" : "outline"}
                aria-pressed={triggerKind === "github"}
                onClick={() => switchTriggerKind("github")}
              >
                <WebhookIcon className="size-3.5" /> GitHub event
              </Button>
              <Button
                size="sm"
                className="min-w-0 shrink"
                variant={triggerKind === "linear" ? "default" : "outline"}
                aria-pressed={triggerKind === "linear"}
                onClick={() => switchTriggerKind("linear")}
              >
                <SquareKanbanIcon className="size-3.5" /> Linear event
              </Button>
            </div>
            {gitHubTrigger !== null ? (
              <GitHubTriggerSection
                environmentId={draft.environmentId}
                trigger={gitHubTrigger}
                connections={githubConnections}
                selectedConnection={selectedGitHubConnection}
                offline={offline}
                busy={busy}
                onTriggerChange={setGitHubTrigger}
                onConnectionChange={(connection) =>
                  setConfiguration({ trigger: defaultGitHubTrigger(connection) })
                }
              />
            ) : null}
            {linearTrigger !== null ? (
              <LinearTriggerSection
                environmentId={draft.environmentId}
                trigger={linearTrigger}
                connections={linearConnections}
                selectedConnection={selectedLinearConnection}
                offline={offline}
                busy={busy}
                onTriggerChange={setLinearTrigger}
                onConnectionChange={(connection) =>
                  setConfiguration({ trigger: defaultLinearTrigger(connection) })
                }
              />
            ) : null}
            {scheduleTrigger !== null ? (
              <ScheduleTriggerFields
                environmentId={draft.environmentId}
                trigger={scheduleTrigger}
                onTriggerChange={(next) => setConfiguration({ trigger: next })}
              />
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-workspace">Workspace</FieldLabel>
            <select
              id="routine-workspace"
              className={ROUTINE_CONTROL_CLASS}
              value={configuration.workspace.kind}
              onChange={(event) => {
                if (event.target.value === "worktree")
                  setConfiguration({
                    workspace: worktreeWorkspace(
                      preferredWorktreeBaseBranch(refs.data?.refs ?? []) ?? "main",
                    ),
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
                    workspace: worktreeWorkspace(value),
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
            {routine.state !== "deleted" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void applyChange("delete")}
                disabled={busy || offline}
              >
                <Trash2Icon className="size-3.5 text-destructive" /> Delete
              </Button>
            ) : null}
          </div>
          <Menu>
            <MenuTrigger
              render={<Button size="icon-sm" variant="ghost" aria-label="Routine actions" />}
            >
              <MoreHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => void requestClose()}>
                <Settings2Icon className="size-4" /> Close editor
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      ) : null}

      {isSaved ? (
        <div className="mt-6 border-t border-border/60 pt-4">
          <h3 className="text-sm font-semibold">Recent runs</h3>
          {historyRuns.length ? (
            <div className="mt-3 grid gap-2">
              {historyRuns.map((run) => (
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
                  {run.sourceUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      href={run.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <WebhookIcon className="size-3" />{" "}
                      {run.source === "linear" ? "Open in Linear" : "Open on GitHub"}
                    </a>
                  ) : null}
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
              {olderCursor ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setHistoryBefore(olderCursor)}
                  disabled={busy || historyBefore !== null}
                >
                  Load older runs
                </Button>
              ) : null}
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
