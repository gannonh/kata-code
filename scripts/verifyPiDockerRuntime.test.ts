import { describe, expect, it, vi } from "vite-plus/test";
import {
  PI_DOCKER_RUNTIME_PROBE,
  makePiDockerRuntimeCommand,
  runPiDockerRuntime,
} from "./verifyPiDockerRuntime.ts";

describe("Pi Docker runtime verification", () => {
  it("uses an ephemeral unprivileged container without host mounts", () => {
    const command = makePiDockerRuntimeCommand("provider/model", "1.2.3");

    expect(command).toEqual({
      executable: "docker",
      args: [
        "run",
        "--rm",
        "--interactive",
        "--user",
        "katacode",
        "--env",
        "KATACODE_E2E_PI_MODEL=provider/model",
        "--env",
        "EXPECTED_PI_VERSION=1.2.3",
        "--entrypoint",
        "node",
        "katacode:local",
        "--input-type=module",
        "-e",
        PI_DOCKER_RUNTIME_PROBE,
      ],
    });
    expect(command.args).not.toContain("--mount");
    expect(command.args).not.toContain("--volume");
    expect(command.args).not.toContain("-v");
    expect(command.args.some((arg) => arg.includes("type=bind"))).toBe(false);
  });

  it("pipes only the auth envelope over stdin", () => {
    const runCommand = vi.fn(
      (
        _executable: string,
        _args: ReadonlyArray<string>,
        _options: {
          readonly input: string;
          readonly stdio: readonly ["pipe", "inherit", "inherit"];
        },
      ) => ({ status: 0 }),
    );

    runPiDockerRuntime(
      {
        KATACODE_E2E_PI_AGENT_DIR: "/agent",
        KATACODE_E2E_PI_MODEL: "provider/model",
      },
      {
        readAuthFile: vi.fn(() => "test-auth-json"),
        runCommand,
      },
    );

    expect(runCommand).toHaveBeenCalledOnce();
    const [executable, args, options] = runCommand.mock.calls[0]!;
    expect(executable).toBe("docker");
    expect(args).not.toContain("test-auth-json");
    expect(options).toEqual({
      input: JSON.stringify({ authJson: "test-auth-json" }),
      stdio: ["pipe", "inherit", "inherit"],
    });
    expect(JSON.parse(options.input)).toEqual({ authJson: "test-auth-json" });
    expect(JSON.parse(options.input)).not.toHaveProperty("modelsJson");
  });

  it("creates private credentials and always removes them inside the probe", () => {
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("JSON.parse");
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("mode: 0o700");
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("mode: 0o600");
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("await chmod(credentialDir, 0o700)");
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("await chmod(authPath, 0o600)");
    expect(PI_DOCKER_RUNTIME_PROBE).toMatch(/finally\s*{/);
    expect(PI_DOCKER_RUNTIME_PROBE).toContain(
      "await rm(credentialDir, { recursive: true, force: true })",
    );
  });

  it("checks CLI and SDK versions plus authenticated built-in discovery", () => {
    expect(PI_DOCKER_RUNTIME_PROBE).toContain('execFileSync("pi", ["--version"]');
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("sdk.VERSION");
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("process.env.EXPECTED_PI_VERSION");
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("await sdk.ModelRuntime.create()");
    expect(PI_DOCKER_RUNTIME_PROBE).toContain("await runtime.getAvailable(provider)");
    expect(PI_DOCKER_RUNTIME_PROBE).not.toContain("models.json");
  });
});
