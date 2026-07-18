// @effect-diagnostics nodeBuiltinImport:off - imperative Docker runtime probe.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-ignore TS6307 - The verification command intentionally consumes the shared Pi pin.
import { PI_SDK_PIN } from "../packages/sandbox-vercel/src/bootstrap.ts";
import { readPiUpdatePrerequisites } from "./piUpdateVerification.ts";

const IMAGE = "katacode:local";
const CONTAINER_AGENT_DIR = "/home/katacode/.pi/agent";

const RUNTIME_PROBE = [
  "const sdk =",
  '  await import("file:///app/apps/server/node_modules/@earendil-works/pi-coding-agent/dist/index.js");',
  'const [provider, ...modelParts] = process.env.KATACODE_E2E_PI_MODEL.split("/");',
  'const modelId = modelParts.join("/");',
  "const runtime = await sdk.ModelRuntime.create();",
  "const available = await runtime.getAvailable(provider);",
  "if (!available.some((model) => model.id === modelId)) {",
  "  throw new Error(`Docker Pi runtime did not discover ${provider}/${modelId}`);",
  "}",
  "if (sdk.VERSION !== process.env.EXPECTED_PI_VERSION) {",
  "  throw new Error(`Docker Pi SDK ${sdk.VERSION} != ${process.env.EXPECTED_PI_VERSION}`);",
  "}",
  "console.log(JSON.stringify({ sdkVersion: sdk.VERSION, model: `${provider}/${modelId}` }));",
].join("\n");

const SHELL_PROBE = `
set -eu
actual_version="$(pi --version)"
if [ "$actual_version" != "$EXPECTED_PI_VERSION" ]; then
  echo "Docker Pi CLI $actual_version != $EXPECTED_PI_VERSION" >&2
  exit 1
fi
exec node --input-type=module -e "$1"
`;

function stageCredentials(agentDir: string, stagedDir: string): void {
  chmodSync(stagedDir, 0o755);
  const authDestination = join(stagedDir, "auth.json");
  copyFileSync(join(agentDir, "auth.json"), authDestination);
  chmodSync(authDestination, 0o444);

  const modelsSource = join(agentDir, "models.json");
  if (existsSync(modelsSource)) {
    const modelsDestination = join(stagedDir, "models.json");
    copyFileSync(modelsSource, modelsDestination);
    chmodSync(modelsDestination, 0o444);
  }
}

function main(): void {
  const { agentDir, model } = readPiUpdatePrerequisites(process.env);
  const stagedDir = mkdtempSync(join(tmpdir(), "kata-pi-update-"));

  try {
    stageCredentials(agentDir, stagedDir);
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--user",
        "katacode",
        "--mount",
        `type=bind,source=${stagedDir},target=${CONTAINER_AGENT_DIR},readonly`,
        "--env",
        `KATACODE_E2E_PI_MODEL=${model}`,
        "--env",
        `EXPECTED_PI_VERSION=${PI_SDK_PIN}`,
        "--entrypoint",
        "sh",
        IMAGE,
        "-c",
        SHELL_PROBE,
        "pi-runtime-probe",
        RUNTIME_PROBE,
      ],
      { stdio: "inherit" },
    );

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
  } finally {
    rmSync(stagedDir, { recursive: true, force: true });
  }
}

function isMainModule(): boolean {
  return (
    process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])
  );
}

if (isMainModule()) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
