import { useAtomValue } from "@effect/atom-react";
import { ArrowLeftIcon, ContainerIcon, PlusIcon, TerminalIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { DesktopDiscoveredSshHost, EnvironmentId } from "@kata-sh/code-contracts";
import {
  OciImageDigest,
  type SandboxProviderDescriptor,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import * as Schema from "effect/Schema";

import { primaryServerProvidersAtom } from "~/state/server";
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
import { toastManager } from "../../components/ui/toast";
import {
  createSandboxDeployment,
  deleteSandboxDeployment,
  fetchSandboxList,
  pollSandboxOperation,
  type SandboxListResponse,
  type SandboxOperationReceipt,
  type SandboxDeploymentForm,
  retrySandboxDeployment,
} from "./api";
import {
  addEnvironmentReducer,
  createInitialAddEnvironmentState,
  createInitialDockerDraft,
  dockerProviderDiagnostic,
  groupSandboxProviders,
  hasSandboxProviderAdvertisement,
  normalizeManagedImageVersion,
  formatSandboxProgress,
  discoverSandboxCreates,
  isCurrentSandboxList,
  sandboxDiscardTarget,
  shouldOfferSandboxImageOverride,
  type AddEnvironmentState,
  type DockerDraft,
  type AddEnvironmentAction,
} from "./AddEnvironmentDialog.logic";
import { openCreatedSandbox } from "./onboarding";
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
  }) => Promise<EnvironmentId>;
  readonly registeredEnvironmentIds: ReadonlyArray<EnvironmentId>;
  readonly onOpenSandbox: (
    environmentId: EnvironmentId,
    title: string,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly onConnectSsh: (input: {
    readonly host: string;
    readonly username: string;
    readonly port: string;
  }) => Promise<void>;
  readonly onConnectSshTarget: (target: DesktopDiscoveredSshHost) => Promise<void>;
}

const isOciImageDigest = Schema.is(OciImageDigest);

function operationView(receipt: SandboxOperationReceipt) {
  return {
    operationId: receipt.operationId,
    status: receipt.status,
    acceptedAt: receipt.acceptedAt,
    ...(receipt.progress === undefined ? {} : { progress: receipt.progress }),
    ...(receipt.error === undefined ? {} : { error: receipt.error }),
    ...(receipt.deploymentId === undefined ? {} : { deploymentId: receipt.deploymentId }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ""
    ? error.message
    : "The environment request failed.";
}

function profileImage(draft: DockerDraft): SandboxDeploymentForm["image"] {
  const override = draft.imageOverride.trim();
  return override.length > 0
    ? { kind: "custom", digest: override }
    : {
        kind: "managed",
        channel: draft.imageChannel,
        version: normalizeManagedImageVersion(draft.imageVersion),
      };
}

function deploymentForm(draft: DockerDraft): SandboxDeploymentForm {
  return {
    image: profileImage(draft),
    socketPath: draft.socketPath,
    label: draft.label.trim() || draft.repository.split("/").at(-1) || "Sandbox",
    repository: draft.repository,
    ref: draft.ref,
    providerInstanceId: draft.providerInstanceId,
  };
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
  registeredEnvironmentIds,
  onOpenSandbox,
  onConnectSsh,
  onConnectSshTarget,
}: AddEnvironmentDialogProps) {
  const dialogSession = useRef(new AbortController());
  const listSession = useRef<AbortSignal | null>(null);
  const registrations = useRef(registeredEnvironmentIds);
  registrations.current = registeredEnvironmentIds;
  const [sandboxList, setSandboxList] = useState<SandboxListResponse | null>(null);
  const [sandboxListError, setSandboxListError] = useState<string | null>(null);
  const [isLoadingSandboxList, setIsLoadingSandboxList] = useState(false);
  const refreshSandboxList = useCallback(async () => {
    if (!authenticated) return;
    const signal = dialogSession.current.signal;
    setIsLoadingSandboxList(true);
    try {
      const list = await fetchSandboxList(signal);
      if (signal.aborted || signal !== dialogSession.current.signal) return;
      listSession.current = signal;
      setSandboxList(list);
      setSandboxListError(null);
    } catch (error) {
      if (!signal.aborted && signal === dialogSession.current.signal)
        setSandboxListError(errorMessage(error));
    } finally {
      if (signal === dialogSession.current.signal) setIsLoadingSandboxList(false);
    }
  }, [authenticated]);
  useEffect(() => {
    dialogSession.current.abort();
    const session = new AbortController();
    dialogSession.current = session;
    listSession.current = null;
    setSandboxList(null);
    if (open && authenticated) void refreshSandboxList();
    else session.abort();
    return () => session.abort();
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
  const observation = useRef<AbortController | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [observationStopped, setObservationStopped] = useState(false);
  const [elapsedNow, setElapsedNow] = useState(Date.now());
  useEffect(() => {
    if (!open) observation.current?.abort();
    const timer = setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      observation.current?.abort();
    };
  }, [open]);
  const sandboxOperationActive =
    state.step === "docker" &&
    state.operation !== null &&
    !observationStopped &&
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

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        dialogSession.current.abort();
        listSession.current = null;
        setIsSubmitting(false);
        observation.current?.abort();
        dispatch({
          type: "reset",
          docker: createInitialDockerDraft({ serverVersion, providerInstanceId: firstProviderId }),
        });
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, serverVersion, firstProviderId],
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

  const attach = async (deploymentId: string, signal = dialogSession.current.signal) => {
    if (signal.aborted) return;
    dispatch({ type: "attachment", attachment: { status: "pending" } });
    try {
      await openCreatedSandbox(deploymentId, {
        signal,
        isRegistered: (id) => registrations.current.includes(id),
        connectPairing: onConnectPairing,
        openProject: onOpenSandbox,
      });
      signal.throwIfAborted();
      dispatch({ type: "attachment", attachment: { status: "succeeded" } });
      handleOpenChange(false);
    } catch (error) {
      if (!signal.aborted)
        dispatch({
          type: "attachment",
          attachment: { status: "failed", error: errorMessage(error) },
        });
    }
  };

  const observe = async (operationId: string) => {
    observation.current?.abort();
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, dialogSession.current.signal]);
    if (signal.aborted) return;
    observation.current = controller;
    setObservationStopped(false);
    setReconnecting(false);
    try {
      const receipt = await pollSandboxOperation(operationId, {
        signal,
        onReceipt: (receipt) => dispatch({ type: "operation", operation: operationView(receipt) }),
        onReconnecting: setReconnecting,
      });
      if (receipt.status === "Succeeded" && receipt.deploymentId !== undefined)
        await attach(receipt.deploymentId, signal);
      else await refreshSandboxList();
    } catch (error) {
      if (!signal.aborted) {
        setReconnecting(false);
        setObservationStopped(true);
        showError(error);
      }
    }
  };

  const resume = (receipt: SandboxOperationReceipt) => {
    dispatch({
      type: "choose-docker",
      docker: createInitialDockerDraft({ serverVersion, providerInstanceId: firstProviderId }),
    });
    dispatch({ type: "operation", operation: operationView(receipt) });
    void observe(receipt.operationId);
  };

  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  useEffect(() => {
    if (
      !open ||
      state.step !== "choice" ||
      sandboxList === null ||
      !isCurrentSandboxList(listSession.current, dialogSession.current.signal)
    )
      return;
    const { automatic } = discoverSandboxCreates(sandboxList, registeredEnvironmentIds);
    if (automatic !== undefined) resumeRef.current(automatic);
  }, [open, state.step, sandboxList, registeredEnvironmentIds]);

  const retryFailedOperation = async () => {
    if (state.step !== "docker" || state.operation?.status !== "Failed") return;
    const signal = dialogSession.current.signal;
    setIsSubmitting(true);
    try {
      const accepted = await retrySandboxDeployment(state.operation.operationId);
      signal.throwIfAborted();
      dispatch({
        type: "operation",
        operation: { operationId: accepted.operationId, status: "Accepted" },
      });
      await observe(accepted.operationId);
    } catch (error) {
      if (!signal.aborted) showError(error);
    } finally {
      if (signal === dialogSession.current.signal) setIsSubmitting(false);
    }
  };

  const discard = async () => {
    const deploymentId = sandboxDiscardTarget(state);
    if (deploymentId === undefined) return;
    const signal = dialogSession.current.signal;
    setIsSubmitting(true);
    try {
      const accepted = await deleteSandboxDeployment(deploymentId);
      signal.throwIfAborted();
      const receipt = await pollSandboxOperation(accepted.operationId, { signal });
      signal.throwIfAborted();
      if (receipt.status === "Failed") throw new Error(receipt.error ?? "Sandbox discard failed.");
      dispatch({ type: "cancel-discard" });
      dispatch({
        type: "choose-docker",
        docker: createInitialDockerDraft({ serverVersion, providerInstanceId: firstProviderId }),
      });
      await refreshSandboxList();
    } catch (error) {
      if (!signal.aborted) showError(error);
    } finally {
      if (signal === dialogSession.current.signal) setIsSubmitting(false);
    }
  };

  const createDocker = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.step !== "docker" || isSubmitting || state.operation !== null) return;
    const draft = state.draft;
    if (!draft.repository.trim() || !draft.ref.trim() || !draft.providerInstanceId.trim()) {
      showError(new Error("Select a repository, branch, and Codex provider instance."));
      return;
    }
    if (draft.imageOverride.trim() && !isOciImageDigest(draft.imageOverride.trim())) {
      showError(new Error("The custom image must be an immutable sha256 OCI digest."));
      return;
    }
    const signal = dialogSession.current.signal;
    setIsSubmitting(true);
    try {
      const accepted = await createSandboxDeployment(deploymentForm(draft), signal);
      signal.throwIfAborted();
      dispatch({
        type: "operation",
        operation: { operationId: accepted.operationId, status: "Accepted" },
      });
      await observe(accepted.operationId);
    } catch (error) {
      if (!signal.aborted) showError(error);
    } finally {
      if (signal === dialogSession.current.signal) setIsSubmitting(false);
    }
  };

  const renderResume = () => {
    const { candidates } = discoverSandboxCreates(sandboxList, registeredEnvironmentIds);
    return candidates.length === 0 ? null : (
      <section className="space-y-2" aria-label="Existing sandboxes">
        <h3 className="text-sm font-medium">Continue a sandbox</h3>
        {candidates.map(({ deployment, createReceipt }) =>
          deployment.state === "Deleted" || createReceipt === undefined ? null : (
            <Button
              key={createReceipt.operationId}
              type="button"
              variant="outline"
              onClick={() => resume(createReceipt)}
            >
              {createReceipt.status === "Succeeded" ? "Open sandbox" : "Resume sandbox"}:{" "}
              {deployment.intent.label}
            </Button>
          ),
        )}
      </section>
    );
  };

  const renderChoice = () => (
    <>
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
      {renderResume()}
    </>
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
    const recovery = sandboxList?.deployments.find(
      (summary) => summary.createReceipt?.operationId === operation?.operationId,
    )?.recovery;
    return (
      <form className="space-y-4" onSubmit={(event) => void createDocker(event)}>
        {operation ? (
          <OperationProgress operation={operation} now={elapsedNow} reconnecting={reconnecting} />
        ) : null}
        {state.attachment ? <AttachmentResult attachment={state.attachment} /> : null}
        {operation === null ? (
          <>
            {renderResume()}
            {dockerDiagnostic ? <ErrorText>{dockerDiagnostic}</ErrorText> : null}
            <DockerCreateFields
              draft={state.draft}
              isSubmitting={isSubmitting}
              offerSandboxImageOverride={offerSandboxImageOverride}
              codexProviders={codexProviders}
              dispatch={dispatch}
            />
          </>
        ) : null}
        {state.error ? <ErrorText>{state.error}</ErrorText> : null}
        {state.discardRequested ? (
          <div role="alertdialog" aria-label="Discard sandbox confirmation">
            <p>Discard this sandbox and delete its container? This cannot be undone.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => dispatch({ type: "cancel-discard" })}
            >
              Cancel
            </Button>
            <Button type="button" disabled={isSubmitting} onClick={() => void discard()}>
              Confirm discard
            </Button>
          </div>
        ) : null}
        {observationStopped && operation ? (
          <Button type="button" onClick={() => void observe(operation.operationId)}>
            Refresh operation
          </Button>
        ) : null}
        <DialogFooter variant="bare" className="px-0">
          <BackButton
            disabled={isBusy}
            onClick={() =>
              observationStopped ? handleOpenChange(false) : dispatch({ type: "back" })
            }
          />
          {operation?.status === "Failed" ? (
            <>
              <Button
                type="button"
                disabled={isSubmitting}
                onClick={() =>
                  recovery === "reconcile" ? void refreshSandboxList() : void retryFailedOperation()
                }
              >
                {recovery === "reconcile" ? "Reconcile sandbox" : "Try again"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => dispatch({ type: "request-discard" })}
              >
                Discard sandbox
              </Button>
            </>
          ) : null}
          {operation?.status === "Succeeded" &&
          state.attachment?.status !== "pending" &&
          operation.deploymentId ? (
            <Button
              type="button"
              onClick={() => {
                if (operation.deploymentId) void attach(operation.deploymentId);
              }}
            >
              Open sandbox
            </Button>
          ) : null}
          {operation === null ? (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating…" : "Create sandbox"}
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

export function DockerCreateFields({
  draft,
  isSubmitting,
  offerSandboxImageOverride,
  codexProviders,
  dispatch,
}: {
  readonly draft: DockerDraft;
  readonly isSubmitting: boolean;
  readonly offerSandboxImageOverride: boolean;
  readonly codexProviders: ReadonlyArray<{
    readonly instanceId: string;
    readonly displayName?: string | undefined;
  }>;
  readonly dispatch: (action: AddEnvironmentAction) => void;
}) {
  return (
    <>
      {" "}
      <SandboxGitHubSourcePicker
        idPrefix="add-environment-docker-source"
        repository={draft.repository}
        ref={draft.ref}
        disabled={isSubmitting}
        onRepositoryChange={(repository) =>
          dispatch({ type: "set-docker", field: "repository", value: repository })
        }
        onRefChange={(ref) => dispatch({ type: "set-docker", field: "ref", value: ref })}
      />
      <Field label="Codex provider instance">
        <select
          aria-label="Codex provider instance"
          className="h-8.5 w-full rounded-lg border border-input bg-background px-2 text-sm"
          value={draft.providerInstanceId}
          disabled={isSubmitting}
          onChange={(event) =>
            dispatch({ type: "set-docker", field: "providerInstanceId", value: event.target.value })
          }
        >
          <option value="">Select a Codex provider</option>
          {codexProviders.map((provider) => (
            <option key={provider.instanceId} value={provider.instanceId}>
              {provider.displayName ?? provider.instanceId}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Label (optional)">
        <Input
          aria-label="Label (optional)"
          value={draft.label}
          placeholder={draft.repository.split("/").at(-1) || "Repository name"}
          onChange={(event) =>
            dispatch({ type: "set-docker", field: "label", value: event.target.value })
          }
        />
      </Field>
      <details open={offerSandboxImageOverride || undefined} className="space-y-3">
        <summary className="cursor-pointer text-sm">Advanced</summary>
        <Field label="Manual ref">
          <Input
            aria-label="Manual ref"
            value={draft.ref}
            onChange={(event) =>
              dispatch({ type: "set-docker", field: "ref", value: event.target.value })
            }
          />
        </Field>
        <Field label="Docker socket">
          <Input
            aria-label="Docker socket"
            value={draft.socketPath}
            onChange={(event) =>
              dispatch({ type: "set-docker", field: "socketPath", value: event.target.value })
            }
          />
        </Field>
        <Field label="Custom image">
          <Input
            aria-label="Custom image"
            value={draft.imageOverride}
            placeholder="registry/image@sha256:…"
            onChange={(event) =>
              dispatch({ type: "set-docker", field: "imageOverride", value: event.target.value })
            }
          />
        </Field>
      </details>
    </>
  );
}

export function OperationProgress({
  operation,
  now,
  reconnecting,
}: {
  readonly operation: NonNullable<
    Extract<AddEnvironmentState, { readonly step: "docker" }>["operation"]
  >;
  readonly now: number;
  readonly reconnecting: boolean;
}) {
  const seconds = Math.max(
    0,
    Math.floor((now - Date.parse(operation.acceptedAt ?? new Date(now).toISOString())) / 1000),
  );
  return (
    <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2" role="status">
      <p>
        {reconnecting ? "Reconnecting… " : ""}
        {formatSandboxProgress(operation.progress)}
      </p>
      <p className="text-xs text-muted-foreground">
        {Math.floor(seconds / 60)}m {seconds % 60}s elapsed
      </p>
      {operation.progress?.stage === "failed" ? (
        <ErrorText>{operation.progress.diagnostic}</ErrorText>
      ) : operation.error ? (
        <ErrorText>{operation.error}</ErrorText>
      ) : null}
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
