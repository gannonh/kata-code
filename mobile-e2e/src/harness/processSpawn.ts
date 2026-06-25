import { type ChildProcess, spawn } from "node:child_process";

import { appendProcessLog } from "./artifacts.ts";

export interface CompletedCommand {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Single-shot settle guard for child watches that can resolve via stdout scan, close,
 * error, or timeout. Guarantees the first settle wins even under racing events.
 */
export class SettleGuard {
  private settled = false;
  private readonly timer: NodeJS.Timeout | undefined;

  constructor(options: { readonly timeoutMs: number; readonly onTimeout: () => void }) {
    this.timer = setTimeout(() => {
      this.finish(options.onTimeout);
    }, options.timeoutMs);
    this.timer.unref();
  }

  finish(fn: () => void): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    fn();
  }

  get isSettled(): boolean {
    return this.settled;
  }
}

/** Tee a chunk to a process log; surface write failures rather than swallow them. */
export async function logProcessChunk(
  artifactRoot: string,
  label: string,
  chunk: string,
): Promise<void> {
  try {
    await appendProcessLog(artifactRoot, label, chunk);
  } catch (error) {
    process.stderr.write(
      `[mobile-e2e] failed to append ${label}.log: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
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
  const { command, args, env, cwd, timeoutMs, label, artifactRoot } = input;
  return await new Promise<CompletedCommand>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, env });
    let stdout = "";
    let stderr = "";

    const guard = new SettleGuard({
      timeoutMs,
      onTimeout: () => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `${label}: timed out after ${timeoutMs}ms running \`${command} ${args.join(" ")}\`.`,
          ),
        );
      },
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) =>
      guard.finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
    child.once("close", (code) =>
      guard.finish(() => {
        void logProcessChunk(
          artifactRoot,
          label,
          `$ ${command} ${args.join(" ")}\n${stdout}${stderr}\n`,
        );
        resolve({ code, stdout, stderr });
      }),
    );
  });
}

/**
 * Escalate a child from `primarySignal` to SIGKILL after a grace window, resolving
 * once the child has exited. `primarySignal` differs by caller: `xcrun simctl io
 * recordVideo` flushes its file only on SIGINT, so screen recording uses SIGINT;
 * long-lived servers use SIGTERM. Resolves immediately if the child already exited.
 */
export async function gracefulKill(input: {
  readonly child: ChildProcess;
  readonly primarySignal: NodeJS.Signals;
  readonly graceMs: number;
}): Promise<void> {
  const { child, primarySignal, graceMs } = input;
  // A child that already exited via signal has exitCode === null but a populated
  // signalCode; treat both as already exited so the promise can't hang waiting
  // for an `exit` event that already fired.
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.kill(primarySignal);
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, graceMs).unref();
  });
}

/** Back-compat alias for SIGTERM-first shutdown of an owned long-lived child. */
export async function terminateChildProcess(child: ChildProcess): Promise<void> {
  await gracefulKill({ child, primarySignal: "SIGTERM", graceMs: 5_000 });
}
