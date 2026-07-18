// @effect-diagnostics nodeBuiltinImport:off - verification tests exercise filesystem prerequisites.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  PI_UPDATE_REQUIRED_ENV,
  PI_UPDATE_VERIFICATION_ENV,
  assertDockerAvailable,
  makePiUpdateCommands,
  readPiUpdatePrerequisites,
  runPiUpdateVerification,
} from "./piUpdateVerification.ts";

describe("Pi update verification", () => {
  it("reports every missing credentialed prerequisite", () => {
    expect(() => readPiUpdatePrerequisites({})).toThrow(PI_UPDATE_REQUIRED_ENV.join(", "));
  });

  it("runs focused, static, E2E, and Docker gates in order", () => {
    expect(makePiUpdateCommands()).toEqual([
      {
        label: "focused Pi tests",
        executable: "vp",
        args: [
          "test",
          "apps/server/src/provider/Layers/PiProvider.test.ts",
          "apps/server/src/provider/Layers/PiAdapter.test.ts",
          "apps/server/src/textGeneration/PiTextGeneration.test.ts",
          "packages/sandbox-vercel/src/bootstrap.test.ts",
          "scripts/piRuntimeVersion.test.ts",
          "scripts/piUpdateVerification.test.ts",
          "scripts/verifyPiDockerRuntime.test.ts",
        ],
      },
      { label: "repository check", executable: "vp", args: ["check"] },
      { label: "repository typecheck", executable: "vp", args: ["run", "typecheck"] },
      { label: "desktop build", executable: "vp", args: ["run", "build:desktop"] },
      {
        label: "credentialed Pi E2E",
        executable: "vp",
        args: ["run", "e2e:desktop", "--grep", "@pi"],
      },
      { label: "Docker image build", executable: "vp", args: ["run", "build:docker-image"] },
      { label: "Docker image baseline", executable: "vp", args: ["run", "verify:docker-image"] },
      {
        label: "Docker Pi runtime",
        executable: "node",
        args: ["scripts/verifyPiDockerRuntime.ts"],
      },
    ]);
  });

  it("checks auth.json before running any command", () => {
    const runCommand = vi.fn();
    const checkAuthFile = vi.fn(() => {
      throw new Error("missing auth");
    });
    const checkDocker = vi.fn();

    expect(() =>
      runPiUpdateVerification(
        {
          KATACODE_E2E_PI_AGENT_DIR: "/agent",
          KATACODE_E2E_PI_MODEL: "provider/model",
        },
        { checkAuthFile, checkDocker, runCommand },
      ),
    ).toThrow("missing auth");
    expect(checkAuthFile).toHaveBeenCalledWith("/agent/auth.json");
    expect(checkDocker).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("fails fast when Docker is unavailable before running any command", () => {
    const runCommand = vi.fn();
    const checkDocker = vi.fn(() => {
      throw new Error("Pi update verification requires Docker: docker info exited with code 1");
    });

    expect(() =>
      runPiUpdateVerification(
        {
          KATACODE_E2E_PI_AGENT_DIR: "/agent",
          KATACODE_E2E_PI_MODEL: "provider/model",
        },
        { checkAuthFile: vi.fn(), checkDocker, runCommand },
      ),
    ).toThrow("Pi update verification requires Docker");
    expect(checkDocker).toHaveBeenCalledOnce();
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("default Docker check distinguishes start error, signal, and nonzero exit", () => {
    const startError = new Error("ENOENT");
    expect(() =>
      assertDockerAvailable({
        runDockerInfo: () => ({ status: null, error: startError }),
      }),
    ).toThrow("Pi update verification requires Docker: failed to start: ENOENT");

    expect(() =>
      assertDockerAvailable({
        runDockerInfo: () => ({ status: null, signal: "SIGTERM" }),
      }),
    ).toThrow("Pi update verification requires Docker: docker info terminated by signal SIGTERM");

    expect(() =>
      assertDockerAvailable({
        runDockerInfo: () => ({ status: 1 }),
      }),
    ).toThrow("Pi update verification requires Docker: docker info exited with code 1");

    expect(() =>
      assertDockerAvailable({
        runDockerInfo: () => ({ status: 0 }),
      }),
    ).not.toThrow();
  });

  it("requires auth.json to be a regular file before running any command", () => {
    const agentDir = mkdtempSync(join(tmpdir(), "katacode-pi-auth-directory-"));
    mkdirSync(join(agentDir, "auth.json"));
    const runCommand = vi.fn();

    try {
      expect(() =>
        runPiUpdateVerification(
          {
            KATACODE_E2E_PI_AGENT_DIR: agentDir,
            KATACODE_E2E_PI_MODEL: "provider/model",
          },
          { checkDocker: vi.fn(), runCommand },
        ),
      ).toThrow("requires readable regular auth.json");
      expect(runCommand).not.toHaveBeenCalled();
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("forces all Pi E2E values and stops on the first command failure", () => {
    const runCommand = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 2 });

    expect(() =>
      runPiUpdateVerification(
        {
          KATACODE_E2E_ENABLE_PI: "0",
          KATACODE_E2E_PI_AGENT_DIR: " /agent ",
          KATACODE_E2E_PI_MODEL: " provider/model ",
          [PI_UPDATE_VERIFICATION_ENV]: "0",
        },
        { checkAuthFile: vi.fn(), checkDocker: vi.fn(), runCommand },
      ),
    ).toThrow("repository check failed with exit code 2");
    expect(runCommand).toHaveBeenCalledTimes(2);
    expect(runCommand).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        stdio: "inherit",
        env: expect.objectContaining({
          KATACODE_E2E_ENABLE_PI: "1",
          KATACODE_E2E_PI_AGENT_DIR: "/agent",
          KATACODE_E2E_PI_MODEL: "provider/model",
          [PI_UPDATE_VERIFICATION_ENV]: "1",
        }),
      }),
    );
  });
});
