import { useAtomCommand } from "~/state/use-atom-command";
import { connectPairing as connectPairingCommand } from "~/connection/onboarding";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@kata-sh/code-client-runtime/state/runtime";
import { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/ui/button";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import {
  deleteSandboxDeployment,
  deleteSandboxProfile,
  fetchSandboxList,
  mintSandboxHandoff,
  pollSandboxOperation,
  type SandboxListResponse,
  upsertSandboxProfile,
} from "./api";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The sandbox request failed.";
}

function deploymentLabel(
  deployment: SandboxListResponse["deployments"][number]["deployment"],
): string {
  return deployment.state === "Deleted"
    ? deployment.deploymentId
    : deployment.intent.label || deployment.intent.deploymentId;
}

function deploymentId(
  deployment: SandboxListResponse["deployments"][number]["deployment"],
): string {
  return deployment.state === "Deleted" ? deployment.deploymentId : deployment.intent.deploymentId;
}

export function DeploymentSettings() {
  const connectPairing = useAtomCommand(connectPairingCommand, { reportFailure: false });
  const [data, setData] = useState<SandboxListResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [activeHandoffId, setActiveHandoffId] = useState<string | null>(null);
  const [activeDeleteId, setActiveDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setData(await fetchSandboxList());
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateProfile = useCallback(
    async (profile: SandboxListResponse["profiles"][number]["profile"], enabled: boolean) => {
      const operationId = `profile:${profile.profileId}`;
      setActiveOperation(operationId);
      setError(null);
      try {
        const accepted = await upsertSandboxProfile({
          profileId: profile.profileId,
          expectedRevision: profile.revision,
          name: profile.name,
          socketPath: profile.socketPath,
          image: { kind: "custom", digest: profile.imageDigest },
          enabled,
        });
        const receipt = await pollSandboxOperation(accepted.operationId);
        if (receipt.status === "Failed") {
          throw new Error(receipt.error ?? "The Docker profile could not be updated.");
        }
        await refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setActiveOperation(null);
      }
    },
    [refresh],
  );

  const retryProfile = useCallback(
    async (summary: Extract<SandboxListResponse["profiles"][number], { kind: "unavailable" }>) =>
      updateProfile(summary.profile, true),
    [updateProfile],
  );

  const attachDeployment = useCallback(
    async (id: string) => {
      setActiveHandoffId(id);
      setError(null);
      try {
        const handoff = await mintSandboxHandoff(id);
        const result = await connectPairing({ pairingUrl: handoff.pairingUrl });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) return;
          throw squashAtomCommandFailure(result);
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setActiveHandoffId(null);
      }
    },
    [connectPairing],
  );

  const removeProfile = useCallback(
    async (profileId: string, revision: number) => {
      setActiveDeleteId(`profile:${profileId}`);
      setError(null);
      try {
        const accepted = await deleteSandboxProfile(profileId, revision);
        const receipt = await pollSandboxOperation(accepted.operationId);
        if (receipt.status === "Failed") {
          throw new Error(receipt.error ?? "The sandbox profile could not be deleted.");
        }
        await refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setActiveDeleteId(null);
      }
    },
    [refresh],
  );

  const removeDeployment = useCallback(
    async (id: string, revision: number) => {
      setActiveDeleteId(`deployment:${id}`);
      setError(null);
      try {
        const accepted = await deleteSandboxDeployment(id, revision);
        const receipt = await pollSandboxOperation(accepted.operationId);
        if (receipt.status === "Failed") {
          throw new Error(receipt.error ?? "The sandbox deployment could not be deleted.");
        }
        await refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setActiveDeleteId(null);
      }
    },
    [refresh],
  );

  const disabled = activeOperation !== null || activeHandoffId !== null || activeDeleteId !== null;

  return (
    <SettingsSection title="Docker sandboxes" data-testid="kata-sandbox-settings">
      <SettingsRow
        title="Saved profiles"
        description="Profiles stay visible when Docker or the image is unavailable."
      >
        <div className="mt-3 space-y-2" data-testid="kata-sandbox-profiles">
          {isLoading && data === null ? (
            <p className="text-sm text-muted-foreground">Loading profiles...</p>
          ) : null}
          {data?.profiles.map((summary) => {
            const profile = summary.profile;
            const operationId = `profile:${profile.profileId}`;
            return (
              <div className="rounded-lg border border-border/70 px-3 py-2" key={profile.profileId}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{profile.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {summary.kind === "available"
                        ? "Available"
                        : `Unavailable: ${summary.reason}`}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {summary.kind === "unavailable" && profile.enabled ? (
                      <Button
                        disabled={disabled}
                        onClick={() => void retryProfile(summary)}
                        size="xs"
                        variant="outline"
                      >
                        {activeOperation === operationId ? "Retrying..." : "Retry validation"}
                      </Button>
                    ) : null}
                    <Button
                      disabled={disabled}
                      onClick={() => void updateProfile(profile, !profile.enabled)}
                      size="xs"
                      variant="ghost-muted"
                    >
                      {activeOperation === operationId
                        ? profile.enabled
                          ? "Disabling..."
                          : "Enabling..."
                        : profile.enabled
                          ? "Disable"
                          : "Enable"}
                    </Button>
                    <Button
                      disabled={disabled || profile.enabled}
                      onClick={() => void removeProfile(profile.profileId, profile.revision)}
                      size="xs"
                      variant="ghost-muted"
                    >
                      {activeDeleteId === operationId ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                  {profile.imageDigest}
                </p>
                {summary.kind === "unavailable" ? (
                  <p className="mt-1 text-xs text-destructive">{summary.diagnostic}</p>
                ) : null}
              </div>
            );
          })}
          {data?.profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Docker profiles configured.</p>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow
        title="Deployments"
        description="Attach a deployment through ordinary environment onboarding, or delete it from Docker."
      >
        <div className="mt-3 space-y-2" data-testid="kata-sandbox-deployments">
          {data?.deployments.map(({ deployment, observation }) => {
            const id = deploymentId(deployment);
            const source = deployment.state === "Deleted" ? undefined : deployment.intent.source;
            return (
              <div className="rounded-lg border border-border/70 px-3 py-2" key={id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{deploymentLabel(deployment)}</span>
                  <span className="text-xs text-muted-foreground">
                    {deployment.state} · {observation?.state ?? "Not observed"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {source ? `${source.repository} @ ${source.ref}` : id}
                </p>
                {observation?.state === "Unknown" ? (
                  <p className="mt-1 text-xs text-destructive">{observation.diagnostic}</p>
                ) : null}
                {deployment.state === "Identified" ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      disabled={disabled}
                      onClick={() => void attachDeployment(id)}
                      size="sm"
                      variant="outline"
                    >
                      {activeHandoffId === id ? "Attaching..." : "Attach environment"}
                    </Button>
                    <Button
                      disabled={disabled}
                      onClick={() => void removeDeployment(id, deployment.revision)}
                      size="sm"
                      variant="ghost-muted"
                    >
                      {activeDeleteId === `deployment:${id}` ? "Deleting..." : "Delete"}
                    </Button>
                  </div>
                ) : deployment.state === "Allocated" || deployment.state === "Requested" ? (
                  <Button
                    className="mt-2"
                    disabled={disabled}
                    onClick={() => void removeDeployment(id, deployment.revision)}
                    size="sm"
                    variant="ghost-muted"
                  >
                    {activeDeleteId === `deployment:${id}` ? "Deleting..." : "Delete"}
                  </Button>
                ) : null}
              </div>
            );
          })}
          {data?.deployments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sandbox deployments yet.</p>
          ) : null}
        </div>
      </SettingsRow>

      {error ? (
        <p
          className="rounded-lg border border-destructive/30 bg-destructive/6 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          disabled={isLoading || disabled}
          onClick={() => void refresh()}
          size="sm"
          variant="ghost-muted"
        >
          {isLoading ? "Refreshing..." : "Refresh sandboxes"}
        </Button>
      </div>
    </SettingsSection>
  );
}
