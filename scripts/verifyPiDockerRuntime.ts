// @effect-diagnostics nodeBuiltinImport:off - imperative Docker runtime probe.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PI_SDK_PIN } from "@kata-sh/code-sandbox-contracts/piSdkPin";
import { readPiUpdatePrerequisites } from "./piUpdateVerification.ts";

const IMAGE = "katacode:local";

export const PI_DOCKER_RUNTIME_PROBE = `
import { execFileSync } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";

const credentialDir = "/home/katacode/.pi/agent";
const authPath = credentialDir + "/auth.json";

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (typeof envelope.authJson !== "string") {
    throw new Error("Docker Pi runtime credential envelope is invalid");
  }

  await mkdir(credentialDir, { recursive: true, mode: 0o700 });
  await chmod(credentialDir, 0o700);
  await writeFile(authPath, envelope.authJson, { encoding: "utf8", mode: 0o600 });
  await chmod(authPath, 0o600);

  const cliVersion = execFileSync("pi", ["--version"], { encoding: "utf8" }).trim();
  if (cliVersion !== process.env.EXPECTED_PI_VERSION) {
    throw new Error(
      \`Docker Pi CLI \${cliVersion} != \${process.env.EXPECTED_PI_VERSION}\`,
    );
  }

  const sdk =
    await import("file:///app/apps/server/node_modules/@earendil-works/pi-coding-agent/dist/index.js");
  if (sdk.VERSION !== process.env.EXPECTED_PI_VERSION) {
    throw new Error(
      \`Docker Pi SDK \${sdk.VERSION} != \${process.env.EXPECTED_PI_VERSION}\`,
    );
  }

  const [provider, ...modelParts] = process.env.KATACODE_E2E_PI_MODEL.split("/");
  const modelId = modelParts.join("/");
  if (!provider || !modelId) {
    throw new Error("Docker Pi runtime model must use provider/model format");
  }
  const runtime = await sdk.ModelRuntime.create();
  const available = await runtime.getAvailable(provider);
  if (!available.some((model) => model.id === modelId)) {
    throw new Error(\`Docker Pi runtime did not discover \${provider}/\${modelId}\`);
  }

  console.log(
    JSON.stringify({ cliVersion, sdkVersion: sdk.VERSION, model: \`\${provider}/\${modelId}\` }),
  );
} finally {
  await rm(credentialDir, { recursive: true, force: true });
}
`;

interface CommandResult {
  readonly status: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly error?: Error;
}

interface DockerCommandOptions {
  readonly input: string;
  readonly stdio: readonly ["pipe", "inherit", "inherit"];
}

interface PiDockerRuntimeDependencies {
  readonly readAuthFile?: (path: string) => string;
  readonly runCommand?: (
    executable: string,
    args: ReadonlyArray<string>,
    options: DockerCommandOptions,
  ) => CommandResult;
}

export interface PiDockerRuntimeCommand {
  readonly executable: "docker";
  readonly args: ReadonlyArray<string>;
}

export function makePiDockerRuntimeCommand(
  model: string,
  expectedVersion: string = PI_SDK_PIN,
): PiDockerRuntimeCommand {
  return {
    executable: "docker",
    args: [
      "run",
      "--rm",
      "--interactive",
      "--user",
      "katacode",
      "--env",
      `KATACODE_E2E_PI_MODEL=${model}`,
      "--env",
      `EXPECTED_PI_VERSION=${expectedVersion}`,
      "--entrypoint",
      "node",
      IMAGE,
      "--input-type=module",
      "-e",
      PI_DOCKER_RUNTIME_PROBE,
    ],
  };
}

function readAuthFile(path: string): string {
  return readFileSync(path, "utf8");
}

function spawnCommand(
  executable: string,
  args: ReadonlyArray<string>,
  options: DockerCommandOptions,
): CommandResult {
  return spawnSync(executable, args, {
    input: options.input,
    stdio: [...options.stdio],
  });
}

export function runPiDockerRuntime(
  env: NodeJS.ProcessEnv,
  dependencies: PiDockerRuntimeDependencies = {},
): void {
  const { agentDir, model } = readPiUpdatePrerequisites(env);
  const authJson = (dependencies.readAuthFile ?? readAuthFile)(join(agentDir, "auth.json"));
  const command = makePiDockerRuntimeCommand(model);
  const result = (dependencies.runCommand ?? spawnCommand)(command.executable, command.args, {
    input: JSON.stringify({ authJson }),
    stdio: ["pipe", "inherit", "inherit"],
  });

  if (result.error) {
    throw new Error(`Docker Pi runtime probe failed to start: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const outcome =
      result.status === null
        ? `signal ${result.signal ?? "unknown"}`
        : `exit code ${result.status}`;
    throw new Error(`Docker Pi runtime probe failed with ${outcome}`);
  }
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isMainModule()) {
  try {
    runPiDockerRuntime(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
