import { type ChildProcess, spawn } from "node:child_process";

import { appendProcessLog } from "./artifacts.ts";

export interface CompletedCommand {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run a command to completion, capturing output and teeing it to the run's artifact log. */
export async function runCommandToCompletion(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly label: string;
  readonly artifactRoot: string;
}): Promise<CompletedCommand> {
  return await new Promise<CompletedCommand>((resolve, reject) => {
    const child = spawn(input.command, [...input.args], { cwd: input.cwd, env: input.env });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `${input.label}: timed out after ${input.timeoutMs}ms running \`${input.command} ${input.args.join(" ")}\`.`,
        ),
      );
    }, input.timeoutMs);
    timer.unref();

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      void appendProcessLog(
        input.artifactRoot,
        input.label,
        `$ ${input.command} ${input.args.join(" ")}\n${stdout}${stderr}\n`,
      );
      resolve({ code, stdout, stderr });
    });
  });
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
