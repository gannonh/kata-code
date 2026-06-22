import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

import { appendProcessLog } from "./artifacts.ts";
import type { E2ERunContext } from "./isolatedRun.ts";

export interface LoggedChildProcess {
  readonly process: ChildProcess;
}

function openArtifactLogFd(artifactRoot: string, label: string): number {
  mkdirSync(artifactRoot, { recursive: true });
  return openSync(join(artifactRoot, `${label}.log`), "a");
}

export function spawnWithArtifactLogs(
  context: E2ERunContext,
  input: {
    readonly label: string;
    readonly command: string;
    readonly args: readonly string[];
    readonly env: NodeJS.ProcessEnv;
    readonly cwd: string;
  },
): LoggedChildProcess {
  const stdoutFd = openArtifactLogFd(context.artifactRoot, `${input.label}-stdout`);
  const stderrFd = openArtifactLogFd(context.artifactRoot, `${input.label}-stderr`);

  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", stdoutFd, stderrFd],
  });

  closeSync(stdoutFd);
  closeSync(stderrFd);

  child.on("error", (error) => {
    void appendProcessLog(
      context,
      `${input.label}-spawn-error`,
      `${input.command} ${input.args.join(" ")}\ncwd=${input.cwd}\n${error.message}\n`,
    );
  });

  return { process: child };
}

export async function terminateChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    if (child.exitCode !== null) {
      resolve();
      return;
    }

    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGKILL");
      }
    }, 5_000).unref();
  });
}
