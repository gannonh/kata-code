import type {
  SandboxImageChannel,
  SandboxOperationProgress,
  SandboxProviderDescriptor,
} from "@kata-sh/code-kata-sandbox-contracts/domain";

export type AddEnvironmentChoice = "remote" | "ssh" | "sandbox";

export type DockerProfileMode = "existing" | "new";
export type DockerDraftField =
  | "profileId"
  | "profileName"
  | "socketPath"
  | "imageChannel"
  | "imageVersion"
  | "imageOverride"
  | "label"
  | "repository"
  | "ref"
  | "providerInstanceId";

export interface DockerDraft {
  readonly profileId: string;
  readonly profileMode: DockerProfileMode;
  readonly profileName: string;
  readonly socketPath: string;
  readonly imageChannel: SandboxImageChannel;
  readonly imageVersion: string;
  readonly imageOverride: string;
  readonly label: string;
  readonly repository: string;
  readonly ref: string;
  readonly providerInstanceId: string;
}

export type SandboxOperationPhase = "profile" | "deployment";
export type SandboxOperationStatus = "Accepted" | "Running" | "Succeeded" | "Failed";

export interface SandboxOperationView {
  readonly phase: SandboxOperationPhase;
  readonly operationId: string;
  readonly status: SandboxOperationStatus;
  readonly progress?: SandboxOperationProgress;
  readonly stage?: string;
  readonly error?: string;
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
  | { readonly type: "select-profile"; readonly profileId: string }
  | { readonly type: "new-profile" }
  | { readonly type: "operation"; readonly operation: SandboxOperationView }
  | { readonly type: "retry" }
  | { readonly type: "attachment"; readonly attachment: AttachmentView }
  | { readonly type: "error"; readonly error: string | null };

export function createInitialDockerDraft(input: {
  readonly serverVersion: string;
  readonly providerInstanceId?: string | undefined;
}): DockerDraft {
  return {
    profileId: "",
    profileMode: "existing",
    profileName: "",
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
    case "select-profile":
      return state.step !== "docker"
        ? state
        : {
            ...state,
            draft: { ...state.draft, profileId: action.profileId, profileMode: "existing" },
            error: null,
          };
    case "new-profile":
      return state.step !== "docker"
        ? state
        : {
            ...state,
            draft: { ...state.draft, profileId: "", profileMode: "new" },
            error: null,
          };
    case "operation":
      return state.step !== "docker"
        ? state
        : { ...state, operation: action.operation, error: null };
    case "retry":
      return state.step !== "docker" || state.operation?.status !== "Failed"
        ? state
        : { ...state, operation: null, attachment: null, error: null };
    case "attachment":
      return state.step !== "docker" ? state : { ...state, attachment: action.attachment };
    case "error":
      return state.step === "choice" ? state : { ...state, error: action.error };
  }
}

export function dockerDraftWithProfile(
  state: Extract<AddEnvironmentState, { readonly step: "docker" }>,
  profileId: string,
): Extract<AddEnvironmentState, { readonly step: "docker" }> {
  return addEnvironmentReducer(state, { type: "select-profile", profileId }) as Extract<
    AddEnvironmentState,
    { readonly step: "docker" }
  >;
}
