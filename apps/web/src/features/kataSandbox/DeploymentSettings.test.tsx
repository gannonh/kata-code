import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSandboxDeployment,
  fetchSandboxGitHubBranches,
  fetchSandboxGitHubRepositories,
  fetchSandboxOperation,
  fetchSandboxList,
  mintSandboxHandoff,
  pollSandboxOperation,
  upsertSandboxProfile,
} from "./api";

describe("Docker sandbox Settings API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads profiles and deployments from the primary sandbox endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        profiles: [
          {
            kind: "available",
            profile: {
              profileId: "local",
              name: "Local Docker",
              driverKind: "docker",
              socketPath: "/var/run/docker.sock",
              imageDigest: "ghcr.io/kata-sh/sandbox@sha256:" + "a".repeat(64),
              enabled: true,
              revision: 1,
              createdAt: "2026-08-30T00:00:00.000Z",
              updatedAt: "2026-08-30T00:00:00.000Z",
            },
          },
        ],
        providers: [],
        deployments: [
          {
            deployment: {
              state: "Deleted",
              revision: 3,
              deploymentId: "deployment-1",
              profileId: "local",
              deletedAt: "2026-08-30T00:00:00.000Z",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSandboxList();

    expect(result.profiles[0]?.profile.name).toBe("Local Docker");
    expect(result.deployments[0]?.deployment).toMatchObject({
      state: "Deleted",
      deploymentId: "deployment-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/kata-sandbox"),
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("loads decoded GitHub repository and branch metadata", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          repositories: [
            {
              nameWithOwner: "gannonh/private-repository",
              visibility: "private",
              defaultBranch: "main",
            },
          ],
          page: 2,
          hasMore: true,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ branches: ["main", "release/private"], page: 1, hasMore: false }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchSandboxGitHubRepositories(2)).resolves.toMatchObject({
      repositories: [{ visibility: "private" }],
      hasMore: true,
    });
    await expect(
      fetchSandboxGitHubBranches({ repository: "gannonh/private-repository", page: 1 }),
    ).resolves.toMatchObject({ branches: ["main", "release/private"] });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/api/kata-sandbox/github/repositories?page=2"),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining(
        "/api/kata-sandbox/github/branches?repository=gannonh%2Fprivate-repository&page=1",
      ),
      expect.anything(),
    );
  });

  it("rejects malformed GitHub metadata at the HTTP boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          repositories: [{ nameWithOwner: "missing/default-branch", visibility: "private" }],
          page: 1,
          hasMore: false,
        }),
      ),
    );

    await expect(fetchSandboxGitHubRepositories(1)).rejects.toThrow(
      "The GitHub repository response is invalid.",
    );
  });

  it("submits a profile, polls a receipt, and requests a handoff", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          operationId: "profile-operation",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          receipt: {
            operationId: "profile-operation",
            requestId: "request-1",
            command: "profile-upsert",
            payloadHash: "a".repeat(64),
            status: "Succeeded",
            acceptedAt: "2026-08-30T00:00:00.000Z",
            updatedAt: "2026-08-30T00:00:01.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(Response.json({ operationId: "operation-1" }))
      .mockResolvedValueOnce(
        Response.json({
          receipt: {
            operationId: "operation-1",
            requestId: "request-1",
            command: "create",
            payloadHash: "b".repeat(64),
            status: "Running",
            acceptedAt: "2026-08-30T00:00:00.000Z",
            updatedAt: "2026-08-30T00:00:01.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          receipt: {
            operationId: "operation-1",
            requestId: "request-1",
            command: "create",
            payloadHash: "b".repeat(64),
            status: "Succeeded",
            deploymentId: "deployment-1",
            acceptedAt: "2026-08-30T00:00:00.000Z",
            updatedAt: "2026-08-30T00:00:02.000Z",
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          deploymentId: "deployment-1",
          pairingUrl: "http://127.0.0.1:3773/pair?token=one-use",
          environmentId: "sandbox-env",
          endpoint: "http://127.0.0.1:3773",
          attachment: "direct",
          workspaceRoot: "/workspace",
          expiresAt: "2026-08-30T00:05:00.000Z",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const profileAccepted = await upsertSandboxProfile({
      name: "Local Docker",
      socketPath: "/var/run/docker.sock",
      image: { kind: "custom", digest: "ghcr.io/kata-sh/sandbox@sha256:" + "b".repeat(64) },
      enabled: true,
    });
    const profileReceipt = await pollSandboxOperation(profileAccepted.operationId, {
      intervalMs: 0,
      wait: async () => undefined,
    });
    const accepted = await createSandboxDeployment({
      profileId: "local",
      label: "Issue 159",
      repository: "gannonh/kata-code",
      ref: "refs/pull/171/head",
      providerInstanceId: "codex",
    });
    const receipt = await pollSandboxOperation("operation-1", {
      intervalMs: 0,
      wait: async () => undefined,
    });
    const handoff = await mintSandboxHandoff("deployment-1");

    expect(profileReceipt.status).toBe("Succeeded");
    expect(accepted.operationId).toBe("operation-1");
    expect(receipt.status).toBe("Succeeded");
    expect(handoff.pairingUrl).toContain("one-use");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/api/kata-sandbox/profiles"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("/api/kata-sandbox/deployments"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"repository":"gannonh/kata-code"'),
      }),
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain('"ref":"refs/pull/171/head"');
    expect(fetchMock).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining("/api/kata-sandbox/deployments/deployment-1/handoff"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects malformed operation receipts at the HTTP boundary", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ receipt: { operationId: "operation-1", status: "Running" } }),
        ),
    );

    await expect(fetchSandboxOperation("operation-1")).rejects.toThrow(
      "The sandbox operation response is invalid.",
    );
  });
});
