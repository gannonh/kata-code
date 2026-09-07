import type { EnvironmentId } from "@kata-sh/code-contracts";
import type { SandboxListResponse } from "./api";
import type {
  SandboxImageChannel,
  SandboxOperationProgress,
  SandboxProviderDescriptor,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

export type AddEnvironmentChoice = "remote" | "ssh" | "sandbox";

export type DockerDraftField =
  | "socketPath"
  | "imageChannel"
  | "imageVersion"
  | "imageOverride"
  | "label"
  | "repository"
  | "ref"
  | "providerInstanceId";

export interface DockerDraft {
  readonly socketPath: string;
  readonly imageChannel: SandboxImageChannel;
  readonly imageVersion: string;
  readonly imageOverride: string;
  readonly label: string;
  readonly repository: string;
  readonly ref: string;
  readonly providerInstanceId: string;
}

export type SandboxOperationStatus = "Accepted" | "Running" | "Succeeded" | "Failed";

export interface SandboxOperationView {
  readonly operationId: string;
  readonly status: SandboxOperationStatus;
  readonly progress?: SandboxOperationProgress;
  readonly error?: string;
  readonly acceptedAt?: string;
  readonly deploymentId?: string;
}

export type AttachmentView =
  | { readonly status: "pending" }
  | { readonly status: "succeeded" }
  | { readonly status: "failed"; readonly error: string };

export type AddEnvironmentState =
  | { readonly step: "choice" }
  | {
      readonly step: "remote";
      readonly host: string;
      readonly pairingCode: string;
      readonly error: string | null;
    }
  | {
      readonly step: "ssh";
      readonly host: string;
      readonly username: string;
      readonly port: string;
      readonly error: string | null;
    }
  | { readonly step: "sandbox-providers"; readonly error: string | null }
  | {
      readonly step: "docker";
      readonly draft: DockerDraft;
      readonly operation: SandboxOperationView | null;
      readonly attachment: AttachmentView | null;
      readonly discardRequested: boolean;
      readonly error: string | null;
    };

export type AddEnvironmentAction =
  | { readonly type: "reset"; readonly docker: DockerDraft }
  | { readonly type: "choose"; readonly choice: AddEnvironmentChoice }
  | { readonly type: "choose-docker"; readonly docker: DockerDraft }
  | { readonly type: "back" }
  | { readonly type: "set-remote"; readonly field: "host" | "pairingCode"; readonly value: string }
  | {
      readonly type: "set-ssh";
      readonly field: "host" | "username" | "port";
      readonly value: string;
    }
  | {
      readonly type: "set-docker";
      readonly field: DockerDraftField;
      readonly value: string;
    }
  | { readonly type: "operation"; readonly operation: SandboxOperationView }
  | { readonly type: "request-discard" }
  | { readonly type: "cancel-discard" }
  | { readonly type: "attachment"; readonly attachment: AttachmentView }
  | { readonly type: "error"; readonly error: string | null };

export function createInitialDockerDraft(input: {
  readonly serverVersion: string;
  readonly providerInstanceId?: string | undefined;
}): DockerDraft {
  return {
    socketPath: "/var/run/docker.sock",
    imageChannel: "stable",
    imageVersion: normalizeManagedImageVersion(input.serverVersion),
    imageOverride: "",
    label: "",
    repository: "",
    ref: "",
    providerInstanceId: input.providerInstanceId ?? "",
  };
}

export function normalizeManagedImageVersion(version: string): string {
  const normalized = version.trim().replace(/^v/u, "");
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(normalized) ? normalized : "0.0.0";
}

export function createInitialAddEnvironmentState(
  _serverVersion: string,
  _providerInstanceId?: string,
): AddEnvironmentState {
  return { step: "choice" };
}

export function groupSandboxProviders(providers: ReadonlyArray<SandboxProviderDescriptor>): {
  readonly local: ReadonlyArray<SandboxProviderDescriptor>;
  readonly cloud: ReadonlyArray<SandboxProviderDescriptor>;
} {
  return {
    local: providers.filter((provider) => provider.category === "local-container"),
    cloud: providers.filter((provider) => provider.category === "cloud-provider"),
  };
}

export function hasSandboxProviderAdvertisement(
  providers: ReadonlyArray<SandboxProviderDescriptor> | undefined,
): boolean {
  return (providers?.length ?? 0) > 0;
}

export function dockerProviderDiagnostic(
  providers: ReadonlyArray<SandboxProviderDescriptor> | undefined,
): string | undefined {
  return providers?.find((provider) => provider.driverKind === "docker")?.availabilityDiagnostic;
}

export function shouldOfferSandboxImageOverride(diagnostic: string | undefined): boolean {
  return diagnostic !== undefined && diagnostic.startsWith("Managed image for version ");
}

function remoteState(): Extract<AddEnvironmentState, { readonly step: "remote" }> {
  return { step: "remote", host: "", pairingCode: "", error: null };
}

function sshState(): Extract<AddEnvironmentState, { readonly step: "ssh" }> {
  return { step: "ssh", host: "", username: "", port: "", error: null };
}

export function addEnvironmentReducer(
  state: AddEnvironmentState,
  action: AddEnvironmentAction,
): AddEnvironmentState {
  switch (action.type) {
    case "reset":
      return { step: "choice" };
    case "choose":
      if (action.choice === "remote") return remoteState();
      if (action.choice === "ssh") return sshState();
      return { step: "sandbox-providers", error: null };
    case "choose-docker":
      return {
        step: "docker",
        draft: action.docker,
        operation: null,
        attachment: null,
        discardRequested: false,
        error: null,
      };
    case "back":
      if (state.step === "remote" || state.step === "ssh" || state.step === "sandbox-providers") {
        return { step: "choice" };
      }
      if (state.step === "docker") {
        const operationActive =
          state.operation !== null &&
          (state.operation.status === "Accepted" || state.operation.status === "Running");
        if (operationActive || state.attachment?.status === "pending") return state;
        return { step: "sandbox-providers", error: null };
      }
      return state;
    case "set-remote":
      return state.step !== "remote"
        ? state
        : { ...state, [action.field]: action.value, error: null };
    case "set-ssh":
      return state.step !== "ssh" ? state : { ...state, [action.field]: action.value, error: null };
    case "set-docker":
      if (state.step !== "docker") return state;
      return {
        ...state,
        draft: {
          ...state.draft,
          [action.field]:
            action.field === "imageChannel" ? (action.value as SandboxImageChannel) : action.value,
        } as DockerDraft,
        error: null,
      };
    case "operation":
      return state.step !== "docker"
        ? state
        : { ...state, operation: action.operation, error: null };
    case "request-discard":
      return state.step === "docker" && state.operation?.status === "Failed"
        ? { ...state, discardRequested: true }
        : state;
    case "cancel-discard":
      return state.step === "docker" ? { ...state, discardRequested: false } : state;
    case "attachment":
      return state.step !== "docker" ? state : { ...state, attachment: action.attachment };
    case "error":
      return state.step === "choice" ? state : { ...state, error: action.error };
  }
}

export function formatSandboxProgress(progress: SandboxOperationProgress | undefined): string {
  if (progress === undefined) return "Preparing sandbox";
  const labels = {
    "resolving-image": "Resolving image",
    "pulling-image": "Pulling image",
    "validating-image": "Validating image",
    "creating-container": "Creating container",
    "checking-out-source": "Checking out source",
    "starting-server": "Starting server",
    ready: "Sandbox ready",
    failed: "Create failed",
  };
  if (progress.stage === "failed")
    return `Failed while ${labels[progress.lastStage].toLowerCase()}`;
  if (progress.stage !== "pulling-image") return labels[progress.stage];
  const downloaded = progress.downloadedBytes ?? 0;
  const size = (bytes: number) =>
    `${(bytes / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;
  return progress.totalBytes !== undefined &&
    progress.totalBytes !== null &&
    progress.totalBytes > 0
    ? `Pulling image (${Math.min(100, Math.round((downloaded / progress.totalBytes) * 100))}%, ${size(downloaded)} of ${size(progress.totalBytes)})`
    : `Pulling image (${size(downloaded)})`;
}

export function discoverSandboxCreates(
  list: SandboxListResponse | null,
  registered: ReadonlyArray<EnvironmentId>,
) {
  const candidates =
    list?.deployments.filter(
      (summary) => summary.deployment.state !== "Deleted" && summary.createReceipt !== undefined,
    ) ?? [];
  const unfinished = candidates.filter(
    ({ deployment, createReceipt }) =>
      createReceipt?.status === "Accepted" ||
      createReceipt?.status === "Running" ||
      (createReceipt?.status === "Succeeded" &&
        deployment.state === "Identified" &&
        !registered.includes(deployment.environmentId)),
  );
  return {
    candidates,
    automatic: unfinished.length === 1 ? unfinished[0]?.createReceipt : undefined,
  };
}

export function sandboxDiscardTarget(state: AddEnvironmentState): string | undefined {
  return state.step === "docker" && state.discardRequested && state.operation?.status === "Failed"
    ? state.operation.deploymentId
    : undefined;
}

export function isCurrentSandboxList(
  listSignal: AbortSignal | null,
  dialogSignal: AbortSignal,
): boolean {
  return listSignal === dialogSignal && !dialogSignal.aborted;
}
