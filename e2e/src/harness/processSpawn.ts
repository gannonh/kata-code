import { type ChildProcess, spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { appendProcessLog } from "./artifacts.ts";
import type { E2ERunContext } from "./isolatedRun.ts";
import { killPids, listDescendantPids } from "./processTree.ts";
import { trackSpawnedStack, untrackSpawnedStack } from "./spawnRegistry.ts";

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
    readonly onOutput?: (chunk: string) => void;
  },
): LoggedChildProcess {
  const pipeOutput = input.onOutput !== undefined;
  const stdoutFd = pipeOutput
    ? undefined
    : openArtifactLogFd(context.artifactRoot, `${input.label}-stdout`);
  const stderrFd = pipeOutput
    ? undefined
    : openArtifactLogFd(context.artifactRoot, `${input.label}-stderr`);

  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.env,
    stdio: ["ignore", pipeOutput ? "pipe" : stdoutFd!, pipeOutput ? "pipe" : stderrFd!],
    // Own process group so the whole tree (dev-runner -> Vite -> esbuild
    // workers) can be killed together via the negative PID. Without this only
    // the direct child is signalled and its descendants orphan as leaked
    // listeners that accumulate across runs.
    detached: true,
  });

  if (pipeOutput) {
    mkdirSync(context.artifactRoot, { recursive: true });
    const forward = (label: "stdout" | "stderr") => (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      input.onOutput?.(text);
      appendFileSync(join(context.artifactRoot, `${input.label}-${label}.log`), text);
    };
    child.stdout?.on("data", forward("stdout"));
    child.stderr?.on("data", forward("stderr"));
  } else {
    closeSync(stdoutFd!);
    closeSync(stderrFd!);
  }

  // Register the PID so a global teardown / signal handler can reap the group
  // even when Playwright skips fixture teardown (aborted run, crash, Ctrl-C).
  if (child.pid !== undefined) {
    trackSpawnedStack(child.pid);
    child.once("exit", () => {
      if (child.pid !== undefined) {
        untrackSpawnedStack(child.pid);
      }
    });
  }

  child.on("error", (error) => {
    void appendProcessLog(
      context,
      `${input.label}-spawn-error`,
      `${input.command} ${input.args.join(" ")}\ncwd=${input.cwd}\n${error.message}\n`,
    );
  });

  return { process: child };
}

/** Signal an entire process group by negative PID, ignoring "no such process". */
function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone, or never created (spawn failed) — nothing to reap.
  }
}

export async function terminateChildProcess(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  // Capture the tree before signaling: after the leader exits, surviving
  // descendants reparent to PID 1 and can no longer be found.
  const descendants = pid !== undefined ? listDescendantPids(pid) : [];
  if (child.exitCode !== null) {
    // The direct child already exited, but detached descendants can outlive
    // it; reap the rest so nothing leaks.
    if (pid !== undefined) killProcessGroup(pid, "SIGKILL");
    killPids(descendants, "SIGKILL");
    return;
  }
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));

  // Kill the whole group so Vite + esbuild descendants die with dev-runner.
  if (pid !== undefined) {
    killProcessGroup(pid, "SIGTERM");
  } else {
    child.kill("SIGTERM");
  }
  killPids(descendants, "SIGTERM");
  await Promise.race([exited, delay(5_000)]);

  // Always escalate to SIGKILL: the direct child can exit on SIGTERM while
  // descendants in other process groups (the watched server under `vp run`)
  // survive it and leak as orphans that degrade subsequent stack boots.
  if (pid !== undefined) {
    killProcessGroup(pid, "SIGKILL");
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The group kill already reaped the direct child.
    }
  } else if (!child.killed) {
    child.kill("SIGKILL");
  }
  killPids(descendants, "SIGKILL");

  // Teardown must remain bounded even if Node never observes the detached
  // child's exit event after a forced process-group kill.
  await Promise.race([exited, delay(1_000)]);
}
