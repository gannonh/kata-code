// @effect-diagnostics nodeBuiltinImport:off - imperative maintainer verification command.
import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PI_UPDATE_REQUIRED_ENV = [
  "KATACODE_E2E_PI_AGENT_DIR",
  "KATACODE_E2E_PI_MODEL",
] as const;

export const PI_UPDATE_VERIFICATION_ENV = "KATACODE_E2E_PI_UPDATE_VERIFICATION";

export interface PiUpdateCommand {
  readonly label: string;
  readonly executable: string;
  readonly args: ReadonlyArray<string>;
}

interface CommandResult {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
}

interface CommandOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly stdio: "inherit";
}

interface DockerInfoResult {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
}

interface AssertDockerAvailableDependencies {
  readonly runDockerInfo?: () => DockerInfoResult;
}

interface PiUpdateVerificationDependencies {
  readonly checkAuthFile?: (path: string) => void;
  readonly checkDocker?: () => void;
  readonly runCommand?: (
    executable: string,
    args: ReadonlyArray<string>,
    options: CommandOptions,
  ) => CommandResult;
}

export function readPiUpdatePrerequisites(env: NodeJS.ProcessEnv): {
  readonly agentDir: string;
  readonly model: string;
} {
  const missing = PI_UPDATE_REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Pi update verification missing: ${missing.join(", ")}`);
  }
  return {
    agentDir: env.KATACODE_E2E_PI_AGENT_DIR!.trim(),
    model: env.KATACODE_E2E_PI_MODEL!.trim(),
  };
}

export function makePiUpdateCommands(): ReadonlyArray<PiUpdateCommand> {
  return [
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
  ];
}

function checkReadableFile(path: string): void {
  try {
    accessSync(path, constants.R_OK);
    if (!statSync(path).isFile()) {
      throw new Error("path is not a regular file");
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Pi update verification requires readable regular auth.json at ${path}: ${detail}`,
      { cause: error },
    );
  }
}

function spawnDockerInfo(): DockerInfoResult {
  return spawnSync("docker", ["info"], { stdio: "ignore" });
}

export function assertDockerAvailable(dependencies: AssertDockerAvailableDependencies = {}): void {
  const runDockerInfo = dependencies.runDockerInfo ?? spawnDockerInfo;
  const result = runDockerInfo();
  if (result.error) {
    throw new Error(
      `Pi update verification requires Docker: failed to start: ${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status === null) {
    throw new Error(
      `Pi update verification requires Docker: docker info terminated by signal ${result.signal ?? "unknown"}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `Pi update verification requires Docker: docker info exited with code ${result.status}`,
    );
  }
}

function spawnCommand(
  executable: string,
  args: ReadonlyArray<string>,
  options: CommandOptions,
): CommandResult {
  return spawnSync(executable, args, options);
}

export function runPiUpdateVerification(
  env: NodeJS.ProcessEnv,
  dependencies: PiUpdateVerificationDependencies = {},
): void {
  const { agentDir, model } = readPiUpdatePrerequisites(env);
  const authPath = resolve(agentDir, "auth.json");
  const checkAuthFile = dependencies.checkAuthFile ?? checkReadableFile;
  const checkDocker = dependencies.checkDocker ?? assertDockerAvailable;
  const runCommand = dependencies.runCommand ?? spawnCommand;

  checkAuthFile(authPath);
  checkDocker();

  const commandEnv = {
    ...env,
    KATACODE_E2E_ENABLE_PI: "1",
    KATACODE_E2E_PI_AGENT_DIR: agentDir,
    KATACODE_E2E_PI_MODEL: model,
    [PI_UPDATE_VERIFICATION_ENV]: "1",
  };
  for (const command of makePiUpdateCommands()) {
    process.stdout.write(`Pi update verification: ${command.label}\n`);
    const result = runCommand(command.executable, command.args, {
      env: commandEnv,
      stdio: "inherit",
    });
    if (result.error) {
      throw new Error(`${command.label} failed to start: ${result.error.message}`, {
        cause: result.error,
      });
    }
    if (result.status !== 0) {
      const outcome =
        result.status === null
          ? `signal ${result.signal ?? "unknown"}`
          : `exit code ${result.status}`;
      throw new Error(`${command.label} failed with ${outcome}`);
    }
  }
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isMainModule()) {
  try {
    runPiUpdateVerification(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
