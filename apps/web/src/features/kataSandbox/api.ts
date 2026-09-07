import * as Schema from "effect/Schema";

import {
  SandboxGitHubBranchPage as SandboxGitHubBranchPageSchema,
  SandboxGitHubRepositoryPage as SandboxGitHubRepositoryPageSchema,
  SandboxListResponse as SandboxListResponseSchema,
  SandboxOperationResponse as SandboxOperationResponseSchema,
  type SandboxGitHubBranchPage,
  type SandboxGitHubRepositoryPage,
  type SandboxListResponse as SandboxListResponseContract,
} from "@kata-sh/code-kata-sandbox-contracts/http";
import {
  SandboxHandoff as SandboxHandoffSchema,
  type SandboxHandoff as SandboxHandoffContract,
  type SandboxImageInput,
  type SandboxOperationReceipt as SandboxOperationReceiptContract,
} from "@kata-sh/code-kata-sandbox-contracts/domain";
import { readDesktopPrimaryBearerToken } from "~/environments/primary/desktopAuth";
import { resolvePrimaryEnvironmentHttpUrl } from "~/environments/primary/target";
import { randomUUID } from "~/lib/utils";

export type SandboxListResponse = SandboxListResponseContract;

export type SandboxOperationReceipt = SandboxOperationReceiptContract;

export type SandboxHandoff = SandboxHandoffContract;

export type SandboxProfileForm = {
  readonly profileId?: string;
  readonly expectedRevision?: number;
  readonly name: string;
  readonly socketPath: string;
  readonly image: SandboxImageInput;
  readonly enabled: boolean;
};

export type SandboxDeploymentForm = {
  readonly image: SandboxImageInput;
  readonly socketPath: string;
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

export function isHostSandboxClient(): boolean {
  if (typeof window === "undefined") return false;
  if (window.desktopBridge !== undefined) return true;
  if (!window.location.origin.startsWith("http")) return false;
  return new URL(resolvePrimaryEnvironmentHttpUrl("/")).origin === window.location.origin;
}

function shouldIncludePrimaryCookies(requestUrl: string): boolean {
  if (
    typeof window === "undefined" ||
    window.desktopBridge !== undefined ||
    !window.location.origin.startsWith("http")
  ) {
    return false;
  }

  return new URL(requestUrl).origin === window.location.origin;
}

const decodeSandboxListResponse = Schema.decodeUnknownSync(SandboxListResponseSchema);
const decodeSandboxOperationResponse = Schema.decodeUnknownSync(SandboxOperationResponseSchema);
const decodeSandboxGitHubRepositoryPage = Schema.decodeUnknownSync(
  SandboxGitHubRepositoryPageSchema,
);
const decodeSandboxGitHubBranchPage = Schema.decodeUnknownSync(SandboxGitHubBranchPageSchema);

function decodeListResponse(value: unknown): SandboxListResponse {
  try {
    return decodeSandboxListResponse(value);
  } catch {
    throw new Error("The sandbox list response is invalid.");
  }
}

function decodeOperationReceipt(value: unknown): SandboxOperationReceipt {
  try {
    return decodeSandboxOperationResponse(value).receipt;
  } catch {
    throw new Error("The sandbox operation response is invalid.");
  }
}

function decodeGitHubRepositoryPage(value: unknown): SandboxGitHubRepositoryPage {
  try {
    return decodeSandboxGitHubRepositoryPage(value);
  } catch {
    throw new Error("The GitHub repository response is invalid.");
  }
}

function decodeGitHubBranchPage(value: unknown): SandboxGitHubBranchPage {
  try {
    return decodeSandboxGitHubBranchPage(value);
  } catch {
    throw new Error("The GitHub branch response is invalid.");
  }
}

const decodeSandboxHandoff = Schema.decodeUnknownSync(SandboxHandoffSchema);

function decodeHandoff(value: unknown): SandboxHandoff {
  try {
    return decodeSandboxHandoff(value);
  } catch {
    throw new Error("The sandbox handoff response is invalid.");
  }
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
    credentials: shouldIncludePrimaryCookies(requestUrl) ? "include" : "omit",
    headers,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(body) && isString(body.message) ? body.message : "Sandbox request failed.";
    throw new SandboxApiError(message, response.status);
  }

  init?.signal?.throwIfAborted();
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

export function fetchSandboxList(signal?: AbortSignal): Promise<SandboxListResponse> {
  return request(
    "/api/kata-sandbox",
    signal === undefined ? undefined : { signal },
    decodeListResponse,
  );
}

export function fetchSandboxGitHubRepositories(page: number): Promise<SandboxGitHubRepositoryPage> {
  const query = new URLSearchParams({ page: String(page) });
  return request(
    `/api/kata-sandbox/github/repositories?${query.toString()}`,
    undefined,
    decodeGitHubRepositoryPage,
  );
}

export function fetchSandboxGitHubBranches(input: {
  readonly repository: string;
  readonly page: number;
}): Promise<SandboxGitHubBranchPage> {
  const query = new URLSearchParams({
    repository: input.repository,
    page: String(input.page),
  });
  return request(
    `/api/kata-sandbox/github/branches?${query.toString()}`,
    undefined,
    decodeGitHubBranchPage,
  );
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
      image: input.image,
      enabled: input.enabled,
      ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
    }),
    decodeAccepted,
  );
}

export function createSandboxDeployment(
  input: SandboxDeploymentForm,
  signal?: AbortSignal,
): Promise<{ readonly operationId: string }> {
  const requestId = createSandboxRequestId();
  return request(
    "/api/kata-sandbox/deployments",
    {
      ...jsonRequest({
        requestId,
        kind: "new",
        image: input.image,
        socketPath: input.socketPath.trim() || undefined,
        label: input.label.trim(),
        source: {
          repository: input.repository.trim(),
          ref: input.ref.trim(),
        },
        providerInstanceId: input.providerInstanceId.trim(),
      }),
      ...(signal === undefined ? {} : { signal }),
    },
    decodeAccepted,
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

export function startSandboxDeployment(
  deploymentId: string,
  expectedRevision: number,
  attachment: "direct" | "relay",
): Promise<{ readonly operationId: string }> {
  return request(
    "/api/kata-sandbox/deployments/start",
    jsonRequest({
      requestId: createSandboxRequestId(),
      deploymentId,
      expectedRevision,
      attachment,
    }),
    decodeAccepted,
  );
}

export function stopSandboxDeployment(
  deploymentId: string,
  expectedRevision: number,
): Promise<{ readonly operationId: string }> {
  return request(
    "/api/kata-sandbox/deployments/stop",
    jsonRequest({
      requestId: createSandboxRequestId(),
      deploymentId,
      expectedRevision,
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

export function retrySandboxDeployment(
  previousOperationId: string,
): Promise<{ readonly operationId: string }> {
  return request(
    "/api/kata-sandbox/deployments",
    jsonRequest({ kind: "retry", requestId: createSandboxRequestId(), previousOperationId }),
    decodeAccepted,
  );
}

export async function pollSandboxOperation(
  operationId: string,
  options: {
    readonly wait?: (intervalMs: number) => Promise<void>;
    readonly now?: () => number;
    readonly signal?: AbortSignal;
    readonly onReceipt?: (receipt: SandboxOperationReceipt) => void;
    readonly onReconnecting?: (reconnecting: boolean) => void;
  } = {},
): Promise<SandboxOperationReceipt> {
  const now = options.now ?? Date.now;
  let acceptedAt = now();
  const wait =
    options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (;;) {
    options.signal?.throwIfAborted();
    try {
      let receipt: SandboxOperationReceipt;
      try {
        receipt = await fetchSandboxOperation(operationId);
      } catch (error) {
        if (!(error instanceof SandboxApiError) || error.status !== 404) throw error;
        const listed = await fetchSandboxList();
        const recovered = listed.deployments
          .map((summary) => summary.createReceipt)
          .find(
            (candidate) =>
              candidate?.operationId === operationId ||
              candidate?.previousOperationId === operationId,
          );
        if (recovered === undefined)
          throw new SandboxApiError(
            "This sandbox operation is no longer available. Reopen Add environment to choose an existing sandbox or create one.",
            404,
          );
        receipt = recovered;
        operationId = receipt.operationId;
      }
      options.signal?.throwIfAborted();
      acceptedAt = Date.parse(receipt.acceptedAt);
      options.onReconnecting?.(false);
      options.onReceipt?.(receipt);
      if (receipt.status === "Succeeded" || receipt.status === "Failed") return receipt;
    } catch (error) {
      options.signal?.throwIfAborted();
      const transient =
        error instanceof TypeError ||
        (error instanceof SandboxApiError &&
          (error.status >= 500 || error.status === 408 || error.status === 429));
      if (!transient) {
        options.onReconnecting?.(false);
        throw error;
      }
      options.onReconnecting?.(true);
    }
    await wait(now() - acceptedAt < 60_000 ? 1_000 : 5_000);
  }
}

export function mintSandboxHandoff(
  deploymentId: string,
): Promise<Extract<SandboxHandoff, { attachment: "direct" }>> {
  return request(
    `/api/kata-sandbox/deployments/${encodeURIComponent(deploymentId)}/handoff`,
    { method: "POST" },
    decodeHandoff,
  ).then((handoff) => {
    if (handoff.attachment !== "direct") {
      throw new Error("The sandbox returned a relay handoff for a direct request.");
    }
    return handoff;
  });
}

export function mintSandboxRelayHandoff(
  deploymentId: string,
): Promise<Extract<SandboxHandoff, { attachment: "relay" }>> {
  return request(
    `/api/kata-sandbox/deployments/${encodeURIComponent(deploymentId)}/handoff/relay`,
    { method: "POST" },
    decodeHandoff,
  ).then((handoff) => {
    if (handoff.attachment !== "relay") {
      throw new Error("The sandbox returned a direct handoff for a relay request.");
    }
    return handoff;
  });
}
