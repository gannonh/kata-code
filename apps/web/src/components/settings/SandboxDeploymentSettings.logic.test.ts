import { describe, expect, it } from "vite-plus/test";

import {
  DOCKER_SANDBOX_KIND,
  VERCEL_SANDBOX_KIND,
  buildDockerSandboxProviderInstance,
  buildVercelSandboxProviderInstance,
  formatVercelVcpusLabel,
  makeSandboxProviderInstanceId,
  parseSandboxPort,
  readVercelVcpus,
  resolveSandboxLifecycleState,
  sandboxInstanceIdForLabel,
  shouldSeedRepositoryForStart,
  slugifySandboxLabel,
} from "./SandboxDeploymentSettings.logic";

describe("sandbox deployment settings logic", () => {
  it("derives stable instance ids from environment labels", () => {
    expect(slugifySandboxLabel("My Vercel Sandbox!")).toBe("my_vercel_sandbox");
    expect(
      sandboxInstanceIdForLabel({ driver: VERCEL_SANDBOX_KIND, label: "My Vercel Sandbox!" }),
    ).toBe("vercel_my_vercel_sandbox");
    expect(sandboxInstanceIdForLabel({ driver: DOCKER_SANDBOX_KIND, label: "" })).toBe(
      "docker_default",
    );
  });

  it("rejects duplicate ids before writing sandbox settings", () => {
    expect(() =>
      makeSandboxProviderInstanceId({
        driver: DOCKER_SANDBOX_KIND,
        label: "Default",
        existingIds: new Set(["docker_default"]),
      }),
    ).toThrow("already exists");
  });

  it("validates sandbox ports for Docker environment creation", () => {
    expect(parseSandboxPort("13773")).toBe(13773);
    expect(parseSandboxPort("0")).toBeNull();
    expect(parseSandboxPort("65536")).toBeNull();
    expect(() =>
      buildDockerSandboxProviderInstance({
        label: "Local",
        image: "katacode:local",
        command: "katacode serve --port 13773",
        port: "bad",
      }),
    ).toThrow("Container port");
  });

  it("creates Docker and Vercel sandbox configs for the add environment dialog", () => {
    expect(
      buildDockerSandboxProviderInstance({
        label: "Local",
        image: "katacode:local",
        command: "katacode serve --port 13773",
        port: "13773",
      }),
    ).toMatchObject({
      driver: DOCKER_SANDBOX_KIND,
      enabled: true,
      displayName: "Local",
      config: { image: "katacode:local", command: "katacode serve --port 13773", port: 13773 },
    });

    expect(buildVercelSandboxProviderInstance({ label: "Cloud" })).toMatchObject({
      driver: VERCEL_SANDBOX_KIND,
      enabled: true,
      displayName: "Cloud",
      config: {
        runtime: "node24",
        persistent: true,
        timeoutMs: 86_400_000,
        port: 13773,
        vcpus: 2,
      },
    });
  });

  it("defaults missing/invalid vcpus to the recommended floor and labels RAM", () => {
    expect(readVercelVcpus(undefined)).toBe(2);
    expect(readVercelVcpus({})).toBe(2);
    expect(readVercelVcpus({ vcpus: 3 })).toBe(2);
    expect(readVercelVcpus({ vcpus: 4 })).toBe(4);
    expect(formatVercelVcpusLabel(2)).toBe("2 vCPU / 4 GB RAM — recommended");
    expect(formatVercelVcpusLabel(4)).toBe("4 vCPU / 8 GB RAM");
  });

  it("only seeds a repository for the create path, not lifecycle Start", () => {
    expect(shouldSeedRepositoryForStart(undefined)).toBe(true);
    expect(
      shouldSeedRepositoryForStart({ kind: "available", runningSession: undefined } as never),
    ).toBe(true);
    expect(
      shouldSeedRepositoryForStart({
        kind: "available",
        runningSession: { status: "stopped" },
      } as never),
    ).toBe(false);
    expect(
      shouldSeedRepositoryForStart({
        kind: "available",
        runningSession: { status: "running" },
      } as never),
    ).toBe(false);
  });
});

describe("resolveSandboxLifecycleState (identity recovery R1: id-based join)", () => {
  /** A minimal saved-record shape with the `sandbox` marker. */
  function savedSandbox(input: {
    environmentId?: string;
    label?: string;
    providerKind?: string;
    instanceId?: string;
  }) {
    return {
      environmentId: input.environmentId ?? "env_1",
      label: input.label ?? "My Container",
      wsBaseUrl: "ws://localhost:1",
      httpBaseUrl: "http://localhost:1",
      createdAt: "",
      lastConnectedAt: null,
      sandbox: {
        providerKind: input.providerKind ?? "docker",
        ...(input.instanceId !== undefined ? { instanceId: input.instanceId } : {}),
      },
    } as never;
  }

  /** A minimal available summary shape. */
  function summary(
    instanceId: string,
    session?: { environmentId: string; status: "running" | "stopped" },
  ) {
    return {
      kind: "available",
      instanceId,
      driver: "docker",
      reachabilityKind: "loopback",
      supportsSnapshot: false,
      supportsRenewTimeout: false,
      supportsLifecycle: true,
      ...(session !== undefined
        ? {
            runningSession: {
              environmentId: session.environmentId,
              endpoint: { id: "e", label: "L", httpBaseUrl: "http://localhost:1" },
              status: session.status,
            },
          }
        : {}),
    } as never;
  }

  it("returns undefined for a non-sandbox saved record", () => {
    const record = { environmentId: "env_1", label: "My Remote", sandbox: undefined } as never;
    expect(resolveSandboxLifecycleState(record, [])).toBeUndefined();
  });

  it("joins by environment id regardless of label (rename survival)", () => {
    const record = savedSandbox({ environmentId: "env_1", label: "totally renamed" });
    const summaries = [summary("docker_whatever", { environmentId: "env_1", status: "running" })];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("running");
  });

  it("returns 'stopped' via the environment-id join", () => {
    const record = savedSandbox({ environmentId: "env_1" });
    const summaries = [summary("docker_x", { environmentId: "env_1", status: "stopped" })];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("stopped");
  });

  it("falls back to the persisted instance id when no session matches", () => {
    const record = savedSandbox({ environmentId: "env_other", instanceId: "docker_x" });
    const summaries = [summary("docker_x", { environmentId: "env_new", status: "running" })];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("running");
  });

  it("returns 'gone' when the persisted instance id is absent from summaries", () => {
    const record = savedSandbox({ instanceId: "docker_deleted" });
    expect(resolveSandboxLifecycleState(record, [summary("docker_other")])).toBe("gone");
  });

  it("returns 'gone' when the persisted instance id matches an instance with no session", () => {
    const record = savedSandbox({ environmentId: "env_dead", instanceId: "docker_x" });
    expect(resolveSandboxLifecycleState(record, [summary("docker_x")])).toBe("gone");
  });

  it("returns 'unknown' (never 'gone') when summaries were not loaded successfully", () => {
    const record = savedSandbox({ instanceId: "docker_x" });
    expect(resolveSandboxLifecycleState(record, [], { summariesLoaded: false })).toBe("unknown");
    expect(
      resolveSandboxLifecycleState(record, [summary("docker_other")], {
        summariesLoaded: false,
      }),
    ).toBe("unknown");
  });

  it("returns 'unknown' for unavailable summaries instead of inventing 'gone'", () => {
    const record = savedSandbox({ instanceId: "docker_x" });
    const unavailable = {
      kind: "unavailable",
      instanceId: "docker_x",
      reason: "invalid-config",
      message: "bad",
    } as never;
    expect(resolveSandboxLifecycleState(record, [unavailable])).toBe("unknown");
  });

  it("returns 'unknown' (never 'gone') for legacy records without an instance id", () => {
    const record = savedSandbox({ environmentId: "env_legacy" });
    expect(resolveSandboxLifecycleState(record, [summary("docker_x")])).toBe("unknown");
    expect(resolveSandboxLifecycleState(record, [])).toBe("unknown");
  });
});
