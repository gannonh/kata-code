import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@kata-sh/code-client-runtime/state/runtime";
import { useAtomCommand } from "~/state/use-atom-command";
import { connectPairing as connectPairingCommand } from "~/connection/onboarding";
import { primaryServerProvidersAtom } from "~/state/server";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import {
  createSandboxDeployment,
  deleteSandboxDeployment,
  deleteSandboxProfile,
  fetchSandboxList,
  mintSandboxHandoff,
  pollSandboxOperation,
  type SandboxDeploymentForm,
  type SandboxListResponse,
  type SandboxProfileForm,
  upsertSandboxProfile,
} from "./api";

const DEFAULT_SOCKET_PATH = "/var/run/docker.sock";

type OperationState = {
  readonly operationId: string;
  readonly status: string;
  readonly error?: string;
};

type ProfileFormState = SandboxProfileForm;

type DeploymentFormState = SandboxDeploymentForm;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The sandbox request failed.";
}

function initialProfileForm(): ProfileFormState {
  return {
    name: "",
    socketPath: DEFAULT_SOCKET_PATH,
    imageDigest: "",
    enabled: true,
  };
}

function initialDeploymentForm(): DeploymentFormState {
  return {
    profileId: "",
    label: "",
    repository: "",
    ref: "",
    providerInstanceId: "",
  };
}

function deploymentLabel(
  deployment: SandboxListResponse["deployments"][number]["deployment"],
): string {
  return deployment.label || deployment.deploymentId;
}

export function DeploymentSettings() {
  const connectPairing = useAtomCommand(connectPairingCommand, { reportFailure: false });
  const [data, setData] = useState<SandboxListResponse | null>(null);
  const [profileForm, setProfileForm] = useState(initialProfileForm);
  const [deploymentForm, setDeploymentForm] = useState(initialDeploymentForm);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isCreatingDeployment, setIsCreatingDeployment] = useState(false);
  const [activeHandoffId, setActiveHandoffId] = useState<string | null>(null);
  const [activeDeleteId, setActiveDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const codexProviders = useMemo(
    () => serverProviders.filter((provider) => provider.driver === "codex"),
    [serverProviders],
  );

  const availableProfiles = useMemo(
    () =>
      data?.profiles.filter((summary) => summary.kind === "available" && summary.profile.enabled) ??
      [],
    [data],
  );

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const nextData = await fetchSandboxList();
      setData(nextData);
      setDeploymentForm((current) => {
        if (current.profileId) return current;
        const firstProfile = nextData.profiles.find(
          (summary) => summary.kind === "available" && summary.profile.enabled,
        );
        return firstProfile ? { ...current, profileId: firstProfile.profile.profileId } : current;
      });
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

  useEffect(() => {
    if (deploymentForm.providerInstanceId || codexProviders.length === 0) return;
    setDeploymentForm((current) => ({
      ...current,
      providerInstanceId: codexProviders[0]!.instanceId,
    }));
  }, [codexProviders, deploymentForm.providerInstanceId]);

  const submitProfile = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!profileForm.name.trim() || !profileForm.imageDigest.trim()) {
        setError("Profile name and immutable image digest are required.");
        return;
      }

      setIsSavingProfile(true);
      setError(null);
      try {
        const accepted = await upsertSandboxProfile(profileForm);
        const receipt = await pollSandboxOperation(accepted.operationId);
        setOperation({
          operationId: receipt.operationId,
          status: receipt.status,
          ...(receipt.error ? { error: receipt.error } : {}),
        });
        if (receipt.status === "Failed") {
          setError(receipt.error ?? "The sandbox profile could not be saved.");
        } else {
          setProfileForm(initialProfileForm());
          await refresh();
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setIsSavingProfile(false);
      }
    },
    [profileForm, refresh],
  );

  const submitDeployment = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (
        !deploymentForm.profileId ||
        !deploymentForm.label.trim() ||
        !deploymentForm.repository.trim() ||
        !deploymentForm.ref.trim() ||
        !deploymentForm.providerInstanceId.trim()
      ) {
        setError("Profile, label, repository, ref, and Codex provider are required.");
        return;
      }

      setIsCreatingDeployment(true);
      setError(null);
      setOperation(null);
      try {
        const accepted = await createSandboxDeployment(deploymentForm);
        setOperation({ operationId: accepted.operationId, status: "Accepted" });
        const receipt = await pollSandboxOperation(accepted.operationId);
        setOperation({
          operationId: receipt.operationId,
          status: receipt.status,
          ...(receipt.error ? { error: receipt.error } : {}),
        });
        if (receipt.status === "Failed") {
          setError(receipt.error ?? "The sandbox deployment failed.");
        } else {
          setDeploymentForm((current) => ({
            ...initialDeploymentForm(),
            profileId: current.profileId,
          }));
          await refresh();
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setIsCreatingDeployment(false);
      }
    },
    [deploymentForm, refresh],
  );

  const attachDeployment = useCallback(
    async (deploymentId: string) => {
      setActiveHandoffId(deploymentId);
      setError(null);
      try {
        const handoff = await mintSandboxHandoff(deploymentId);
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
        if (profileForm.profileId === profileId) setProfileForm(initialProfileForm());
        await refresh();
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setActiveDeleteId(null);
      }
    },
    [profileForm.profileId, refresh],
  );

  const removeDeployment = useCallback(
    async (deploymentId: string, revision: number) => {
      setActiveDeleteId(`deployment:${deploymentId}`);
      setError(null);
      try {
        const accepted = await deleteSandboxDeployment(deploymentId, revision);
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

  return (
    <SettingsSection title="Docker sandboxes" data-testid="kata-sandbox-settings">
      <SettingsRow
        title={profileForm.profileId ? "Replace Docker profile" : "Docker profiles"}
        description="Store an immutable Kata Code image and the Docker socket used to create sandboxes."
      >
        <form
          aria-label="Create Docker sandbox profile"
          className="mt-3 space-y-3"
          onSubmit={(event) => void submitProfile(event)}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Profile name</span>
              <Input
                aria-label="Profile name"
                value={profileForm.name}
                onChange={(event) =>
                  setProfileForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Local Docker"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>OCI image digest</span>
              <Input
                aria-label="OCI image digest"
                value={profileForm.imageDigest}
                onChange={(event) =>
                  setProfileForm((current) => ({ ...current, imageDigest: event.target.value }))
                }
                placeholder="ghcr.io/kata-sh/sandbox@sha256:..."
              />
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">
              <span>Docker Unix socket</span>
              <Input
                aria-label="Docker Unix socket"
                value={profileForm.socketPath}
                onChange={(event) =>
                  setProfileForm((current) => ({ ...current, socketPath: event.target.value }))
                }
              />
            </label>
            <label className="flex h-8.5 items-center gap-2 text-xs text-muted-foreground sm:h-7.5">
              <input
                aria-label="Profile enabled"
                checked={profileForm.enabled}
                onChange={(event) =>
                  setProfileForm((current) => ({ ...current, enabled: event.target.checked }))
                }
                type="checkbox"
              />
              Enabled
            </label>
            <Button disabled={isSavingProfile} size="sm" type="submit">
              {isSavingProfile
                ? "Saving..."
                : profileForm.profileId
                  ? "Replace profile"
                  : "Save profile"}
            </Button>
            {profileForm.profileId ? (
              <Button
                disabled={isSavingProfile}
                onClick={() => setProfileForm(initialProfileForm())}
                size="sm"
                variant="ghost-muted"
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </SettingsRow>

      <SettingsRow
        title="Saved profiles"
        description="Unavailable profiles remain visible with their diagnostic."
      >
        <div className="mt-3 space-y-2" data-testid="kata-sandbox-profiles">
          {isLoading && data === null ? (
            <p className="text-sm text-muted-foreground">Loading profiles...</p>
          ) : null}
          {data?.profiles.map((summary) => (
            <div
              className="rounded-lg border border-border/70 px-3 py-2"
              key={summary.profile.profileId}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium">{summary.profile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {summary.kind === "available" ? "Available" : `Unavailable: ${summary.reason}`}
                  </span>
                </div>
                <Button
                  onClick={() =>
                    setProfileForm({
                      profileId: summary.profile.profileId,
                      expectedRevision: summary.profile.revision,
                      name: summary.profile.name,
                      socketPath: summary.profile.socketPath,
                      imageDigest: summary.profile.imageDigest,
                      enabled: summary.profile.enabled,
                    })
                  }
                  size="xs"
                  variant="ghost-muted"
                >
                  Edit
                </Button>
                <Button
                  disabled={activeDeleteId !== null}
                  onClick={() =>
                    void removeProfile(summary.profile.profileId, summary.profile.revision)
                  }
                  size="xs"
                  variant="ghost-muted"
                >
                  {activeDeleteId === `profile:${summary.profile.profileId}`
                    ? "Deleting..."
                    : "Delete"}
                </Button>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {summary.profile.imageDigest}
              </p>
              {summary.kind === "unavailable" ? (
                <p className="mt-1 text-xs text-destructive">{summary.diagnostic}</p>
              ) : null}
            </div>
          ))}
          {data?.profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Docker profiles configured.</p>
          ) : null}
        </div>
      </SettingsRow>

      <SettingsRow
        title="Create deployment"
        description="Resolve a GitHub ref, start a Docker sandbox, and attach it as a normal bearer environment."
      >
        <form
          aria-label="Create Docker sandbox deployment"
          className="mt-3 space-y-3"
          onSubmit={(event) => void submitDeployment(event)}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Docker profile</span>
              <select
                aria-label="Docker profile"
                className="h-8.5 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                value={deploymentForm.profileId}
                onChange={(event) =>
                  setDeploymentForm((current) => ({ ...current, profileId: event.target.value }))
                }
              >
                <option value="">Select a profile</option>
                {availableProfiles.map((summary) => (
                  <option key={summary.profile.profileId} value={summary.profile.profileId}>
                    {summary.profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Deployment label</span>
              <Input
                aria-label="Deployment label"
                value={deploymentForm.label}
                onChange={(event) =>
                  setDeploymentForm((current) => ({ ...current, label: event.target.value }))
                }
                placeholder="Feature branch sandbox"
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>GitHub repository</span>
              <Input
                aria-label="GitHub repository"
                value={deploymentForm.repository}
                onChange={(event) =>
                  setDeploymentForm((current) => ({ ...current, repository: event.target.value }))
                }
                placeholder="owner/repository"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              <span>Git ref</span>
              <Input
                aria-label="Git ref"
                value={deploymentForm.ref}
                onChange={(event) =>
                  setDeploymentForm((current) => ({ ...current, ref: event.target.value }))
                }
                placeholder="main or refs/pull/123/head"
              />
            </label>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground">
              <span>Codex provider instance</span>
              <select
                aria-label="Codex provider instance"
                className="h-8.5 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                onChange={(event) =>
                  setDeploymentForm((current) => ({
                    ...current,
                    providerInstanceId: event.target.value,
                  }))
                }
                value={deploymentForm.providerInstanceId}
              >
                <option value="">Select a Codex provider</option>
                {codexProviders.map((provider) => (
                  <option key={provider.instanceId} value={provider.instanceId}>
                    {provider.displayName ?? provider.instanceId}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={
                isCreatingDeployment ||
                availableProfiles.length === 0 ||
                codexProviders.length === 0
              }
              size="sm"
              type="submit"
            >
              {isCreatingDeployment ? "Creating..." : "Create deployment"}
            </Button>
          </div>
        </form>
      </SettingsRow>

      {operation ? (
        <SettingsRow
          title="Latest operation"
          description={`Operation ${operation.operationId} is ${operation.status.toLowerCase()}.`}
          status={operation.error}
        />
      ) : null}

      <SettingsRow
        title="Deployments"
        description="Attach an identified deployment through the ordinary onboarding flow."
      >
        <div className="mt-3 space-y-2" data-testid="kata-sandbox-deployments">
          {data?.deployments.map(({ deployment, observation }) => (
            <div
              className="rounded-lg border border-border/70 px-3 py-2"
              key={deployment.deploymentId}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{deploymentLabel(deployment)}</span>
                <span className="text-xs text-muted-foreground">
                  {deployment.state} · {observation?.state ?? "Not observed"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {deployment.repository && deployment.ref
                  ? `${deployment.repository} @ ${deployment.ref}`
                  : deployment.deploymentId}
              </p>
              {observation?.state === "Unknown" && observation.diagnostic ? (
                <p className="mt-1 text-xs text-destructive">{observation.diagnostic}</p>
              ) : null}
              {deployment.state === "Identified" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    disabled={
                      activeHandoffId === deployment.deploymentId || activeDeleteId !== null
                    }
                    onClick={() => void attachDeployment(deployment.deploymentId)}
                    size="sm"
                    variant="outline"
                  >
                    {activeHandoffId === deployment.deploymentId
                      ? "Attaching..."
                      : "Attach environment"}
                  </Button>
                  <Button
                    disabled={activeDeleteId !== null}
                    onClick={() =>
                      void removeDeployment(deployment.deploymentId, deployment.revision)
                    }
                    size="sm"
                    variant="ghost-muted"
                  >
                    {activeDeleteId === `deployment:${deployment.deploymentId}`
                      ? "Deleting..."
                      : "Delete"}
                  </Button>
                </div>
              ) : deployment.state === "Allocated" || deployment.state === "Requested" ? (
                <Button
                  className="mt-2"
                  disabled={activeDeleteId !== null}
                  onClick={() =>
                    void removeDeployment(deployment.deploymentId, deployment.revision)
                  }
                  size="sm"
                  variant="ghost-muted"
                >
                  {activeDeleteId === `deployment:${deployment.deploymentId}`
                    ? "Deleting..."
                    : "Delete"}
                </Button>
              ) : null}
            </div>
          ))}
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
        <Button disabled={isLoading} onClick={() => void refresh()} size="sm" variant="ghost-muted">
          {isLoading ? "Refreshing..." : "Refresh sandboxes"}
        </Button>
      </div>
    </SettingsSection>
  );
}
