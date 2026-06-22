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
import { waitForWebDevServer } from "./readiness.ts";
import { withTimeout } from "./withTimeout.ts";

export interface DevStackHandle {
  readonly process: ChildProcess;
}

export function buildDevRunnerArgs(input: {
  readonly katacodeHome: string;
  readonly serverPort: number;
  readonly webPort: number;
}): string[] {
  // Vite only. Playwright launches the single Electron instance — dev:desktop would
  // also auto-spawn Electron via dev-electron.mjs and cause duplicate backends/tokens.
  return [
    "scripts/dev-runner.ts",
    "dev:web",
    "--home-dir",
    input.katacodeHome,
    "--no-browser",
    "--port",
    String(input.serverPort),
    "--dev-url",
    `http://127.0.0.1:${input.webPort}`,
  ];
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

async function devStackTimeoutDetails(context: E2ERunContext): Promise<string> {
  const stderr = await readDevStackLogTail(context, "dev-stack-stderr");
  const stdout = await readDevStackLogTail(context, "dev-stack-stdout");
  const spawnError = await readDevStackLogTail(context, "dev-stack-spawn-error");
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
    E2E_TIMEOUTS.devStackMs,
    async (signal) => startDevStackInner(context, signal),
    () => devStackTimeoutDetails(context),
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

  logHarnessPhase("Waiting for Vite dev server...");
  await waitForWebDevServer(context.webPort, E2E_TIMEOUTS.devStackMs, signal);
  logHarnessPhase("Vite dev server is ready.");

  return { process: child };
}
