import type {
  EnvironmentId,
  GitHubRoutineConnection,
  LinearRoutineConnection,
} from "@kata-sh/code-contracts";
import { useEffect, useState } from "react";

import { routineEnvironment } from "../../state/routines";
import { useEnvironmentQuery } from "../../state/query";
import type {
  GitHubTriggerPatch,
  LinearTriggerPatch,
  RoutineEditorGitHubTrigger,
  RoutineEditorLinearTrigger,
} from "./RoutinesPage.logic";
import { GitHubConnectionPanel } from "./GitHubConnectionPanel";
import { LinearConnectionPanel } from "./LinearConnectionPanel";
import { GitHubTriggerFields, LinearTriggerFields } from "./RoutineTriggerFields";

/**
 * Owns what the connection panel and the trigger fields share: the setup-busy
 * flag that disables both while setup runs, and the repository metadata.
 */
export function GitHubTriggerSection({
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

/**
 * Owns what the connection panel and the trigger fields share: the setup-busy
 * flag, the connection metadata, and the one effective connection both read.
 */
export function LinearTriggerSection({
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
  const [setupBusy, setSetupBusy] = useState(false);
  const [createdConnection, setCreatedConnection] = useState<LinearRoutineConnection | null>(null);
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
  // A just-created connection shows before the connections query refreshes.
  const connection =
    createdConnection?.id === triggerConnectionId ? createdConnection : selectedConnection;
  return (
    <div className="grid gap-2" data-testid="routine-linear-trigger">
      <LinearConnectionPanel
        environmentId={environmentId}
        connections={connections}
        connection={connection}
        createdConnection={createdConnection}
        disabled={disabled}
        onCreatedConnectionChange={setCreatedConnection}
        onSetupBusyChange={setSetupBusy}
        onConnectionChange={onConnectionChange}
      />
      <LinearTriggerFields
        trigger={trigger}
        connection={connection}
        metadata={metadata.data}
        metadataError={metadata.error}
        disabled={disabled}
        onTriggerChange={onTriggerChange}
      />
    </div>
  );
}
