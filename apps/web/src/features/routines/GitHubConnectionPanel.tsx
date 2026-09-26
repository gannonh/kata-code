import {
  RoutineConnectionId,
  type EnvironmentId,
  type GitHubRoutineConnection,
} from "@kata-sh/code-contracts";
import { PlusIcon, RotateCcwIcon, Trash2Icon, WebhookIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { routineEnvironment } from "../../state/routines";
import { useAtomCommand } from "../../state/use-atom-command";
import { FieldLabel } from "./FieldLabel";
import {
  errorMessage,
  gitHubHookSettingsUrl,
  GITHUB_REDELIVERY_NOTE,
  ROUTINE_CONNECTION_STATUS_LABELS,
  ROUTINE_CONTROL_CLASS,
  ROUTINE_DELIVERY_STATUS_LABELS,
} from "./RoutinesPage.logic";

/** Repository connection picker, webhook setup, and connection diagnostics. */
export function GitHubConnectionPanel({
  environmentId,
  connections,
  selectedConnection,
  repositoryNames,
  disabled,
  setupBusy,
  onSetupBusyChange,
  onConnectionChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly connections: readonly GitHubRoutineConnection[];
  readonly selectedConnection: GitHubRoutineConnection | undefined;
  readonly repositoryNames: readonly string[];
  readonly disabled: boolean;
  readonly setupBusy: boolean;
  readonly onSetupBusyChange: (busy: boolean) => void;
  readonly onConnectionChange: (connection: GitHubRoutineConnection) => void;
}) {
  const createConnection = useAtomCommand(routineEnvironment.createConnection, {
    reportFailure: false,
  });
  const verifyConnection = useAtomCommand(routineEnvironment.verifyConnection, {
    reportFailure: false,
  });
  const disableConnection = useAtomCommand(routineEnvironment.disableConnection, {
    reportFailure: false,
  });
  const rotateSecret = useAtomCommand(routineEnvironment.rotateConnectionSecret, {
    reportFailure: false,
  });
  const [repository, setRepository] = useState("");
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(connections.length === 0);

  const runSetup = async () => {
    const name = repository.trim();
    if (!name || disabled) return;
    onSetupBusyChange(true);
    setSetupMessage("Creating the webhook through GitHub…");
    const id = RoutineConnectionId.make(`connection-${Date.now().toString(36)}`);
    const created = await createConnection({
      environmentId,
      input: { provider: "github", id, repository: name },
    });
    if (created._tag === "Failure") {
      onSetupBusyChange(false);
      setSetupMessage(errorMessage(created.cause));
      return;
    }
    if (created.value.provider !== "github") {
      onSetupBusyChange(false);
      setSetupMessage("The environment did not return a GitHub connection.");
      return;
    }
    onConnectionChange(created.value);
    setSetupMessage(`Webhook created. Waiting for GitHub to ping ${created.value.callbackUrl}…`);
    const verified = await verifyConnection({ environmentId, input: { id } });
    onSetupBusyChange(false);
    if (verified._tag === "Failure") {
      setSetupMessage(errorMessage(verified.cause));
      return;
    }
    setSetupMessage(
      verified.value.status === "verified"
        ? "GitHub ping received. The connection is ready."
        : "GitHub has not pinged the callback yet. Check the tunnel and the repository's webhook settings.",
    );
    setShowSetup(false);
  };

  const runConnectionAction = async (action: "verify" | "disable" | "rotate") => {
    if (!selectedConnection || disabled) return;
    onSetupBusyChange(true);
    setSetupMessage(null);
    const input = { environmentId, input: { id: selectedConnection.id } };
    const result =
      action === "verify"
        ? await verifyConnection(input)
        : action === "disable"
          ? await disableConnection(input)
          : await rotateSecret(input);
    onSetupBusyChange(false);
    setSetupMessage(
      result._tag === "Failure"
        ? errorMessage(result.cause)
        : action === "verify"
          ? result.value.status === "verified"
            ? "GitHub ping received."
            : "No GitHub ping arrived yet."
          : action === "disable"
            ? "Connection disabled. New deliveries are rejected."
            : "Signing secret rotated. The old secret no longer verifies.",
    );
  };

  const hookSettingsUrl = selectedConnection ? gitHubHookSettingsUrl(selectedConnection) : null;
  const lastDelivery = selectedConnection?.lastDelivery ?? null;

  return (
    <>
      <div className="grid gap-1.5">
        <FieldLabel htmlFor="routine-connection">Repository connection</FieldLabel>
        <select
          id="routine-connection"
          className={ROUTINE_CONTROL_CLASS}
          value={selectedConnection?.id ?? ""}
          disabled={disabled}
          onChange={(event) => {
            const next = connections.find((candidate) => candidate.id === event.target.value);
            if (next) onConnectionChange(next);
          }}
        >
          {connections.length === 0 ? <option value="">No connected repository</option> : null}
          {connections.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.repositoryName} · {ROUTINE_CONNECTION_STATUS_LABELS[candidate.status]}
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
          <PlusIcon className="size-3.5" /> Connect a repository
        </Button>
      </div>
      {showSetup ? (
        <div className="grid gap-2 rounded-lg border border-border/50 bg-background/60 p-3">
          <FieldLabel htmlFor="routine-repository">GitHub repository (owner/name)</FieldLabel>
          <Input
            id="routine-repository"
            list="routine-repository-options"
            value={repository}
            onValueChange={setRepository}
            placeholder="acme/widgets"
            disabled={disabled}
          />
          <datalist id="routine-repository-options">
            {repositoryNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            Kata creates the repository webhook with <code>gh api</code> and waits for GitHub's
            ping. You need admin access to the repository and a Kata Code Connect managed tunnel.
            The signing secret is generated on this environment and never shown.
          </p>
          <Button
            size="sm"
            className="justify-self-start"
            onClick={() => void runSetup()}
            disabled={disabled || repository.trim().length === 0}
          >
            <WebhookIcon className="size-3.5" /> {setupBusy ? "Working…" : "Create webhook"}
          </Button>
        </div>
      ) : null}
      {setupMessage ? (
        <p className="text-xs text-muted-foreground" role="status">
          {setupMessage}
        </p>
      ) : null}
      {selectedConnection ? (
        <div
          className="grid gap-1 rounded-lg border border-border/50 bg-background/60 p-3 text-xs"
          data-testid="routine-connection-diagnostics"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              <a
                className="text-primary hover:underline"
                href={selectedConnection.repositoryUrl}
                target="_blank"
                rel="noreferrer"
              >
                {selectedConnection.repositoryName}
              </a>
            </span>
            <Badge variant="outline" size="sm">
              {ROUTINE_CONNECTION_STATUS_LABELS[selectedConnection.status]}
            </Badge>
          </div>
          <span className="break-all text-muted-foreground">
            Callback: {selectedConnection.callbackUrl}
          </span>
          <span className="text-muted-foreground">
            Hook id: {selectedConnection.hookId ?? "none"} · Accepted{" "}
            {selectedConnection.acceptedCount} · Ignored {selectedConnection.ignoredCount} ·
            Rejected {selectedConnection.rejectedCount}
          </span>
          <span className="text-muted-foreground">
            Last delivery:{" "}
            {lastDelivery
              ? `${ROUTINE_DELIVERY_STATUS_LABELS[lastDelivery.status]} · ${lastDelivery.event} · ${new Date(lastDelivery.receivedAt).toLocaleString()}${lastDelivery.detail ? ` · ${lastDelivery.detail}` : ""}`
              : "none yet"}
          </span>
          <span className="text-muted-foreground">
            {GITHUB_REDELIVERY_NOTE}{" "}
            {hookSettingsUrl ? (
              <a
                className="text-primary hover:underline"
                href={hookSettingsUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open delivery history
              </a>
            ) : null}
          </span>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runConnectionAction("verify")}
              disabled={disabled || selectedConnection.status === "disabled"}
            >
              <RotateCcwIcon className="size-3.5" /> Check ping
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runConnectionAction("rotate")}
              disabled={disabled || selectedConnection.status === "disabled"}
            >
              Rotate secret
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runConnectionAction("disable")}
              disabled={disabled || selectedConnection.status === "disabled"}
            >
              <Trash2Icon className="size-3.5 text-destructive" /> Disable
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
