import { describe, expect, it } from "vite-plus/test";

import {
  DOCKER_SANDBOX_KIND,
  VERCEL_SANDBOX_KIND,
  buildDockerSandboxProviderInstance,
  buildVercelSandboxProviderInstance,
  makeSandboxProviderInstanceId,
  parseSandboxPort,
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
      config: { runtime: "node24", persistent: true, timeoutMs: 86_400_000, port: 13773 },
    });
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

describe("resolveSandboxLifecycleState (AC-L13)", () => {
  /** A minimal saved-record shape with the `sandbox` marker. */
  function savedSandbox(providerKind: string, label: string) {
    return {
      environmentId: "env_1",
      label,
      wsBaseUrl: "ws://localhost:1",
      httpBaseUrl: "http://localhost:1",
      createdAt: "",
      lastConnectedAt: null,
      sandbox: { providerKind },
    } as never;
  }

  /** A minimal available summary shape. */
  function summary(instanceId: string, status: "running" | "stopped") {
    return {
      kind: "available",
      instanceId,
      driver: "docker",
      reachabilityKind: "loopback",
      supportsSnapshot: false,
      supportsRenewTimeout: false,
      supportsLifecycle: true,
      runningSession: {
        environmentId: "env_1",
        endpoint: { id: "e", label: "L", httpBaseUrl: "http://localhost:1" },
        status,
      },
    } as never;
  }

  it("returns undefined for a non-sandbox saved record", () => {
    const record = { label: "My Remote", sandbox: undefined } as never;
    expect(resolveSandboxLifecycleState(record, [])).toBeUndefined();
  });

  it("returns 'running' when the matching summary has runningSession.status running", () => {
    const record = savedSandbox("docker", "My Container");
    const summaries = [summary("docker_my_container", "running")];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("running");
  });

  it("returns 'stopped' when the matching summary has runningSession.status stopped", () => {
    const record = savedSandbox("docker", "My Container");
    const summaries = [summary("docker_my_container", "stopped")];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("stopped");
  });

  it("returns 'gone' when no matching summary exists (sandbox deleted)", () => {
    const record = savedSandbox("vercel", "Cloud Test");
    expect(resolveSandboxLifecycleState(record, [])).toBe("gone");
  });

  it("returns 'gone' when the matching instance is unavailable", () => {
    const record = savedSandbox("docker", "My Container");
    const summaries = [
      {
        kind: "unavailable",
        instanceId: "docker_my_container",
        reason: "invalid-config",
        message: "bad",
      } as never,
    ];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("gone");
  });

  it("maps 'local' providerKind to the docker driver (legacy records)", () => {
    const record = savedSandbox("local", "My Container");
    const summaries = [summary("docker_my_container", "running")];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("running");
  });

  it("maps 'vercel' providerKind to the vercel driver", () => {
    const record = savedSandbox("vercel", "Cloud Test");
    const summaries = [
      {
        kind: "available",
        instanceId: "vercel_cloud_test",
        driver: "vercel",
        reachabilityKind: "public",
        supportsSnapshot: false,
        supportsRenewTimeout: false,
        supportsLifecycle: true,
        runningSession: {
          environmentId: "env_1",
          endpoint: { id: "e", label: "L", httpBaseUrl: "http://localhost:1" },
          status: "running",
        },
      } as never,
    ];
    expect(resolveSandboxLifecycleState(record, summaries)).toBe("running");
  });
});
