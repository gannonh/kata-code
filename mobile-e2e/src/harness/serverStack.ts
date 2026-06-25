import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { formatMissingPrerequisiteError, readConfiguredProjectPath } from "./env.ts";
import { type MobileE2ERunContext, registerCleanup } from "./isolatedRun.ts";
import { logHarnessPhase } from "./log.ts";
import {
  logProcessChunk,
  runCommandToCompletion,
  SettleGuard,
  terminateChildProcess,
} from "./processSpawn.ts";
import { seedWorkspace } from "./seededWorkspace.ts";
import { MOBILE_E2E_TIMEOUTS } from "../config/timeouts.ts";

export interface ServePairingInfo {
  readonly connectionString: string;
  /** `host:port` with the scheme stripped, for the Add-Environment pairing form. */
  readonly host: string;
  readonly token: string;
}

export interface ServerStackHandle {
  readonly process: ChildProcess;
  readonly pairing: ServePairingInfo;
}

/**
 * Parse the headless `katacode serve` output into pairing inputs. Returns undefined
 * until both the connection string and one-time token have been printed, so a stdout
 * scanner can keep waiting rather than pairing with a missing token.
 */
export function parseServeOutput(text: string): ServePairingInfo | undefined {
  const connectionString = text.match(/Connection string:\s*(\S+)/)?.[1];
  const token = text.match(/Token:\s*(\S+)/)?.[1];
  if (!connectionString || !token) {
    return undefined;
  }
  const host = connectionString.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  return { connectionString, host, token };
}

export function resolveServerBinPath(repoRoot: string): string {
  const bin = join(repoRoot, "apps", "server", "dist", "bin.mjs");
  if (!existsSync(bin)) {
    throw new Error(
      `${formatMissingPrerequisiteError("katacode server CLI", ["apps/server/dist/bin.mjs"])} Build the server before running mobile E2E.`,
    );
  }
  return bin;
}

/**
 * Start `katacode serve` over loopback, wait for the printed pairing output, then
 * register a runnable project with `project add` (serve does not auto-create one).
 */
export async function startServerStack(context: MobileE2ERunContext): Promise<ServerStackHandle> {
  const bin = resolveServerBinPath(context.repoRoot);
  const env = { ...context.baseEnv };

  logHarnessPhase(`starting katacode serve on 127.0.0.1:${context.serverPort}`);
  const child = spawn(
    process.execPath,
    [bin, "serve", "--port", String(context.serverPort), "--host", "127.0.0.1"],
    { cwd: context.repoRoot, env },
  );
  registerCleanup(context, () => terminateChildProcess(child));

  const pairing = await waitForServePairing(context, child);
  context.serverHost = pairing.host;

  const projectPath = await resolveProjectPath(context);
  await registerProject(context, bin, env, projectPath);
  context.projectPath = projectPath;

  return { process: child, pairing };
}

async function waitForServePairing(
  context: MobileE2ERunContext,
  child: ChildProcess,
): Promise<ServePairingInfo> {
  return await new Promise<ServePairingInfo>((resolve, reject) => {
    let buffer = "";
    const guard = new SettleGuard({
      timeoutMs: MOBILE_E2E_TIMEOUTS.serverStartMs,
      onTimeout: () =>
        reject(
          new Error(
            `katacode serve: timed out after ${MOBILE_E2E_TIMEOUTS.serverStartMs}ms waiting for pairing output. See ${context.artifactRoot}/serve-stdout.log.`,
          ),
        ),
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      buffer += text;
      void logProcessChunk(context.artifactRoot, "serve-stdout", text);
      const parsed = parseServeOutput(buffer);
      if (parsed) {
        guard.finish(() => resolve(parsed));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      void logProcessChunk(context.artifactRoot, "serve-stderr", chunk.toString());
    });
    child.once("error", (error) =>
      guard.finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
    child.once("exit", (code) =>
      guard.finish(() =>
        reject(new Error(`katacode serve exited (code ${code}) before printing pairing output.`)),
      ),
    );
  });
}

async function registerProject(
  context: MobileE2ERunContext,
  bin: string,
  env: NodeJS.ProcessEnv,
  projectPath: string,
): Promise<void> {
  logHarnessPhase(`registering project ${projectPath}`);
  const result = await runCommandToCompletion({
    command: process.execPath,
    args: [bin, "project", "add", projectPath],
    env,
    cwd: context.repoRoot,
    timeoutMs: MOBILE_E2E_TIMEOUTS.projectAddMs,
    label: "project-add",
    artifactRoot: context.artifactRoot,
  });
  if (result.code !== 0) {
    throw new Error(
      `katacode project add failed (code ${result.code}) for ${projectPath}. See ${context.artifactRoot}/project-add.log.`,
    );
  }
}

async function resolveProjectPath(context: MobileE2ERunContext): Promise<string> {
  const configured = readConfiguredProjectPath();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(
        `KATACODE_E2E_PROJECT_PATH points to a path that does not exist: ${configured}.`,
      );
    }
    return configured;
  }
  return await seedWorkspace(context, "mobile-e2e-basic");
}
