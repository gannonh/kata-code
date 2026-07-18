// @effect-diagnostics nodeBuiltinImport:off - verification tests exercise filesystem prerequisites.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  PI_UPDATE_REQUIRED_ENV,
  PI_UPDATE_VERIFICATION_ENV,
  makePiUpdateCommands,
  readPiUpdatePrerequisites,
  runPiUpdateVerification,
} from "./piUpdateVerification.ts";

describe("Pi update verification", () => {
  it("reports every missing credentialed prerequisite", () => {
    expect(() => readPiUpdatePrerequisites({})).toThrow(PI_UPDATE_REQUIRED_ENV.join(", "));
  });

  it("runs focused, static, E2E, and Docker gates in order", () => {
    const commands = makePiUpdateCommands();
    expect(commands.map((command) => command.label)).toEqual([
      "focused Pi tests",
      "repository check",
      "repository typecheck",
      "desktop build",
      "credentialed Pi E2E",
      "Docker image build",
      "Docker image baseline",
      "Docker Pi runtime",
    ]);
  });

  it("checks auth.json before running any command", () => {
    const runCommand = vi.fn();
    const checkAuthFile = vi.fn(() => {
      throw new Error("missing auth");
    });

    expect(() =>
      runPiUpdateVerification(
        {
          KATACODE_E2E_PI_AGENT_DIR: "/agent",
          KATACODE_E2E_PI_MODEL: "provider/model",
        },
        { checkAuthFile, runCommand },
      ),
    ).toThrow("missing auth");
    expect(checkAuthFile).toHaveBeenCalledWith("/agent/auth.json");
    expect(runCommand).not.toHaveBeenCalled();
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
          { runCommand },
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
        { checkAuthFile: vi.fn(), runCommand },
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
