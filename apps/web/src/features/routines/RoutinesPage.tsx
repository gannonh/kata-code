import {
  GITHUB_ROUTINE_EVENT_LABELS,
  LINEAR_ROUTINE_EVENT_LABELS,
  ModelSelection,
  ProviderInstanceId,
  type ProviderOptionSelection,
  Routine,
  RoutineConnectionId,
  RoutineDraft,
  type RoutineId,
  isScheduleTrigger,
  type EnvironmentId,
  type GitHubEventTrigger,
  type GitHubRoutineConnection,
  type GitHubRoutineEvent,
  type LinearEventTrigger,
  type LinearRoutineConnection,
  type LinearRoutineEvent,
  type RoutineRun,
  type RuntimeMode,
  type ServerProvider,
  type ScheduleTrigger,
} from "@kata-sh/code-contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
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
  SquareKanbanIcon,
  Trash2Icon,
  WebhookIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { routineEnvironment } from "../../state/routines";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { vcsEnvironment } from "../../state/vcs";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../components/ui/menu";
import { SidebarInset } from "../../components/ui/sidebar";
import { WorkspacePageHeader } from "../../components/WorkspacePageHeader";
import { Badge } from "../../components/ui/badge";
import { Empty, EmptyHeader, EmptyTitle } from "../../components/ui/empty";
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
  firstEnabledProviderModel,
  formatRoutineTrigger,
  gitHubEditorTrigger,
  gitHubHookSettingsUrl,
  GITHUB_REDELIVERY_NOTE,
  isRoutineEditorDraftComplete,
  isRoutineEditorScheduleTrigger,
  isRoutineDraftDirty,
  keepDeletedRoutineInEditor,
  libraryRoutinesAfterChange,
  LINEAR_PROVIDER_REMOVAL_NOTE,
  LINEAR_RETRY_NOTE,
  linearEditorTrigger,
  newRoutineDraftId,
  newRoutineRequestId,
  preferredWorktreeBaseBranch,
  routineConnectionStatusLabel,
  routineDraftBaselineAfterAutomaticChange,
  routineDraftRevisionAfterEdit,
  ROUTINE_CANCEL_HINT,
  ROUTINE_CONNECTION_STATUS_LABELS,
  ROUTINE_CONTROL_CLASS,
  ROUTINE_DELIVERY_STATUS_LABELS,
  ROUTINE_EDITOR_COLUMN_CLASS,
  ROUTINE_EDITOR_FIELDS_CLASS,
  ROUTINE_PERMISSION_MODE_LABELS,
  ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS,
  routineTriggerKind,
  routinesLibraryEmptyKind,
  selectableConnections,
  switchRoutineEditorTrigger,
  worktreeWorkspace,
  type GitHubTriggerPatch,
  type RoutineEditorDraft,
  type RoutineEditorGitHubTrigger,
  type RoutineEditorLinearTrigger,
  type RoutineTriggerKind,
} from "./RoutinesPage.logic";
import { FieldLabel } from "./FieldLabel";
import { GitHubConnectionPanel } from "./GitHubConnectionPanel";
import { GitHubTriggerFields } from "./RoutineTriggerFields";
import { RoutineChat } from "./RoutineChat";

const decodeModelSelection = Schema.decodeUnknownSync(ModelSelection);

type RoutineWithOwner = Routine & {
  readonly ownerLabel: string;
  readonly connectionPhase: string;
};

type DraftState = {
  readonly id: RoutineId;
  readonly environmentId: EnvironmentId;
  readonly expectedRevision: number;
  readonly configuration: RoutineEditorDraft;
};

type EnvironmentRoutineLoad = {
  readonly status: "ready" | "unavailable" | "pending";
  readonly routines: readonly RoutineWithOwner[];
};

const EMPTY_ROUTINES: readonly RoutineWithOwner[] = [];

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

function defaultDraft(
  environmentId: EnvironmentId,
  projects: readonly ReturnType<typeof useProjects>[number][],
  providers: readonly ServerProvider[],
  baseBranch = "main",
): DraftState | null {
  const project = projects.find((candidate) => candidate.environmentId === environmentId);
  if (!project) return null;
  const workspace =
    project.repositoryIdentity !== null
      ? worktreeWorkspace(baseBranch)
      : { kind: "shared" as const, directory: project.workspaceRoot };
  return {
    id: newRoutineDraftId(),
    environmentId,
    expectedRevision: 0,
    configuration: {
      name: "",
      instruction: "",
      projectId: project.id,
      modelSelection:
        firstEnabledProviderModel(providers) ??
        decodeModelSelection({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
      runtimeMode: "approval-required",
      workspace,
      trigger: { kind: "daily", time: "09:00", timezone: "UTC" },
    },
  };
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

function RoutineEnvironmentRows({
  environmentId,
  ownerLabel,
  connectionPhase,
  onLoaded,
}: {
  readonly environmentId: EnvironmentId;
  readonly ownerLabel: string;
  readonly connectionPhase: string;
  readonly onLoaded: (environmentId: EnvironmentId, load: EnvironmentRoutineLoad) => void;
}) {
  const query = useEnvironmentQuery(routineEnvironment.list({ environmentId, input: {} }));
  useEffect(() => {
    if (query.data !== null) {
      onLoaded(environmentId, {
        status: "ready",
        routines: query.data.map((routine) => ({
          ...routine,
          environmentId,
          ownerLabel,
          connectionPhase,
        })),
      });
      return;
    }
    if (query.error !== null || (connectionPhase !== "connected" && !query.isPending)) {
      onLoaded(environmentId, { status: "unavailable", routines: EMPTY_ROUTINES });
      return;
    }
    onLoaded(environmentId, { status: "pending", routines: EMPTY_ROUTINES });
  }, [
    connectionPhase,
    environmentId,
    onLoaded,
    ownerLabel,
    query.data,
    query.error,
    query.isPending,
  ]);
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
          {routine.configuration.trigger.kind === "linear" ? (
            <SquareKanbanIcon className="size-4" />
          ) : isScheduleTrigger(routine.configuration.trigger) ? (
            <Clock3Icon className="size-4" />
          ) : (
            <WebhookIcon className="size-4" />
          )}
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
            {formatRoutineTrigger(routine.configuration.trigger)}
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

/** A key set to `undefined` clears that filter; an absent key leaves it alone. */
type LinearTriggerPatch = {
  readonly event?: LinearEventTrigger["event"];
  readonly teamId?: string | undefined;
  readonly projectId?: string | undefined;
  readonly stateId?: string | undefined;
  readonly labelId?: string | undefined;
};

function GitHubTriggerSection({
  environmentId,
  trigger,
  connections,
  selectedConnection,
  offline,
  busy,
  onTriggerChange,
  onConnectionChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: RoutineEditorGitHubTrigger;
  readonly connections: readonly GitHubRoutineConnection[];
  readonly selectedConnection: GitHubRoutineConnection | undefined;
  readonly offline: boolean;
  readonly busy: boolean;
  readonly onTriggerChange: (patch: GitHubTriggerPatch) => void;
  readonly onConnectionChange: (connection: GitHubRoutineConnection) => void;
}) {
  const [setupBusy, setSetupBusy] = useState(false);
  const metadata = useEnvironmentQuery(
    routineEnvironment.gitHubMetadata({
      environmentId,
      input: selectedConnection ? { repository: selectedConnection.repositoryName } : {},
    }),
  );
  const disabled = offline || busy || setupBusy;
  return (
    <div className="grid gap-2" data-testid="routine-github-trigger">
      <GitHubConnectionPanel
        environmentId={environmentId}
        connections={connections}
        selectedConnection={selectedConnection}
        repositoryNames={metadata.data?.repositories.map((entry) => entry.nameWithOwner) ?? []}
        disabled={disabled}
        setupBusy={setupBusy}
        onSetupBusyChange={setSetupBusy}
        onConnectionChange={onConnectionChange}
      />
      <GitHubTriggerFields
        trigger={trigger}
        defaultBranch={selectedConnection?.defaultBranch}
        branches={metadata.data?.repository?.branches ?? []}
        labels={metadata.data?.repository?.labels ?? []}
        disabled={disabled}
        onTriggerChange={onTriggerChange}
      />
    </div>
  );
}

/** The server names a missing OAuth bundle with this message; the UI shows it as waiting. */
const LINEAR_AUTHORIZATION_REQUIRED_MESSAGE = "Connect Linear before reading workspace metadata.";
const LINEAR_PENDING_CONNECTION_STORAGE_KEY = "kata-code:routines:linear-pending-connection:";

function linearPendingConnectionStorageKey(environmentId: EnvironmentId): string {
  return `${LINEAR_PENDING_CONNECTION_STORAGE_KEY}${environmentId}`;
}

function readPendingLinearConnectionId(environmentId: EnvironmentId): RoutineConnectionId | null {
  try {
    const value = window.localStorage.getItem(linearPendingConnectionStorageKey(environmentId));
    return value !== null && /^[A-Za-z0-9_-]{1,128}$/u.test(value)
      ? RoutineConnectionId.make(value)
      : null;
  } catch {
    return null;
  }
}

function savePendingLinearConnectionId(
  environmentId: EnvironmentId,
  id: RoutineConnectionId,
): void {
  try {
    window.localStorage.setItem(linearPendingConnectionStorageKey(environmentId), id);
  } catch {
    // The in-memory state still lets this authorization attempt complete when
    // browser storage is unavailable.
  }
}

function clearPendingLinearConnectionId(environmentId: EnvironmentId): void {
  try {
    window.localStorage.removeItem(linearPendingConnectionStorageKey(environmentId));
  } catch {
    // Storage may be disabled by the browser or shell.
  }
}

function LinearTriggerFields({
  environmentId,
  trigger,
  connections,
  selectedConnection,
  offline,
  busy,
  onTriggerChange,
  onConnectionChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly trigger: RoutineEditorLinearTrigger;
  readonly connections: readonly LinearRoutineConnection[];
  readonly selectedConnection: LinearRoutineConnection | undefined;
  readonly offline: boolean;
  readonly busy: boolean;
  readonly onTriggerChange: (patch: LinearTriggerPatch) => void;
  readonly onConnectionChange: (connection: LinearRoutineConnection) => void;
}) {
  const beginConnectionAuthorization = useAtomCommand(
    routineEnvironment.beginConnectionAuthorization,
    { reportFailure: false },
  );
  const createConnection = useAtomCommand(routineEnvironment.createConnection, {
    reportFailure: false,
  });
  const verifyConnection = useAtomCommand(routineEnvironment.verifyConnection, {
    reportFailure: false,
  });
  const disableConnection = useAtomCommand(routineEnvironment.disableConnection, {
    reportFailure: false,
  });
  const [pendingAuthorization, setPendingAuthorization] = useState<{
    readonly environmentId: EnvironmentId;
    readonly connectionId: RoutineConnectionId;
  } | null>(null);
  const [allTeams, setAllTeams] = useState(true);
  const [teamId, setTeamId] = useState("");
  const [createdConnection, setCreatedConnection] = useState<LinearRoutineConnection | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [authorizationPopupBlocked, setAuthorizationPopupBlocked] = useState(false);
  const [authorizationMetadataGate, setAuthorizationMetadataGate] = useState<
    "ready" | "required" | "refreshing"
  >("ready");
  const authorizationRefreshSawPending = useRef(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(connections.length === 0);
  const pendingConnectionId =
    pendingAuthorization?.environmentId === environmentId
      ? pendingAuthorization.connectionId
      : null;
  const connectionIdSignature = connections.map((connection) => connection.id).join("\u0000");
  useEffect(() => {
    const persistedId = readPendingLinearConnectionId(environmentId);
    if (persistedId === null) {
      setPendingAuthorization((current) => (current === null ? current : null));
      return;
    }
    if (connectionIdSignature.split("\u0000").includes(persistedId)) {
      clearPendingLinearConnectionId(environmentId);
      setPendingAuthorization((current) => (current === null ? current : null));
      return;
    }
    setPendingAuthorization((current) =>
      current?.environmentId === environmentId && current.connectionId === persistedId
        ? current
        : { environmentId, connectionId: persistedId },
    );
  }, [connectionIdSignature, environmentId]);
  const authorizationMetadata = useEnvironmentQuery(
    pendingConnectionId === null
      ? null
      : routineEnvironment.linearMetadata({
          environmentId,
          input: { connectionId: pendingConnectionId },
        }),
  );
  useEffect(() => {
    if (authorizationMetadataGate !== "refreshing") return;
    if (authorizationMetadata.isPending) {
      authorizationRefreshSawPending.current = true;
      return;
    }
    if (!authorizationRefreshSawPending.current) return;
    authorizationRefreshSawPending.current = false;
    setAuthorizationMetadataGate(authorizationMetadata.isSuccess ? "ready" : "required");
  }, [authorizationMetadata.isPending, authorizationMetadata.isSuccess, authorizationMetadataGate]);
  const metadata = useEnvironmentQuery(
    selectedConnection
      ? routineEnvironment.linearMetadata({
          environmentId,
          input: { connectionId: selectedConnection.id },
        })
      : null,
  );
  const disabled = offline || busy || setupBusy;
  const triggerConnectionId = trigger.connectionId ?? null;
  useEffect(() => {
    if (createdConnection !== null && createdConnection.id !== triggerConnectionId) {
      setCreatedConnection(null);
    }
  }, [createdConnection, triggerConnectionId]);
  const connection =
    createdConnection?.id === triggerConnectionId ? createdConnection : selectedConnection;
  const stateId = "stateId" in trigger ? trigger.stateId : undefined;
  const labelId = "labelId" in trigger ? trigger.labelId : undefined;
  const connectionTeamIds = connection?.teamIds ?? [];
  const connectionTeams = (metadata.data?.teams ?? []).filter((team) =>
    connection?.allTeams ? team.visibility === "public" : connectionTeamIds.includes(team.id),
  );
  const authorizedTeamIds = new Set(connectionTeams.map((team) => team.id));
  const availableProjects = (metadata.data?.projects ?? []).filter(
    (project) =>
      project.teamIds.some((id) => authorizedTeamIds.has(id)) &&
      (trigger.teamId === undefined || project.teamIds.includes(trigger.teamId)),
  );
  const selectedProject = availableProjects.find((project) => project.id === trigger.projectId);
  const selectedProjectTeamIds = new Set(selectedProject?.teamIds ?? []);
  const matchesSelectedScope = (candidateTeamId: string): boolean =>
    trigger.teamId !== undefined
      ? candidateTeamId === trigger.teamId
      : selectedProject === undefined || selectedProjectTeamIds.has(candidateTeamId);
  const availableStates = (metadata.data?.states ?? []).filter(
    (state) => authorizedTeamIds.has(state.teamId) && matchesSelectedScope(state.teamId),
  );
  const availableLabels = (metadata.data?.labels ?? []).filter(
    (label) =>
      label.teamId === null ||
      (authorizedTeamIds.has(label.teamId) && matchesSelectedScope(label.teamId)),
  );

  const startAuthorization = async () => {
    if (disabled) return;
    let authorizationWindow: Window | null = null;
    try {
      authorizationWindow = window.open("about:blank", "_blank");
      if (authorizationWindow != null) authorizationWindow.opener = null;
    } catch {
      authorizationWindow?.close();
      authorizationWindow = null;
      // Treat a shell or browser that refuses the popup as a blocked popup and
      // keep the authorization URL available in the editor below.
    }
    setSetupBusy(true);
    setSetupMessage(null);
    setAuthorizationUrl(null);
    setAuthorizationPopupBlocked(false);
    setCreatedConnection(null);
    setAllTeams(true);
    setTeamId("");
    const storedId = readPendingLinearConnectionId(environmentId);
    const reusableId = [storedId, pendingConnectionId].find(
      (candidate) =>
        candidate !== null && !connections.some((connection) => connection.id === candidate),
    );
    const id = reusableId ?? RoutineConnectionId.make("connection-" + Date.now().toString(36));
    authorizationRefreshSawPending.current = false;
    setAuthorizationMetadataGate(reusableId === undefined ? "ready" : "required");
    savePendingLinearConnectionId(environmentId, id);
    setPendingAuthorization({ environmentId, connectionId: id });
    try {
      const result = await beginConnectionAuthorization({ environmentId, input: { id } });
      setSetupBusy(false);
      if (result._tag === "Failure") {
        authorizationWindow?.close();
        setSetupMessage(errorMessage(result.cause));
        return;
      }
      setAuthorizationUrl(result.value.authorizeUrl);
      let popupAvailable = authorizationWindow != null && !authorizationWindow.closed;
      if (popupAvailable && authorizationWindow != null) {
        try {
          authorizationWindow.location.href = result.value.authorizeUrl;
        } catch {
          authorizationWindow.close();
          popupAvailable = false;
        }
      }
      setAuthorizationPopupBlocked(!popupAvailable);
      setPendingAuthorization({ environmentId, connectionId: id });
      setSetupMessage(
        popupAvailable
          ? "Authorize Kata Code in the Linear window, then check the connection."
          : "The Linear authorization window was blocked. Open the authorization link below, then check the connection.",
      );
    } catch (error) {
      authorizationWindow?.close();
      setSetupBusy(false);
      setSetupMessage(errorMessage(error));
      return;
    }
  };

  const runCreateConnection = async () => {
    if (disabled || pendingConnectionId === null || authorizationMetadataGate !== "ready") return;
    if (!allTeams && teamId.length === 0) return;
    setSetupBusy(true);
    setSetupMessage("Creating the Linear webhook…");
    const result = await createConnection({
      environmentId,
      input: {
        provider: "linear",
        id: pendingConnectionId,
        allTeams,
        teamIds: allTeams ? [] : [teamId],
      },
    });
    setSetupBusy(false);
    if (result._tag === "Failure") {
      setSetupMessage(errorMessage(result.cause));
      return;
    }
    if (result.value.provider !== "linear") {
      setSetupMessage("The environment did not return a Linear connection.");
      return;
    }
    setCreatedConnection(result.value);
    clearPendingLinearConnectionId(environmentId);
    setPendingAuthorization(null);
    onConnectionChange(result.value);
    setSetupMessage("Webhook created. Verify the first delivery when Linear sends one.");
  };

  const runVerify = async () => {
    if (!connection || disabled) return;
    setSetupBusy(true);
    setSetupMessage(null);
    const result = await verifyConnection({ environmentId, input: { id: connection.id } });
    setSetupBusy(false);
    if (result._tag === "Failure") {
      setSetupMessage(errorMessage(result.cause));
      return;
    }
    if (result.value.provider !== "linear") {
      setSetupMessage("The environment did not return a Linear connection.");
      return;
    }
    if (createdConnection?.id === result.value.id) setCreatedConnection(result.value);
    setSetupMessage(
      result.value.status === "verified"
        ? "First delivery received. The connection is ready."
        : "No Linear delivery arrived yet. Create or update an issue in the connected workspace.",
    );
  };

  const runDisable = async () => {
    if (!connection || disabled) return;
    setSetupBusy(true);
    setSetupMessage(null);
    const result = await disableConnection({ environmentId, input: { id: connection.id } });
    setSetupBusy(false);
    if (result._tag === "Failure") {
      setSetupMessage(errorMessage(result.cause));
      return;
    }
    if (result.value.provider !== "linear") {
      setSetupMessage("The environment did not return a Linear connection.");
      return;
    }
    if (createdConnection?.id === result.value.id) setCreatedConnection(result.value);
    setSetupMessage(
      result.value.webhookId === null
        ? "Linear connection disabled. The provider webhook was removed; retry cleanup if relay revocation is still pending."
        : LINEAR_PROVIDER_REMOVAL_NOTE,
    );
  };

  const lastDelivery = connection?.lastDelivery ?? null;

  return (
    <div className="grid gap-2" data-testid="routine-linear-trigger">
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="routine-linear-connection">Workspace connection</FieldLabel>
        <select
          id="routine-linear-connection"
          className={ROUTINE_CONTROL_CLASS}
          value={connection?.id ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const next = connections.find((candidate) => candidate.id === event.target.value);
            if (next) {
              setCreatedConnection(null);
              onConnectionChange(next);
            }
          }}
        >
          {connections.length === 0 ? <option value="">No connected workspace</option> : null}
          {connections.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.workspaceName} · {routineConnectionStatusLabel(candidate)}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          onClick={() => setShowSetup((value) => !value)}
          disabled={disabled}
        >
          <PlusIcon className="size-3.5" /> Connect a workspace
        </Button>
      </div>
      {showSetup ? (
        <div className="grid gap-2 rounded-lg border border-border/50 bg-background/60 p-3">
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => void startAuthorization()}
            disabled={disabled}
          >
            <SquareKanbanIcon className="size-3.5" /> Connect Linear
          </Button>
          {pendingConnectionId !== null &&
          (authorizationMetadata.data === null || authorizationMetadataGate !== "ready") ? (
            <>
              {authorizationMetadata.error !== null &&
              authorizationMetadata.error !== LINEAR_AUTHORIZATION_REQUIRED_MESSAGE ? (
                <p className="text-xs text-destructive" role="status">
                  {authorizationMetadata.error}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground" role="status">
                  Waiting for authorization…
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => {
                  if (authorizationMetadataGate === "required") {
                    authorizationRefreshSawPending.current = false;
                    setAuthorizationMetadataGate("refreshing");
                  }
                  authorizationMetadata.refresh();
                }}
                disabled={disabled}
              >
                Check authorization
              </Button>
            </>
          ) : null}
          {authorizationMetadata.data !== null &&
          authorizationMetadataGate === "ready" &&
          createdConnection === null ? (
            <div className="grid gap-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {authorizationMetadata.data.workspace.name}
              </span>
              <label className="flex items-center gap-2">
                <input
                  id="routine-linear-all-teams"
                  type="checkbox"
                  checked={allTeams}
                  disabled={disabled}
                  onChange={(event) => setAllTeams(event.target.checked)}
                />
                All public teams
              </label>
              {allTeams ? null : (
                <select
                  id="routine-linear-team-scope"
                  className={ROUTINE_CONTROL_CLASS}
                  value={teamId}
                  disabled={disabled}
                  onChange={(event) => setTeamId(event.target.value)}
                >
                  <option value="">Choose a team</option>
                  {authorizationMetadata.data.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              )}
              <Button
                size="sm"
                className="justify-self-start"
                onClick={() => void runCreateConnection()}
                disabled={disabled || (!allTeams && teamId.length === 0)}
              >
                <WebhookIcon className="size-3.5" /> Create webhook
              </Button>
            </div>
          ) : null}
          {connection ? (
            <div className="grid gap-1.5 text-xs text-muted-foreground">
              <span className="break-all">Callback: {connection.callbackUrl}</span>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runVerify()}
                  disabled={disabled || connection.status === "disabled"}
                >
                  <RotateCcwIcon className="size-3.5" /> Verify
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void runDisable()}
                  disabled={disabled}
                >
                  <Trash2Icon className="size-3.5 text-destructive" />
                  {connection.status === "disabled" ? "Retry cleanup" : "Disable"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {setupMessage ? (
        <p className="text-xs text-muted-foreground" role="status">
          {setupMessage}
        </p>
      ) : null}
      {authorizationPopupBlocked && authorizationUrl ? (
        <a
          className="text-xs text-primary hover:underline"
          href={authorizationUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open Linear authorization link
        </a>
      ) : null}
      {connection ? (
        <div
          className="grid gap-1 rounded-lg border border-border/50 bg-background/60 p-3 text-xs"
          data-testid="routine-linear-connection-diagnostics"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{connection.workspaceName}</span>
            <Badge variant="outline" size="sm">
              {routineConnectionStatusLabel(connection)}
            </Badge>
          </div>
          <span className="break-all text-muted-foreground">
            Callback: {connection.callbackUrl}
          </span>
          {connection.webhookId !== null ? (
            <span className="break-all text-muted-foreground">Webhook: {connection.webhookId}</span>
          ) : null}
          <span className="text-muted-foreground">
            Accepted {connection.acceptedCount} · Ignored {connection.ignoredCount} · Rejected{" "}
            {connection.rejectedCount}
          </span>
          <span className="text-muted-foreground">
            Last delivery:{" "}
            {lastDelivery
              ? `${ROUTINE_DELIVERY_STATUS_LABELS[lastDelivery.status]} · ${lastDelivery.event} · ${new Date(lastDelivery.receivedAt).toLocaleString()}${lastDelivery.detail ? ` · ${lastDelivery.detail}` : ""}`
              : "none yet"}
          </span>
          <span className="text-muted-foreground">{LINEAR_RETRY_NOTE}</span>
          {connection.status === "disabled" && connection.webhookId !== null ? (
            <span className="text-muted-foreground">{LINEAR_PROVIDER_REMOVAL_NOTE}</span>
          ) : null}
          {connection.metadataAccess === "revoked" ? (
            <span className="text-destructive">
              Metadata access revoked. Disable this connection and connect Linear again to restore
              the team, project, status, and label pickers.
            </span>
          ) : null}
        </div>
      ) : null}
      {metadata.error !== null ? (
        <p className="text-xs text-destructive">{metadata.error}</p>
      ) : (
        <>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-linear-event">Event</FieldLabel>
            <select
              id="routine-linear-event"
              className={ROUTINE_CONTROL_CLASS}
              value={trigger.event}
              disabled={disabled}
              onChange={(event) =>
                onTriggerChange({ event: event.target.value as LinearRoutineEvent })
              }
            >
              {(Object.entries(LINEAR_ROUTINE_EVENT_LABELS) as [LinearRoutineEvent, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-linear-team">Team</FieldLabel>
            <select
              id="routine-linear-team"
              className={ROUTINE_CONTROL_CLASS}
              value={trigger.teamId ?? ""}
              disabled={disabled}
              onChange={(event) => {
                const value = event.target.value;
                onTriggerChange({
                  teamId: value === "" ? undefined : value,
                  projectId: undefined,
                  stateId: undefined,
                  labelId: undefined,
                });
              }}
            >
              <option value="">All teams in this connection</option>
              {connectionTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <FieldLabel htmlFor="routine-linear-project">Project</FieldLabel>
            <select
              id="routine-linear-project"
              className={ROUTINE_CONTROL_CLASS}
              value={trigger.projectId ?? ""}
              disabled={disabled}
              onChange={(event) =>
                onTriggerChange({
                  projectId: event.target.value === "" ? undefined : event.target.value,
                  stateId: undefined,
                  labelId: undefined,
                })
              }
            >
              <option value="">All projects</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
          {trigger.event === "status_changed" ? (
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="routine-linear-state">Status</FieldLabel>
              <select
                id="routine-linear-state"
                className={ROUTINE_CONTROL_CLASS}
                value={stateId ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onTriggerChange({
                    stateId: event.target.value === "" ? undefined : event.target.value,
                  })
                }
              >
                <option value="">Choose a status</option>
                {availableStates.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
              {stateId === undefined ? (
                <p className="text-xs text-warning-foreground">
                  Choose the status transition that should start the routine.
                </p>
              ) : null}
            </div>
          ) : null}
          {trigger.event === "label_added" ? (
            <div className="grid gap-1.5">
              <FieldLabel htmlFor="routine-linear-label">Label</FieldLabel>
              <select
                id="routine-linear-label"
                className={ROUTINE_CONTROL_CLASS}
                value={labelId ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  onTriggerChange({
                    labelId: event.target.value === "" ? undefined : event.target.value,
                  })
                }
              >
                <option value="">Choose a label</option>
                {availableLabels.map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.name}
                  </option>
                ))}
              </select>
              {labelId === undefined ? (
                <p className="text-xs text-warning-foreground">
                  Choose the label whose addition should start the routine.
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Filters use Linear&apos;s stable ids, so renamed teams, projects, statuses, and labels
            keep matching. Event text is passed to the routine as untrusted context under the saved
            instruction.
          </p>
        </>
      )}
    </div>
  );
}

function RoutineEditor({
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
  const preview = useEnvironmentQuery(
    isRoutineEditorScheduleTrigger(draft.configuration.trigger)
      ? routineEnvironment.preview({
          environmentId: draft.environmentId,
          input: { trigger: draft.configuration.trigger },
        })
      : null,
  );
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
  const setTrigger = (patch: Partial<ScheduleTrigger>) => {
    if (!isRoutineEditorScheduleTrigger(configuration.trigger)) return;
    setConfiguration({ trigger: { ...configuration.trigger, ...patch } as ScheduleTrigger });
  };
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
              <LinearTriggerFields
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
              <>
                <div className={ROUTINE_WHEN_TO_RUN_ACTIONS_CLASS}>
                  {(["daily", "weekdays", "weekly", "cron"] as const).map((kind) => (
                    <Button
                      key={kind}
                      size="sm"
                      className="min-w-0 shrink"
                      variant={scheduleTrigger.kind === kind ? "default" : "outline"}
                      onClick={() => {
                        if (kind === "cron")
                          setConfiguration({
                            trigger: { kind, expression: "0 9 * * 1-5", timezone: "UTC" },
                          });
                        else if (kind === "weekly")
                          setConfiguration({
                            trigger: { kind, weekday: 1, time: "09:00", timezone: "UTC" },
                          });
                        else
                          setConfiguration({ trigger: { kind, time: "09:00", timezone: "UTC" } });
                      }}
                    >
                      {kind[0]!.toUpperCase() + kind.slice(1)}
                    </Button>
                  ))}
                </div>
                {scheduleTrigger.kind === "cron" ? (
                  <Input
                    aria-label="Cron expression"
                    value={scheduleTrigger.expression}
                    onValueChange={(value) => setTrigger({ expression: value })}
                    placeholder="0 9 * * 1-5"
                  />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      aria-label="Schedule time"
                      type="time"
                      value={scheduleTrigger.time}
                      onValueChange={(value) => setTrigger({ time: value })}
                    />
                    {scheduleTrigger.kind === "weekly" ? (
                      <select
                        aria-label="Weekday"
                        className={ROUTINE_CONTROL_CLASS}
                        value={String(scheduleTrigger.weekday)}
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
                  value={scheduleTrigger.timezone}
                  onValueChange={(value) => setTrigger({ timezone: value })}
                  placeholder="America/Los_Angeles"
                />
                {preview.data ? (
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    <span>Next runs</span>
                    {preview.data.dates.map((date) => (
                      <span key={date}>{formatDateInTimezone(date, scheduleTrigger.timezone)}</span>
                    ))}
                  </div>
                ) : preview.error ? (
                  <p className="text-xs text-destructive">{preview.error}</p>
                ) : null}
              </>
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

export function RoutinesPage() {
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const [routinesByEnvironment, setRoutinesByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, EnvironmentRoutineLoad>
  >(new Map());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [editing, setEditing] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editorRoutine, setEditorRoutine] = useState<RoutineWithOwner | null>(null);
  const [baseline, setBaseline] = useState<RoutineEditorDraft | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRevision, setChatRevision] = useState(0);
  const [generationModelSelection, setGenerationModelSelection] = useState<ModelSelection | null>(
    null,
  );
  const newRoutineTriggerRef = useRef<HTMLButtonElement | null>(null);
  const allRoutines = useMemo(
    () => Array.from(routinesByEnvironment.values()).flatMap((load) => load.routines),
    [routinesByEnvironment],
  );
  const libraryEmptyKind = routinesLibraryEmptyKind({
    routineCount: allRoutines.length,
    unavailableCount: Array.from(routinesByEnvironment.values()).filter(
      (load) => load.status === "unavailable",
    ).length,
    pendingCount: Array.from(routinesByEnvironment.values()).filter(
      (load) => load.status === "pending",
    ).length,
  });
  const selectedRoutine =
    allRoutines.find((routine) => `${routine.environmentId}:${routine.id}` === selectedKey) ??
    (editorRoutine !== null && `${editorRoutine.environmentId}:${editorRoutine.id}` === selectedKey
      ? editorRoutine
      : null);
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
  const connectedOwners = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      projects.some((project) => project.environmentId === environment.environmentId),
  );
  const saveDraftEnvironment =
    draft?.environmentId ??
    (connectedOwners.some((owner) => owner.environmentId === selectedRoutine?.environmentId)
      ? selectedRoutine?.environmentId
      : null) ??
    (connectedOwners.some((owner) => owner.environmentId === primaryEnvironmentId)
      ? primaryEnvironmentId
      : null) ??
    connectedOwners[0]?.environmentId ??
    null;

  const onLoaded = useCallback((environmentId: EnvironmentId, load: EnvironmentRoutineLoad) => {
    setRoutinesByEnvironment((previous) => new Map(previous).set(environmentId, load));
  }, []);

  const startNew = (mode: "manual" | "chat" = "manual") => {
    if (connectedOwners.length === 0) {
      setCreateError("Import a project on a connected environment before creating a routine.");
      setShowMenu(false);
      setEditing(false);
      setDraft(null);
      setEditorRoutine(null);
      setBaseline(null);
      setChatOpen(false);
      setGenerationModelSelection(null);
      setChatRevision(0);
      return;
    }
    setCreateError(null);
    setShowMenu(false);
    setSelectedKey(null);
    setDraft(null);
    setEditorRoutine(null);
    setBaseline(null);
    setChatOpen(mode === "chat");
    setGenerationModelSelection(null);
    setChatRevision(0);
    setEditing(true);
  };

  useEffect(() => {
    if (!editing || draft !== null || saveDraftEnvironment === null) return;
    const environmentId = saveDraftEnvironment;
    const environmentProjects = projects.filter(
      (project) => project.environmentId === environmentId,
    );
    const providers = selectedProviders ?? [];
    const next = defaultDraft(environmentId, environmentProjects, providers);
    if (next) {
      setCreateError(null);
      setDraft(next);
      setBaseline(next.configuration);
      setChatRevision(0);
      if (chatOpen && generationModelSelection === null) {
        setGenerationModelSelection(firstEnabledProviderModel(providers));
      }
      return;
    }
    setEditing(false);
    setCreateError("Import a project on a connected environment before creating a routine.");
  }, [
    chatOpen,
    draft,
    editing,
    generationModelSelection,
    projects,
    saveDraftEnvironment,
    selectedProviders,
  ]);

  useEffect(() => {
    if (!chatOpen || generationModelSelection !== null) return;
    const firstModel = firstEnabledProviderModel(selectedProviders ?? []);
    if (firstModel !== null) setGenerationModelSelection(firstModel);
  }, [chatOpen, generationModelSelection, selectedProviders]);

  const changeOwner = (environmentId: EnvironmentId) => {
    if (!draft) return;
    if (environmentId === draft.environmentId) return;
    setChatRevision((revision) => revision + 1);
    setDraft({ ...draft, environmentId });
  };

  useEffect(() => {
    if (!editing || draft === null || selectedRoutine !== null) return;
    const environmentProjects = projects.filter(
      (project) => project.environmentId === draft.environmentId,
    );
    const projectOk = environmentProjects.some(
      (project) => project.id === draft.configuration.projectId,
    );
    const providerOk = enabledProviders(selectedProviders ?? []).some(
      (candidate) => candidate.instanceId === draft.configuration.modelSelection.instanceId,
    );
    if (projectOk && (providerOk || enabledProviders(selectedProviders ?? []).length === 0)) return;
    const next = defaultDraft(draft.environmentId, environmentProjects, selectedProviders ?? []);
    if (!next) return;
    const nextConfiguration = {
      ...next.configuration,
      name: draft.configuration.name,
      instruction: draft.configuration.instruction,
    };
    setChatRevision((revision) =>
      routineDraftRevisionAfterEdit(draft.configuration, nextConfiguration, revision),
    );
    setDraft({
      ...next,
      id: draft.id,
      configuration: nextConfiguration,
    });
    if (baseline) {
      setBaseline(
        routineDraftBaselineAfterAutomaticChange(draft.configuration, baseline, nextConfiguration),
      );
    }
  }, [baseline, draft, editing, projects, selectedProviders, selectedRoutine]);

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
    setEditorRoutine(routine);
    setBaseline(routine.configuration);
    setChatOpen(false);
    setGenerationModelSelection(null);
    setChatRevision(0);
  };

  const cancelEditing = () => {
    setEditing(false);
    setDraft(null);
    setSelectedKey(null);
    setCreateError(null);
    setEditorRoutine(null);
    setBaseline(null);
    setChatOpen(false);
    setGenerationModelSelection(null);
    setChatRevision(0);
    queueMicrotask(() => newRoutineTriggerRef.current?.focus());
  };

  const updateDraft = (next: DraftState) => {
    if (draft !== null) {
      setChatRevision((revision) =>
        routineDraftRevisionAfterEdit(draft.configuration, next.configuration, revision),
      );
    }
    setDraft(next);
  };

  const updateDraftConfiguration = (configuration: RoutineEditorDraft) => {
    if (draft === null) return;
    updateDraft({ ...draft, configuration });
  };

  const ownerOffline = selectedEnvironment?.connection.phase !== "connected";
  const updateSavedRoutine = (routine: Routine) => {
    setDraft({
      id: routine.id,
      environmentId: routine.environmentId,
      expectedRevision: routine.revision,
      configuration: routine.configuration,
    });
    setBaseline(routine.configuration);
    setChatRevision(0);
    setSelectedKey(`${routine.environmentId}:${routine.id}`);
    setEditing(routine.state !== "deleted" || keepDeletedRoutineInEditor(routine.state));
    setRoutinesByEnvironment((previous) => {
      const next = new Map(previous);
      const existing = next.get(routine.environmentId);
      const currentRoutines = existing?.routines ?? [];
      const owner =
        currentRoutines.find((entry) => entry.id === routine.id) ??
        (editorRoutine?.id === routine.id ? editorRoutine : undefined);
      const replacement: RoutineWithOwner = {
        ...routine,
        ownerLabel: owner?.ownerLabel ?? "Environment",
        connectionPhase: owner?.connectionPhase ?? "connected",
      };
      next.set(routine.environmentId, {
        status: existing?.status ?? "ready",
        routines: libraryRoutinesAfterChange(currentRoutines, replacement),
      });
      return next;
    });
    setEditorRoutine((previous) => ({
      ...routine,
      ownerLabel: previous?.id === routine.id ? previous.ownerLabel : "Environment",
      connectionPhase: previous?.id === routine.id ? previous.connectionPhase : "connected",
    }));
  };

  if (!isReady)
    return (
      <SidebarInset className="min-h-0">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Loading routines…</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );

  return (
    <SidebarInset className="min-h-0 overflow-auto">
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
              <MenuItem onClick={() => startNew("manual")}>
                <Settings2Icon className="size-4 text-muted-foreground" /> Set up manually
              </MenuItem>
              <MenuItem onClick={() => startNew("chat")}>
                <CalendarClockIcon className="size-4 text-muted-foreground" /> Create in chat
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
        {createError ? (
          <div className="mt-4 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning-foreground">
            {createError}
          </div>
        ) : null}
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
          {libraryEmptyKind === "pending" ? (
            <div className="col-span-full rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
              <p className="text-sm font-medium">Loading routines…</p>
            </div>
          ) : libraryEmptyKind === "unavailable" ? (
            <div className="col-span-full rounded-xl border border-dashed border-border/70 px-6 py-12 text-center">
              <CalendarClockIcon className="mx-auto size-8 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Environments unavailable</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Saved routines stay on their owning machine and will appear when it reconnects.
              </p>
            </div>
          ) : libraryEmptyKind === "empty" ? (
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
          <>
            {chatOpen ? (
              <RoutineChat
                key={draft.id}
                draft={draft}
                draftRevision={chatRevision}
                providers={selectedProviders ?? []}
                generationModelSelection={generationModelSelection}
                onGenerationModelChange={setGenerationModelSelection}
                onDraftChange={updateDraftConfiguration}
                onCancel={cancelEditing}
              />
            ) : null}
            <RoutineEditor
              draft={draft}
              routine={selectedRoutine}
              projects={projects.filter((project) => project.environmentId === draft.environmentId)}
              providers={selectedProviders ?? []}
              owners={connectedOwners.map((owner) => ({
                environmentId: owner.environmentId,
                label: owner.label,
              }))}
              offline={ownerOffline === true}
              baseline={baseline ?? draft.configuration}
              onDraftChange={updateDraft}
              onBaselineChange={setBaseline}
              onOwnerChange={changeOwner}
              onSaved={updateSavedRoutine}
              onCancel={cancelEditing}
            />
          </>
        ) : null}
      </main>
    </SidebarInset>
  );
}
