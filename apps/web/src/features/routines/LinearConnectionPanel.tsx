import {
  RoutineConnectionId,
  type EnvironmentId,
  type LinearRoutineConnection,
} from "@kata-sh/code-contracts";
import { PlusIcon, RotateCcwIcon, SquareKanbanIcon, Trash2Icon, WebhookIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { useEnvironmentQuery } from "../../state/query";
import { routineEnvironment } from "../../state/routines";
import { useAtomCommand } from "../../state/use-atom-command";
import { FieldLabel } from "./FieldLabel";
import {
  errorMessage,
  LINEAR_PROVIDER_REMOVAL_NOTE,
  LINEAR_RETRY_NOTE,
  routineConnectionStatusLabel,
  ROUTINE_CONTROL_CLASS,
  ROUTINE_DELIVERY_STATUS_LABELS,
} from "./RoutinesPage.logic";

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

/**
 * Workspace connection picker, OAuth authorization and webhook setup, and
 * connection diagnostics. `connection` is the effective connection resolved by
 * the caller, which may be `createdConnection` before the list refreshes.
 */
export function LinearConnectionPanel({
  environmentId,
  connections,
  connection,
  createdConnection,
  disabled,
  onCreatedConnectionChange,
  onSetupBusyChange,
  onConnectionChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly connections: readonly LinearRoutineConnection[];
  readonly connection: LinearRoutineConnection | undefined;
  readonly createdConnection: LinearRoutineConnection | null;
  readonly disabled: boolean;
  readonly onCreatedConnectionChange: (connection: LinearRoutineConnection | null) => void;
  readonly onSetupBusyChange: (busy: boolean) => void;
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
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [authorizationPopupBlocked, setAuthorizationPopupBlocked] = useState(false);
  const [authorizationMetadataGate, setAuthorizationMetadataGate] = useState<
    "ready" | "required" | "refreshing"
  >("ready");
  const authorizationRefreshSawPending = useRef(false);
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
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
    onSetupBusyChange(true);
    setSetupMessage(null);
    setAuthorizationUrl(null);
    setAuthorizationPopupBlocked(false);
    onCreatedConnectionChange(null);
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
      onSetupBusyChange(false);
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
      onSetupBusyChange(false);
      setSetupMessage(errorMessage(error));
      return;
    }
  };

  const runCreateConnection = async () => {
    if (disabled || pendingConnectionId === null || authorizationMetadataGate !== "ready") return;
    if (!allTeams && teamId.length === 0) return;
    onSetupBusyChange(true);
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
    onSetupBusyChange(false);
    if (result._tag === "Failure") {
      setSetupMessage(errorMessage(result.cause));
      return;
    }
    if (result.value.provider !== "linear") {
      setSetupMessage("The environment did not return a Linear connection.");
      return;
    }
    onCreatedConnectionChange(result.value);
    clearPendingLinearConnectionId(environmentId);
    setPendingAuthorization(null);
    onConnectionChange(result.value);
    setSetupMessage("Webhook created. Verify the first delivery when Linear sends one.");
  };

  const runVerify = async () => {
    if (!connection || disabled) return;
    onSetupBusyChange(true);
    setSetupMessage(null);
    const result = await verifyConnection({ environmentId, input: { id: connection.id } });
    onSetupBusyChange(false);
    if (result._tag === "Failure") {
      setSetupMessage(errorMessage(result.cause));
      return;
    }
    if (result.value.provider !== "linear") {
      setSetupMessage("The environment did not return a Linear connection.");
      return;
    }
    if (createdConnection?.id === result.value.id) onCreatedConnectionChange(result.value);
    setSetupMessage(
      result.value.status === "verified"
        ? "First delivery received. The connection is ready."
        : "No Linear delivery arrived yet. Create or update an issue in the connected workspace.",
    );
  };

  const runDisable = async () => {
    if (!connection || disabled) return;
    onSetupBusyChange(true);
    setSetupMessage(null);
    const result = await disableConnection({ environmentId, input: { id: connection.id } });
    onSetupBusyChange(false);
    if (result._tag === "Failure") {
      setSetupMessage(errorMessage(result.cause));
      return;
    }
    if (result.value.provider !== "linear") {
      setSetupMessage("The environment did not return a Linear connection.");
      return;
    }
    if (createdConnection?.id === result.value.id) onCreatedConnectionChange(result.value);
    setSetupMessage(
      result.value.webhookId === null
        ? "Linear connection disabled. The provider webhook was removed; retry cleanup if relay revocation is still pending."
        : LINEAR_PROVIDER_REMOVAL_NOTE,
    );
  };

  const lastDelivery = connection?.lastDelivery ?? null;

  return (
    <>
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
              onCreatedConnectionChange(null);
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
    </>
  );
}
