import { type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { assertDesktopBuildArtifacts } from "./desktopArtifacts.ts";
import { buildDevStackEnv } from "./devStackEnv.ts";
import type { E2ERunContext } from "./isolatedRun.ts";
import { registerCleanup } from "./isolatedRun.ts";
import { logHarnessPhase } from "./log.ts";
import { spawnWithArtifactLogs, terminateChildProcess } from "./processSpawn.ts";
import { waitForTcpPort } from "./readiness.ts";
import { withTimeout } from "./withTimeout.ts";

export interface DevStackHandle {
  readonly process: ChildProcess;
}

interface DevRunnerArgsInput {
  readonly katacodeHome: string;
  readonly serverPort: number;
  readonly webPort: number;
}

function buildRunnerArgs(
  mode: "dev" | "dev:web",
  input: DevRunnerArgsInput,
  webHost: "127.0.0.1" | "localhost",
): string[] {
  return [
    "scripts/dev-runner.ts",
    mode,
    "--home-dir",
    input.katacodeHome,
    "--no-browser",
    "--port",
    String(input.serverPort),
    "--dev-url",
    `http://${webHost}:${input.webPort}`,
  ];
}

export function buildDevRunnerArgs(input: DevRunnerArgsInput): string[] {
  // Vite only. Playwright launches the single Electron instance — dev:desktop would
  // also auto-spawn Electron via dev-electron.mjs and cause duplicate backends/tokens.
  return buildRunnerArgs("dev:web", input, "127.0.0.1");
}

export function buildWebDevRunnerArgs(input: DevRunnerArgsInput): string[] {
  // The web runtime emits localhost API/WS URLs. Keep the pairing page on the
  // same cookie host so its session credential authenticates those requests.
  return buildRunnerArgs("dev", input, "localhost");
}

export function parsePairingUrl(output: string): string | undefined {
  return output.match(/(?:Pairing URL|pairingUrl):\s*(https?:\/\/\S+)/u)?.[1];
}

async function readDevStackLogTail(
  context: E2ERunContext,
  label: string,
): Promise<string | undefined> {
  try {
    const log = await readFile(join(context.artifactRoot, `${label}.log`), "utf8");
    const lines = log.trimEnd().split("\n");
    return lines.slice(-20).join("\n");
  } catch {
    return undefined;
  }
}

async function devStackTimeoutDetails(
  context: E2ERunContext,
  label = "dev-stack",
): Promise<string> {
  const stderr = await readDevStackLogTail(context, `${label}-stderr`);
  const stdout = await readDevStackLogTail(context, `${label}-stdout`);
  const spawnError = await readDevStackLogTail(context, `${label}-spawn-error`);
  const sections = [
    `artifactRoot=${context.artifactRoot}`,
    spawnError ? `dev-stack-spawn-error:\n${spawnError}` : undefined,
    stderr ? `dev-stack-stderr (last lines):\n${stderr}` : undefined,
    stdout ? `dev-stack-stdout (last lines):\n${stdout}` : undefined,
  ].filter(Boolean);
  return sections.join("\n\n");
}

export async function startDevStack(context: E2ERunContext): Promise<DevStackHandle> {
  return await withTimeout(
    "Dev stack startup",
    Math.max(E2E_TIMEOUTS.devStackMs, E2E_TIMEOUTS.pairingMs),
    async (signal) => startDevStackInner(context, signal),
    () => devStackTimeoutDetails(context),
  );
}

function createOutputWaiter(
  signal: AbortSignal,
  match: (output: string) => string | undefined,
): { readonly push: (chunk: string) => void; readonly result: Promise<string> } {
  let output = "";
  let settled = false;
  let resolveResult!: (value: string) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  signal.addEventListener("abort", () => rejectResult(signal.reason), { once: true });
  return {
    push: (chunk) => {
      if (settled) return;
      output += chunk;
      const matched = match(output);
      if (matched !== undefined) {
        settled = true;
        output = "";
        resolveResult(matched);
      }
    },
    result,
  };
}

export async function startWebDevStack(
  context: E2ERunContext,
): Promise<DevStackHandle & { readonly pairingUrl: string }> {
  return await withTimeout(
    "Web dev stack startup",
    Math.max(E2E_TIMEOUTS.devStackMs, E2E_TIMEOUTS.pairingMs),
    async (signal) => {
      logHarnessPhase(
        `Starting full web dev stack (web=${context.webPort}, api=${context.serverPort}, home=${context.katacodeHome})`,
      );
      const pairingUrlWaiter = createOutputWaiter(signal, parsePairingUrl);
      await context.releasePortClaim();
      const { process: child } = spawnWithArtifactLogs(context, {
        label: "web-stack",
        command: process.execPath,
        args: buildWebDevRunnerArgs({
          katacodeHome: context.katacodeHome,
          serverPort: context.serverPort,
          webPort: context.webPort,
        }),
        cwd: context.repoRoot,
        env: buildDevStackEnv(context),
        onOutput: pairingUrlWaiter.push,
      });
      registerCleanup(context, async () => terminateChildProcess(child));
      // The pairing URL is emitted only after both the server and Vite startup
      // have completed. Browser navigation is the authoritative HTTP check.
      const pairingUrl = await pairingUrlWaiter.result;
      return { process: child, pairingUrl };
    },
    () => devStackTimeoutDetails(context, "web-stack"),
  );
}

async function startDevStackInner(
  context: E2ERunContext,
  signal: AbortSignal,
): Promise<DevStackHandle> {
  await assertDesktopBuildArtifacts(context.repoRoot);

  logHarnessPhase(
    `Starting Vite dev server (web=${context.webPort}, api will be provided by Electron on ${context.serverPort}, home=${context.katacodeHome})`,
  );

  await context.releasePortClaim();
  const { process: child } = spawnWithArtifactLogs(context, {
    label: "dev-stack",
    command: process.execPath,
    args: buildDevRunnerArgs({
      katacodeHome: context.katacodeHome,
      serverPort: context.serverPort,
      webPort: context.webPort,
    }),
    cwd: context.repoRoot,
    env: buildDevStackEnv(context),
  });

  registerCleanup(context, async () => {
    await terminateChildProcess(child);
  });

  logHarnessPhase("Waiting for Vite dev server port...");
  await waitForTcpPort(context.webPort, E2E_TIMEOUTS.devStackMs, signal);
  logHarnessPhase("Vite dev server port is ready.");

  return { process: child };
}
