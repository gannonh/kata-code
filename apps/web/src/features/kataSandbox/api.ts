import * as Schema from "effect/Schema";

import {
  SandboxListResponse as SandboxListResponseSchema,
  SandboxOperationResponse as SandboxOperationResponseSchema,
  type SandboxListResponse as SandboxListResponseContract,
} from "@kata-sh/code-kata-sandbox-contracts/http";
import {
  SandboxHandoff as SandboxHandoffSchema,
  type SandboxHandoff as SandboxHandoffContract,
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

const decodeSandboxListResponse = Schema.decodeUnknownSync(SandboxListResponseSchema);
const decodeSandboxOperationResponse = Schema.decodeUnknownSync(SandboxOperationResponseSchema);

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
    throw new Error("The sandbox operation receipt is invalid.");
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
