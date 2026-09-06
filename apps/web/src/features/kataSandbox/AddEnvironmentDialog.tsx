import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, CheckIcon, ContainerIcon, PlusIcon, TerminalIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { DesktopDiscoveredSshHost } from "@kata-sh/code-contracts";
import {
  OciImageDigest,
  type SandboxProviderDescriptor,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import * as Schema from "effect/Schema";

import { primaryServerProvidersAtom } from "~/state/server";
import { cn } from "../../lib/utils";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Spinner } from "../../components/ui/spinner";
import { toastManager } from "../../components/ui/toast";
import {
  createSandboxDeployment,
  deleteSandboxDeployment,
  fetchSandboxList,
  mintSandboxHandoff,
  pollSandboxOperation,
  type SandboxListResponse,
  type SandboxOperationReceipt,
  type SandboxDeploymentForm,
  type SandboxProfileForm,
  upsertSandboxProfile,
} from "./api";
import {
  addEnvironmentReducer,
  createInitialAddEnvironmentState,
  createInitialDockerDraft,
  dockerProviderDiagnostic,
  groupSandboxProviders,
  hasSandboxProviderAdvertisement,
  normalizeManagedImageVersion,
  shouldOfferSandboxImageOverride,
  type AddEnvironmentState,
  type DockerDraft,
  type DockerDraftField,
} from "./AddEnvironmentDialog.logic";
import { SandboxGitHubSourcePicker } from "./SandboxGitHubSourcePicker";

export interface AddEnvironmentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly desktopBridge: boolean;
  readonly authenticated: boolean;
  readonly canManageSandboxes: boolean;
  readonly discoveredSshHosts: ReadonlyArray<DesktopDiscoveredSshHost>;
  readonly discoveredSshHostsError: string | null;
  readonly isLoadingDiscoveredSshHosts: boolean;
  readonly onRefreshSshHosts: () => void;
  readonly serverVersion: string;
  readonly onConnectPairing: (input: {
    readonly pairingUrl?: string;
    readonly host?: string;
    readonly pairingCode?: string;
  }) => Promise<void>;
  readonly onConnectSsh: (input: {
    readonly host: string;
    readonly username: string;
    readonly port: string;
  }) => Promise<void>;
  readonly onConnectSshTarget: (target: DesktopDiscoveredSshHost) => Promise<void>;
}

const isOciImageDigest = Schema.is(OciImageDigest);

function operationView(phase: "profile" | "deployment", receipt: SandboxOperationReceipt) {
  const profileId =
    receipt.result?.kind === "profile" ? receipt.result.profileId : receipt.profileId;
  return {
    phase,
    operationId: receipt.operationId,
    status: receipt.status,
    ...(receipt.progress === undefined
      ? {}
      : { progress: receipt.progress, stage: receipt.progress.stage }),
    ...(receipt.error ? { error: receipt.error } : {}),
    ...(profileId ? { profileId } : {}),
    ...(receipt.deploymentId ? { deploymentId: receipt.deploymentId } : {}),
  } as const;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The environment request failed.";
}

function profileImage(draft: DockerDraft): NonNullable<SandboxProfileForm["image"]> {
  const override = draft.imageOverride.trim();
  return override.length > 0
    ? { kind: "custom", digest: override }
    : {
        kind: "managed",
        channel: draft.imageChannel,
        version: normalizeManagedImageVersion(draft.imageVersion),
      };
}

function deploymentForm(
  draft: DockerDraft,
  profileId: string,
  expectedRevision?: number,
): SandboxDeploymentForm {
  return {
    profileId,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    label: draft.label,
    repository: draft.repository,
    ref: draft.ref,
    providerInstanceId: draft.providerInstanceId,
  };
}

function readProfileImageLabel(
  profile: SandboxListResponse["profiles"][number]["profile"],
): string {
  return profile.imageDigest;
}

function remoteInput(state: Extract<AddEnvironmentState, { readonly step: "remote" }>) {
  return { host: state.host, pairingCode: state.pairingCode };
}

export function AddEnvironmentDialog({
  open,
  onOpenChange,
  desktopBridge,
  authenticated,
  canManageSandboxes,
  discoveredSshHosts,
  discoveredSshHostsError,
  isLoadingDiscoveredSshHosts,
  onRefreshSshHosts,
  serverVersion,
  onConnectPairing,
  onConnectSsh,
  onConnectSshTarget,
}: AddEnvironmentDialogProps) {
  const [sandboxList, setSandboxList] = useState<SandboxListResponse | null>(null);
  const [sandboxListError, setSandboxListError] = useState<string | null>(null);
  const [isLoadingSandboxList, setIsLoadingSandboxList] = useState(false);
  const refreshSandboxList = useCallback(async () => {
    if (!authenticated) return;
    setIsLoadingSandboxList(true);
    try {
      setSandboxList(await fetchSandboxList());
      setSandboxListError(null);
    } catch (error) {
      setSandboxListError(errorMessage(error));
    } finally {
      setIsLoadingSandboxList(false);
    }
  }, [authenticated]);
  useEffect(() => {
    if (open && authenticated) void refreshSandboxList();
  }, [authenticated, open, refreshSandboxList]);

  const codexProviders = useAtomValue(primaryServerProvidersAtom).filter(
    (provider) => provider.driver === "codex",
  );
  const firstProviderId = codexProviders[0]?.instanceId;
  const [state, dispatch] = useReducer(addEnvironmentReducer, undefined, () =>
    createInitialAddEnvironmentState(serverVersion, firstProviderId),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sandboxProviders = sandboxList?.providers ?? [];
  const dockerDiagnostic = dockerProviderDiagnostic(sandboxProviders);
  const offerSandboxImageOverride = shouldOfferSandboxImageOverride(dockerDiagnostic);
  const showSandboxChoice =
    authenticated && canManageSandboxes && hasSandboxProviderAdvertisement(sandboxProviders);
  const providerGroups = useMemo(() => groupSandboxProviders(sandboxProviders), [sandboxProviders]);
  const availableProfiles = useMemo(
    () =>
      sandboxList?.profiles.filter(
        (summary) => summary.kind === "available" && summary.profile.enabled,
      ) ?? [],
    [sandboxList],
  );
  const selectedProfile = availableProfiles.find(
    (summary) =>
      state.step === "docker" &&
      state.draft.profileMode === "existing" &&
      summary.profile.profileId === state.draft.profileId,
  );
  const sandboxOperationActive =
    state.step === "docker" &&
    state.operation !== null &&
    (state.operation.status === "Accepted" || state.operation.status === "Running");
  const attachmentPending = state.step === "docker" && state.attachment?.status === "pending";
  const isBusy = isSubmitting || sandboxOperationActive || attachmentPending;

  useEffect(() => {
    if (state.step !== "docker") return;
    if (state.draft.providerInstanceId || firstProviderId === undefined) return;
    dispatch({ type: "set-docker", field: "providerInstanceId", value: firstProviderId });
  }, [
    firstProviderId,
    state.step,
    state.step === "docker" ? state.draft.providerInstanceId : null,
  ]);

  useEffect(() => {
    if (state.step !== "docker" || state.operation !== null) return;
    if (state.draft.profileMode === "existing" && state.draft.profileId.length > 0) return;
    if (availableProfiles.length === 0 && state.draft.profileMode !== "new") {
      dispatch({ type: "new-profile" });
      return;
    }
    if (
      state.draft.profileMode === "existing" &&
      !availableProfiles.some((summary) => summary.profile.profileId === state.draft.profileId)
    ) {
      const profileId = availableProfiles[0]?.profile.profileId;
      if (profileId !== undefined) dispatch({ type: "select-profile", profileId });
    }
  }, [availableProfiles, state]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && (sandboxOperationActive || attachmentPending)) return;
      if (!nextOpen) {
        dispatch({
          type: "reset",
          docker: createInitialDockerDraft({ serverVersion, providerInstanceId: firstProviderId }),
        });
      }
      onOpenChange(nextOpen);
    },
    [attachmentPending, firstProviderId, onOpenChange, sandboxOperationActive, serverVersion],
  );

  const showError = useCallback((error: unknown) => {
    dispatch({ type: "error", error: errorMessage(error) });
  }, []);

  const connectRemote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.step !== "remote") return;
    setIsSubmitting(true);
    try {
      await onConnectPairing(remoteInput(state));
      toastManager.add({
        type: "success",
        title: "Environment connected",
        description: "The environment is saved and will reconnect on app startup.",
      });
      handleOpenChange(false);
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const connectSsh = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.step !== "ssh") return;
    setIsSubmitting(true);
    try {
      await onConnectSsh({ host: state.host, username: state.username, port: state.port });
      toastManager.add({
        type: "success",
        title: "Environment connected",
        description: "The environment is ready over an SSH-managed tunnel.",
      });
      handleOpenChange(false);
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const attach = async (deploymentId: string) => {
    dispatch({ type: "attachment", attachment: { status: "pending" } });
    try {
      const handoff = await mintSandboxHandoff(deploymentId);
      await onConnectPairing({ pairingUrl: handoff.pairingUrl });
      dispatch({ type: "attachment", attachment: { status: "succeeded" } });
      toastManager.add({
        type: "success",
        title: "Sandbox environment attached",
        description: "The sandbox is saved as an ordinary environment.",
      });
      void refreshSandboxList();
    } catch (error) {
      dispatch({
        type: "attachment",
        attachment: { status: "failed", error: errorMessage(error) },
      });
    }
  };

  const retryFailedOperation = async () => {
    if (state.step !== "docker" || state.operation?.status !== "Failed") return;
    const failedOperation = state.operation;
    if (failedOperation.phase !== "deployment" || failedOperation.deploymentId === undefined) {
      dispatch({ type: "retry" });
      return;
    }
    setIsSubmitting(true);
    dispatch({ type: "error", error: null });
    try {
      const accepted = await deleteSandboxDeployment(failedOperation.deploymentId);
      const receipt = await pollSandboxOperation(accepted.operationId);
      if (receipt.status === "Failed") {
        throw new Error(receipt.error ?? "The failed sandbox deployment could not be cleaned up.");
      }
      dispatch({ type: "retry" });
      void refreshSandboxList();
    } catch (error) {
      showError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const createDocker = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.step !== "docker" || isSubmitting || state.operation !== null) return;
    const draft = state.draft;
    const profileId = draft.profileId.trim();
    if (draft.profileMode === "existing" && profileId.length === 0) {
      showError("Select an available Docker profile or add a Docker profile.");
      return;
    }
    if (draft.profileMode === "new" && !draft.profileName.trim()) {
      showError("Profile name is required.");
      return;
    }
    if (!draft.label.trim() || !draft.repository.trim() || !draft.ref.trim()) {
      showError("Deployment label, GitHub repository, and ref are required.");
      return;
    }
    if (!draft.providerInstanceId.trim()) {
      showError("Select a Codex provider instance.");
      return;
    }
    if (
      draft.profileMode === "new" &&
      draft.imageOverride.trim().length > 0 &&
      !isOciImageDigest(draft.imageOverride.trim())
    ) {
      showError("The immutable image override must be a sha256 OCI digest.");
      return;
    }

    setIsSubmitting(true);
    dispatch({ type: "error", error: null });
    try {
      let selectedProfileId = profileId;
      let selectedProfileRevision = selectedProfile?.profile.revision;
      const listedProfile = sandboxList?.profiles.find(
        (summary) => summary.profile.profileId === profileId,
      )?.profile;
      const retryUnavailableProfile =
        draft.profileMode === "existing" && profileId.length > 0 && selectedProfile === undefined;
      if (draft.profileMode === "new" || retryUnavailableProfile) {
        const profileInput: SandboxProfileForm = {
          ...(retryUnavailableProfile
            ? { profileId, expectedRevision: listedProfile?.revision ?? 1 }
            : {}),
          name: draft.profileName.trim() || listedProfile?.name || "Docker",
          socketPath: draft.socketPath,
          image:
            retryUnavailableProfile && listedProfile
              ? { kind: "custom", digest: listedProfile.imageDigest }
              : profileImage(draft),
          enabled: true,
        };
        const accepted = await upsertSandboxProfile(profileInput);
        dispatch({
          type: "operation",
          operation: {
            phase: "profile",
            operationId: accepted.operationId,
            status: "Accepted",
            ...(profileId ? { profileId } : {}),
          },
        });
        const receipt = await pollSandboxOperation(accepted.operationId, {
          onReceipt: (nextReceipt) =>
            dispatch({ type: "operation", operation: operationView("profile", nextReceipt) }),
        });
        const receiptProfileId =
          receipt.result?.kind === "profile"
            ? (receipt.result.profileId ?? "")
            : (receipt.profileId ?? "");
        if (receiptProfileId) dispatch({ type: "select-profile", profileId: receiptProfileId });
        void refreshSandboxList();
        if (receipt.status === "Failed")
          throw new Error(receipt.error ?? "The Docker profile could not be saved.");
        selectedProfileId = receiptProfileId;
        if (!selectedProfileId) throw new Error("The Docker profile was saved without an id.");
        selectedProfileRevision = listedProfile?.revision ?? 1;
      }

      const accepted = await createSandboxDeployment(
        deploymentForm(draft, selectedProfileId, selectedProfileRevision),
      );
      dispatch({
        type: "operation",
        operation: {
          phase: "deployment",
          operationId: accepted.operationId,
          status: "Accepted",
        },
      });
      const receipt = await pollSandboxOperation(accepted.operationId, {
        onReceipt: (nextReceipt) =>
          dispatch({ type: "operation", operation: operationView("deployment", nextReceipt) }),
      });
      if (receipt.status === "Failed")
        throw new Error(receipt.error ?? "The sandbox deployment failed.");
      const deploymentId =
        receipt.result?.kind === "deployment" ? receipt.result.deploymentId : receipt.deploymentId;
      if (!deploymentId) throw new Error("The deployment completed without an id.");
      dispatch({ type: "operation", operation: operationView("deployment", receipt) });
      await attach(deploymentId);
    } catch (error) {
      dispatch({ type: "fail-operation", error: errorMessage(error) });
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderChoice = () => (
    <div className="grid gap-3 sm:grid-cols-2">
      <ChoiceCard
        title="Remote link"
        description="Enter a backend host and pairing code."
        icon={<ContainerIcon aria-hidden className="size-4" />}
        onClick={() => dispatch({ type: "choose", choice: "remote" })}
      />
      {desktopBridge ? (
        <ChoiceCard
          title="SSH"
          description="Use local SSH config, agent, and tunnels for the backend."
          icon={<TerminalIcon aria-hidden className="size-4" />}
          onClick={() => dispatch({ type: "choose", choice: "ssh" })}
        />
      ) : null}
      {showSandboxChoice ? (
        <ChoiceCard
          title="Sandboxes"
          description="Create an isolated Kata environment from a local or cloud provider."
          icon={<ContainerIcon aria-hidden className="size-4" />}
          onClick={() => dispatch({ type: "choose", choice: "sandbox" })}
        />
      ) : null}
    </div>
  );

  const renderRemote = () => {
    if (state.step !== "remote") return null;
    return (
      <form className="space-y-4" onSubmit={(event) => void connectRemote(event)}>
        <Field label="Host">
          <Input
            autoFocus
            value={state.host}
            onChange={(event) =>
              dispatch({ type: "set-remote", field: "host", value: event.target.value })
            }
            placeholder="backend.example.com"
            disabled={isSubmitting}
          />
        </Field>
        <Field label="Pairing code">
          <Input
            value={state.pairingCode}
            onChange={(event) =>
              dispatch({ type: "set-remote", field: "pairingCode", value: event.target.value })
            }
            placeholder="PAIRCODE"
            disabled={isSubmitting}
          />
        </Field>
        {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        <DialogFooter variant="bare" className="px-0">
          <BackButton disabled={isSubmitting} onClick={() => dispatch({ type: "back" })} />
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Adding…" : "Add environment"}
          </Button>
        </DialogFooter>
      </form>
    );
  };

  const renderSsh = () => {
    if (state.step !== "ssh") return null;
    return (
      <form className="space-y-4" onSubmit={(event) => void connectSsh(event)}>
        <Field label="SSH host or alias">
          <Input
            autoFocus
            value={state.host}
            onChange={(event) =>
              dispatch({ type: "set-ssh", field: "host", value: event.target.value })
            }
            placeholder="Search hosts or type devbox"
            disabled={isSubmitting}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field label="Username">
            <Input
              value={state.username}
              onChange={(event) =>
                dispatch({ type: "set-ssh", field: "username", value: event.target.value })
              }
              placeholder="root"
              disabled={isSubmitting}
            />
          </Field>
          <Field label="Port">
            <Input
              value={state.port}
              onChange={(event) =>
                dispatch({ type: "set-ssh", field: "port", value: event.target.value })
              }
              placeholder="22"
              inputMode="numeric"
              disabled={isSubmitting}
            />
          </Field>
        </div>
        {state.error || discoveredSshHostsError ? (
          <ErrorText>{state.error ?? discoveredSshHostsError}</ErrorText>
        ) : null}
        <div className="overflow-hidden rounded-lg border border-border/60">
          <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/30 px-3 py-2">
            <div>
              <p className="text-xs font-medium text-foreground">Suggested hosts</p>
              <p className="text-[11px] text-muted-foreground">From SSH config and known hosts</p>
            </div>
            <Button
              size="xs"
              variant="ghost"
              disabled={isLoadingDiscoveredSshHosts}
              onClick={onRefreshSshHosts}
            >
              Refresh
            </Button>
          </div>
          {discoveredSshHosts.map((target) => (
            <div
              className="flex items-center justify-between gap-2 px-3 py-2"
              key={`${target.alias}:${target.hostname}:${target.port ?? ""}`}
            >
              <span className="min-w-0 truncate text-xs text-foreground">{target.alias}</span>
              <Button
                size="xs"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => {
                  setIsSubmitting(true);
                  void onConnectSshTarget(target)
                    .then(() => handleOpenChange(false))
                    .catch(showError)
                    .finally(() => setIsSubmitting(false));
                }}
              >
                Add environment
              </Button>
            </div>
          ))}
          {!isLoadingDiscoveredSshHosts && discoveredSshHosts.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No new SSH hosts were discovered.
            </p>
          ) : null}
        </div>
        <DialogFooter variant="bare" className="px-0">
          <BackButton disabled={isSubmitting} onClick={() => dispatch({ type: "back" })} />
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Adding…" : "Add environment"}
          </Button>
        </DialogFooter>
      </form>
    );
  };

  const renderSandboxProviders = () => {
    if (state.step !== "sandbox-providers") return null;
    return (
      <div className="space-y-4">
        {isLoadingSandboxList ? (
          <p className="text-sm text-muted-foreground" role="status">
            Looking for sandbox providers…
          </p>
        ) : null}
        {providerGroups.local.length > 0 ? (
          <ProviderGroup
            title="Local Container"
            providers={providerGroups.local}
            onDocker={() =>
              dispatch({
                type: "choose-docker",
                docker: createInitialDockerDraft({
                  serverVersion,
                  providerInstanceId: firstProviderId,
                }),
              })
            }
          />
        ) : null}
        {providerGroups.cloud.length > 0 ? (
          <ProviderGroup
            title="Cloud Provider"
            providers={providerGroups.cloud}
            onDocker={() => undefined}
          />
        ) : null}
        {sandboxListError ? <ErrorText>{sandboxListError}</ErrorText> : null}
        {providerGroups.local.length === 0 && providerGroups.cloud.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sandbox providers are available.</p>
        ) : null}
        <DialogFooter variant="bare" className="px-0">
          <BackButton onClick={() => dispatch({ type: "back" })} />
        </DialogFooter>
      </div>
    );
  };

  const renderDocker = () => {
    if (state.step !== "docker") return null;
    const operation = state.operation;
    const canEdit = operation === null;
    const profileNeedsCreation = state.draft.profileMode === "new";
    return (
      <form className="space-y-4" onSubmit={(event) => void createDocker(event)}>
        {operation ? <OperationProgress operation={operation} /> : null}
        {state.attachment ? <AttachmentResult attachment={state.attachment} /> : null}
        {canEdit && dockerDiagnostic ? <ErrorText>{dockerDiagnostic}</ErrorText> : null}
        {canEdit ? (
          <>
            <section className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">Docker profile</h3>
                  <p className="text-xs text-muted-foreground">
                    Reuse an available profile or add one for this machine.
                  </p>
                </div>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => dispatch({ type: "new-profile" })}
                >
                  <PlusIcon className="size-3.5" />
                  Add Docker profile
                </Button>
              </div>
              {availableProfiles.length > 0 ? (
                <div className="space-y-1" role="listbox" aria-label="Available Docker profiles">
                  {availableProfiles.map((summary) => {
                    const selected =
                      state.draft.profileMode === "existing" &&
                      state.draft.profileId === summary.profile.profileId;
                    return (
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        key={summary.profile.profileId}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left",
                          selected
                            ? "border-primary bg-primary/5"
                            : "border-border/60 hover:bg-muted/40",
                        )}
                        onClick={() =>
                          dispatch({ type: "select-profile", profileId: summary.profile.profileId })
                        }
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {summary.profile.name}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {readProfileImageLabel(summary.profile)}
                          </span>
                        </span>
                        {selected ? <CheckIcon className="size-4 shrink-0 text-primary" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              {profileNeedsCreation ? (
                <ProfileDraft
                  draft={state.draft}
                  disabled={isSubmitting}
                  openAdvanced={offerSandboxImageOverride}
                  onChange={(field, value) => dispatch({ type: "set-docker", field, value })}
                />
              ) : selectedProfile ? (
                <p className="text-xs text-muted-foreground">
                  Docker socket: <code>{selectedProfile.profile.socketPath}</code>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Add a Docker profile to continue.</p>
              )}
            </section>
            <section className="space-y-3 border-t border-border/60 pt-4">
              <h3 className="text-sm font-medium text-foreground">Deployment</h3>
              <Field label="Deployment label">
                <Input
                  value={state.draft.label}
                  onChange={(event) =>
                    dispatch({ type: "set-docker", field: "label", value: event.target.value })
                  }
                  placeholder="Feature branch sandbox"
                  disabled={isSubmitting}
                />
              </Field>
              <SandboxGitHubSourcePicker
                idPrefix="add-environment-docker-source"
                repository={state.draft.repository}
                ref={state.draft.ref}
                disabled={isSubmitting}
                onRepositoryChange={(repository) =>
                  dispatch({ type: "set-docker", field: "repository", value: repository })
                }
                onRefChange={(ref) => dispatch({ type: "set-docker", field: "ref", value: ref })}
              />
              <Field label="Git ref">
                <Input
                  value={state.draft.ref}
                  onChange={(event) =>
                    dispatch({ type: "set-docker", field: "ref", value: event.target.value })
                  }
                  placeholder="main, a tag, or refs/pull/123/head"
                  disabled={isSubmitting || !state.draft.repository}
                />
              </Field>
              <Field label="Codex provider instance">
                <select
                  aria-label="Codex provider instance"
                  className="h-8.5 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                  value={state.draft.providerInstanceId}
                  onChange={(event) =>
                    dispatch({
                      type: "set-docker",
                      field: "providerInstanceId",
                      value: event.target.value,
                    })
                  }
                  disabled={isSubmitting}
                >
                  <option value="">Select a Codex provider</option>
                  {codexProviders.map((provider) => (
                    <option key={provider.instanceId} value={provider.instanceId}>
                      {provider.displayName ?? provider.instanceId}
                    </option>
                  ))}
                </select>
              </Field>
            </section>
          </>
        ) : null}
        {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        <DialogFooter variant="bare" className="px-0">
          <BackButton disabled={isBusy} onClick={() => dispatch({ type: "back" })} />
          {operation?.status === "Failed" ? (
            <Button
              disabled={isSubmitting}
              type="button"
              onClick={() => void retryFailedOperation()}
            >
              Retry
            </Button>
          ) : null}
          {operation?.status === "Succeeded" &&
          state.attachment?.status === "failed" &&
          operation.deploymentId ? (
            <Button
              disabled={isBusy}
              type="button"
              onClick={() => void attach(operation.deploymentId!)}
            >
              Retry attachment
            </Button>
          ) : null}
          {operation === null ? (
            <Button
              disabled={
                isSubmitting ||
                (availableProfiles.length === 0 &&
                  !profileNeedsCreation &&
                  state.draft.profileId.length === 0)
              }
              type="submit"
            >
              {isSubmitting ? "Creating…" : "Create and attach environment"}
            </Button>
          ) : null}
        </DialogFooter>
      </form>
    );
  };

  const title =
    state.step === "choice"
      ? "Add Environment"
      : state.step === "sandbox-providers"
        ? "Choose a sandbox provider"
        : state.step === "docker"
          ? "Create Docker environment"
          : state.step === "remote"
            ? "Remote link"
            : "SSH";
  const description =
    state.step === "choice"
      ? "Connect another environment to this client."
      : state.step === "sandbox-providers"
        ? "Choose where the isolated environment should run."
        : state.step === "docker"
          ? "Create an isolated Kata environment and attach it as a normal environment."
          : undefined;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="h-5 gap-1 rounded-sm px-1 text-[11px] font-normal text-muted-foreground/60 hover:text-muted-foreground"
            aria-label="Add environment"
          >
            <PlusIcon className="size-3" />
            <span>Add environment</span>
          </Button>
        }
      />
      <DialogPopup className="max-h-[80dvh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <DialogPanel>
          {state.step === "choice"
            ? renderChoice()
            : state.step === "remote"
              ? renderRemote()
              : state.step === "ssh"
                ? renderSsh()
                : state.step === "sandbox-providers"
                  ? renderSandboxProviders()
                  : renderDocker()}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function ChoiceCard({
  title,
  description,
  icon,
  onClick,
}: {
  readonly title: string;
  readonly description: string;
  readonly icon: ReactNode;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group flex min-h-24 items-start gap-3 rounded-lg border border-border/60 p-4 text-left hover:bg-muted/40"
      onClick={onClick}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/70 bg-background text-muted-foreground group-hover:text-foreground">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

function ProviderGroup({
  title,
  providers,
  onDocker,
}: {
  readonly title: string;
  readonly providers: ReadonlyArray<SandboxProviderDescriptor>;
  readonly onDocker: () => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.map((provider) => (
          <button
            type="button"
            key={provider.driverKind}
            className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-3 text-left hover:bg-muted/40"
            onClick={provider.driverKind === "docker" ? onDocker : undefined}
          >
            <ContainerIcon className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">{provider.displayName}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
function ErrorText({ children }: { readonly children: ReactNode }) {
  return (
    <p
      className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
      role="alert"
    >
      {children}
    </p>
  );
}
function BackButton({
  disabled,
  onClick,
}: {
  readonly disabled?: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button type="button" variant="outline" disabled={disabled} onClick={onClick}>
      <ArrowLeftIcon className="size-3.5" />
      Back
    </Button>
  );
}

function ProfileDraft({
  draft,
  disabled,
  openAdvanced,
  onChange,
}: {
  readonly draft: DockerDraft;
  readonly disabled: boolean;
  readonly openAdvanced?: boolean;
  readonly onChange: (field: DockerDraftField, value: string) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3">
      <Field label="Profile name">
        <Input
          autoFocus
          value={draft.profileName}
          onChange={(event) => onChange("profileName", event.target.value)}
          placeholder="Local Docker"
          disabled={disabled}
        />
      </Field>
      <Field label="Docker Unix socket">
        <Input
          aria-label="Docker Unix socket"
          value={draft.socketPath}
          onChange={(event) => onChange("socketPath", event.target.value)}
          disabled={disabled}
        />
      </Field>
      <div className="rounded-lg border border-border/60 bg-background/60 p-3">
        <p className="text-xs font-medium text-foreground">Kata-managed image</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          The stable image for this server version is selected automatically.
        </p>
        <code className="mt-2 block text-[11px] text-muted-foreground">
          {draft.imageChannel} · {draft.imageVersion}
        </code>
      </div>
      <details className="rounded-lg border border-border/60 px-3 py-2" open={openAdvanced}>
        <summary className="cursor-pointer text-xs font-medium text-foreground">
          Advanced: immutable image override
        </summary>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Optional sha256 OCI digest. Leave empty to use the Kata-managed image.
        </p>
        <Input
          aria-label="Immutable image override"
          className="mt-2"
          value={draft.imageOverride}
          onChange={(event) => onChange("imageOverride", event.target.value)}
          disabled={disabled}
        />
      </details>
    </div>
  );
}

function OperationProgress({
  operation,
}: {
  readonly operation: NonNullable<
    Extract<AddEnvironmentState, { readonly step: "docker" }>["operation"]
  >;
}) {
  const stageLabel = operation.stage?.replaceAll("-", " ") ?? operation.status.toLowerCase();
  const progress = operation.progress;
  const pulling = progress?.stage === "pulling-image" ? progress : undefined;
  const failed = progress?.stage === "failed" ? progress : undefined;
  return (
    <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2" role="status">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        {operation.status === "Succeeded" ? (
          <CheckIcon className="size-4 text-success" />
        ) : operation.status === "Failed" ? null : (
          <Spinner className="size-3.5" />
        )}
        {operation.phase === "profile" ? "Docker profile" : "Docker deployment"}{" "}
        <span className="text-xs font-normal text-muted-foreground">{stageLabel}</span>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Operation {operation.operationId}</p>
      {pulling ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Downloaded {pulling.downloadedBytes ?? 0} bytes
          {pulling.totalBytes === null || pulling.totalBytes === undefined
            ? ""
            : ` of ${pulling.totalBytes}`}
          {pulling.layersTotal === null || pulling.layersTotal === undefined
            ? ""
            : ` · ${pulling.layersCompleted ?? 0}/${pulling.layersTotal} layers`}
        </p>
      ) : null}
      {failed ? <ErrorText>{failed.diagnostic}</ErrorText> : null}
      {operation.error && !failed ? <ErrorText>{operation.error}</ErrorText> : null}
    </div>
  );
}

function AttachmentResult({
  attachment,
}: {
  readonly attachment: NonNullable<
    Extract<AddEnvironmentState, { readonly step: "docker" }>["attachment"]
  >;
}) {
  return attachment.status === "pending" ? (
    <p
      className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2 text-sm text-muted-foreground"
      role="status"
    >
      Attaching environment…
    </p>
  ) : attachment.status === "succeeded" ? (
    <p
      className="rounded-lg border border-success/30 bg-success/5 px-3 py-2 text-sm text-success"
      role="status"
    >
      Environment attached. It is now available in your ordinary environment list.
    </p>
  ) : (
    <ErrorText>Attachment failed: {attachment.error}</ErrorText>
  );
}

export function sandboxProviderDescriptors(
  list: SandboxListResponse | null,
): ReadonlyArray<SandboxProviderDescriptor> {
  return list?.providers ?? [];
}

export function isSandboxListAuthenticated(
  authenticated: boolean,
  list: SandboxListResponse | null,
): boolean {
  return authenticated && hasSandboxProviderAdvertisement(sandboxProviderDescriptors(list));
}
