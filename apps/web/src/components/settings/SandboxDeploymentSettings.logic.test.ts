import { describe, expect, it } from "vite-plus/test";

import {
  DOCKER_SANDBOX_KIND,
  VERCEL_SANDBOX_KIND,
  buildDockerSandboxProviderInstance,
  buildVercelSandboxProviderInstance,
  makeSandboxProviderInstanceId,
  parseSandboxPort,
  sandboxInstanceIdForLabel,
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

  it("creates Docker and Vercel sandbox configs for the unified add dialog", () => {
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
      config: { runtime: "node24", sourceType: "runtime", timeoutMs: 86_400_000, port: 13773 },
    });
  });
});
