import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";
import { randomUUID } from "~/lib/utils";

export type SandboxProfile = {
  readonly profileId: string;
  readonly name: string;
  readonly driverKind: "docker";
  readonly socketPath: string;
  readonly imageDigest: string;
  readonly enabled: boolean;
  readonly revision: number;
};

export type SandboxProfileSummary =
  | {
      readonly kind: "available";
      readonly profile: SandboxProfile;
      readonly daemonVersion?: string;
    }
  | {
      readonly kind: "unavailable";
      readonly profile: SandboxProfile;
      readonly reason: string;
      readonly diagnostic: string;
    };

export type SandboxDeploymentState = "Requested" | "Allocated" | "Identified" | "Deleted";

export type SandboxDeployment = {
  readonly state: SandboxDeploymentState;
  readonly revision: number;
  readonly deploymentId: string;
  readonly label?: string;
  readonly repository?: string;
  readonly ref?: string;
  readonly providerInstanceId?: string;
  readonly environmentId?: string;
  readonly endpoint?: string;
};

export type SandboxObservation = {
  readonly state: "Running" | "Unknown" | "Gone";
  readonly diagnostic?: string;
};

export type SandboxDeploymentSummary = {
  readonly deployment: SandboxDeployment;
  readonly observation?: SandboxObservation;
};

export type SandboxListResponse = {
  readonly profiles: ReadonlyArray<SandboxProfileSummary>;
  readonly deployments: ReadonlyArray<SandboxDeploymentSummary>;
};

export type SandboxOperationReceipt = {
  readonly operationId: string;
  readonly requestId: string;
  readonly command: string;
  readonly status: "Accepted" | "Running" | "Succeeded" | "Failed";
  readonly error?: string;
  readonly deploymentId?: string;
};

export type SandboxHandoff = {
  readonly pairingUrl: string;
  readonly environmentId?: string;
  readonly endpoint?: string;
};

export type SandboxProfileForm = {
  readonly profileId?: string;
  readonly expectedRevision?: number;
  readonly name: string;
  readonly socketPath: string;
  readonly imageDigest: string;
  readonly enabled: boolean;
};

export type SandboxDeploymentForm = {
  readonly profileId: string;
  readonly label: string;
  readonly repository: string;
  readonly ref: string;
  readonly providerInstanceId: string;
};

export class SandboxApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SandboxApiError";
    this.status = status;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isString = (value: unknown): value is string => typeof value === "string";

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function decodeProfile(value: unknown): SandboxProfile {
  if (
    !isRecord(value) ||
    !isString(value.profileId) ||
    !isString(value.name) ||
    value.driverKind !== "docker" ||
    !isString(value.socketPath) ||
    !isString(value.imageDigest) ||
    typeof value.enabled !== "boolean" ||
    !isNumber(value.revision)
  ) {
    throw new Error("The sandbox profile response is invalid.");
  }

  return {
    profileId: value.profileId,
    name: value.name,
    driverKind: value.driverKind,
    socketPath: value.socketPath,
    imageDigest: value.imageDigest,
    enabled: value.enabled,
    revision: value.revision,
  };
}

function decodeProfileSummary(value: unknown): SandboxProfileSummary {
  if (!isRecord(value) || (value.kind !== "available" && value.kind !== "unavailable")) {
    throw new Error("The sandbox profile summary response is invalid.");
  }

  const profile = decodeProfile(value.profile);
  if (value.kind === "available") {
    return {
      kind: value.kind,
      profile,
      ...(isString(value.daemonVersion) ? { daemonVersion: value.daemonVersion } : {}),
    };
  }

  if (!isString(value.reason) || !isString(value.diagnostic)) {
    throw new Error("The unavailable sandbox profile response is invalid.");
  }

  return {
    kind: value.kind,
    profile,
    reason: value.reason,
    diagnostic: value.diagnostic,
  };
}

function decodeDeployment(value: unknown): SandboxDeployment {
  if (!isRecord(value) || !isString(value.state) || !isNumber(value.revision)) {
    throw new Error("The sandbox deployment response is invalid.");
  }

  if (
    value.state !== "Requested" &&
    value.state !== "Allocated" &&
    value.state !== "Identified" &&
    value.state !== "Deleted"
  ) {
    throw new Error("The sandbox deployment state is invalid.");
  }

  const intent = isRecord(value.intent) ? value.intent : null;
  const deploymentId = isString(value.deploymentId)
    ? value.deploymentId
    : intent && isString(intent.deploymentId)
      ? intent.deploymentId
      : null;
  if (deploymentId === null) {
    throw new Error("The sandbox deployment id is missing.");
  }

  const source = intent && isRecord(intent.source) ? intent.source : null;
  return {
    state: value.state,
    revision: value.revision,
    deploymentId,
    ...(intent && isString(intent.label) ? { label: intent.label } : {}),
    ...(source && isString(source.repository) ? { repository: source.repository } : {}),
    ...(source && isString(source.ref) ? { ref: source.ref } : {}),
    ...(intent && isString(intent.providerInstanceId)
      ? { providerInstanceId: intent.providerInstanceId }
      : {}),
    ...(isString(value.environmentId) ? { environmentId: value.environmentId } : {}),
    ...(isString(value.endpoint) ? { endpoint: value.endpoint } : {}),
  };
}

function decodeObservation(value: unknown): SandboxObservation {
  if (
    !isRecord(value) ||
    (value.state !== "Running" && value.state !== "Unknown" && value.state !== "Gone")
  ) {
    throw new Error("The sandbox observation response is invalid.");
  }

  return {
    state: value.state,
    ...(isString(value.diagnostic) ? { diagnostic: value.diagnostic } : {}),
  };
}

function decodeListResponse(value: unknown): SandboxListResponse {
  if (!isRecord(value) || !Array.isArray(value.profiles) || !Array.isArray(value.deployments)) {
    throw new Error("The sandbox list response is invalid.");
  }

  return {
    profiles: value.profiles.map(decodeProfileSummary),
    deployments: value.deployments.map((entry) => {
      if (!isRecord(entry) || !("deployment" in entry)) {
        throw new Error("The sandbox deployment summary response is invalid.");
      }

      return {
        deployment: decodeDeployment(entry.deployment),
        ...(entry.observation === undefined
          ? {}
          : { observation: decodeObservation(entry.observation) }),
      };
    }),
  };
}

function decodeOperationReceipt(value: unknown): SandboxOperationReceipt {
  if (!isRecord(value) || !isRecord(value.receipt)) {
    throw new Error("The sandbox operation response is invalid.");
  }

  const receipt = value.receipt;
  if (
    !isString(receipt.operationId) ||
    !isString(receipt.requestId) ||
    !isString(receipt.command) ||
    !isString(receipt.status) ||
    (receipt.status !== "Accepted" &&
      receipt.status !== "Running" &&
      receipt.status !== "Succeeded" &&
      receipt.status !== "Failed")
  ) {
    throw new Error("The sandbox operation receipt is invalid.");
  }

  return {
    operationId: receipt.operationId,
    requestId: receipt.requestId,
    command: receipt.command,
    status: receipt.status,
    ...(isString(receipt.error) ? { error: receipt.error } : {}),
    ...(isString(receipt.deploymentId) ? { deploymentId: receipt.deploymentId } : {}),
  };
}

function decodeHandoff(value: unknown): SandboxHandoff {
  if (!isRecord(value) || !isString(value.pairingUrl)) {
    throw new Error("The sandbox handoff response is invalid.");
  }

  return {
    pairingUrl: value.pairingUrl,
    ...(isString(value.environmentId) ? { environmentId: value.environmentId } : {}),
    ...(isString(value.endpoint) ? { endpoint: value.endpoint } : {}),
  };
}

async function request<T>(
  path: string,
  init: RequestInit | undefined,
  decode: (value: unknown) => T,
): Promise<T> {
  const bearerToken = await readDesktopPrimaryBearerToken();
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (bearerToken) {
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }

  const requestUrl = typeof window === "undefined" ? path : resolvePrimaryEnvironmentHttpUrl(path);
  const response = await fetch(requestUrl, {
    ...init,
    credentials: "include",
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(body) && isString(body.message) ? body.message : "Sandbox request failed.";
    throw new SandboxApiError(message, response.status);
  }

  return decode(body);
}

function jsonRequest(body: unknown): RequestInit {
  return {
    method: "POST",
    body: JSON.stringify(body),
  };
}

export function createSandboxRequestId(): string {
  return randomUUID();
}

export function fetchSandboxList(): Promise<SandboxListResponse> {
  return request("/api/kata-sandbox", undefined, decodeListResponse);
}

export function upsertSandboxProfile(
  input: SandboxProfileForm,
): Promise<{ readonly operationId: string }> {
  return request(
    "/api/kata-sandbox/profiles",
    jsonRequest({
      requestId: createSandboxRequestId(),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      name: input.name.trim(),
      driverKind: "docker",
      socketPath: input.socketPath.trim() || undefined,
      imageDigest: input.imageDigest.trim(),
      enabled: input.enabled,
      ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
    }),
    decodeAccepted,
  );
}

export function createSandboxDeployment(
  input: SandboxDeploymentForm,
): Promise<{ readonly operationId: string }> {
  const requestId = createSandboxRequestId();
  return request(
    "/api/kata-sandbox/deployments",
    jsonRequest({
      requestId,
      profileId: input.profileId,
      label: input.label.trim(),
      source: {
        repository: input.repository.trim(),
        ref: input.ref.trim(),
      },
      providerInstanceId: input.providerInstanceId.trim(),
    }),
    (value) => {
      if (!isRecord(value) || !isString(value.operationId)) {
        throw new Error("The sandbox create response is invalid.");
      }
      return { operationId: value.operationId };
    },
  );
}

function decodeAccepted(value: unknown): { readonly operationId: string } {
  if (!isRecord(value) || !isString(value.operationId)) {
    throw new Error("The sandbox accepted response is invalid.");
  }
  return { operationId: value.operationId };
}

export function deleteSandboxProfile(
  profileId: string,
  expectedRevision?: number,
): Promise<{ readonly operationId: string }> {
  return request(
    "/api/kata-sandbox/profiles/delete",
    jsonRequest({
      requestId: createSandboxRequestId(),
      profileId,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }),
    decodeAccepted,
  );
}

export function deleteSandboxDeployment(
  deploymentId: string,
  expectedRevision?: number,
): Promise<{ readonly operationId: string }> {
  return request(
    "/api/kata-sandbox/deployments/delete",
    jsonRequest({
      requestId: createSandboxRequestId(),
      deploymentId,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
    }),
    decodeAccepted,
  );
}

export function fetchSandboxOperation(operationId: string): Promise<SandboxOperationReceipt> {
  return request(
    `/api/kata-sandbox/operations/${encodeURIComponent(operationId)}`,
    undefined,
    decodeOperationReceipt,
  );
}

export async function pollSandboxOperation(
  operationId: string,
  options: {
    readonly intervalMs?: number;
    readonly maxAttempts?: number;
    readonly wait?: (intervalMs: number) => Promise<void>;
  } = {},
): Promise<SandboxOperationReceipt> {
  const intervalMs = options.intervalMs ?? 1_000;
  const maxAttempts = options.maxAttempts ?? 60;
  const wait =
    options.wait ??
    ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const receipt = await fetchSandboxOperation(operationId);
    if (receipt.status === "Succeeded" || receipt.status === "Failed") {
      return receipt;
    }
    if (attempt + 1 < maxAttempts) {
      await wait(intervalMs);
    }
  }

  throw new Error("The sandbox operation did not finish in time.");
}

export function mintSandboxHandoff(deploymentId: string): Promise<SandboxHandoff> {
  return request(
    `/api/kata-sandbox/deployments/${encodeURIComponent(deploymentId)}/handoff`,
    { method: "POST" },
    decodeHandoff,
  );
}
