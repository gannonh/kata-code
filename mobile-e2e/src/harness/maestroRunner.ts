import { spawn, spawnSync } from "node:child_process";

import { toMaestroTag } from "../config/tags.ts";
import { formatMissingPrerequisiteError } from "./env.ts";
import { logHarnessPhase } from "./log.ts";
import { gracefulKill } from "./processSpawn.ts";

export interface MaestroRunOptions {
  /** Maestro flow file paths to run (Maestro does not recurse subdirectories). */
  readonly flowPaths: readonly string[];
  /** Tags to filter on; `@`-prefixed or bare both accepted. */
  readonly includeTags?: readonly string[];
  /** Variables injected into flows via `-e KEY=VALUE` (`${KEY}` interpolation). */
  readonly env?: Record<string, string>;
  readonly format?: "junit" | "noop";
  readonly outputPath?: string;
  /** Directory for Maestro screenshots / view hierarchy on failure. */
  readonly debugOutputPath?: string;
  /** Bound on the whole `maestro test` invocation; kills the run on expiry. */
  readonly timeoutMs?: number;
}

/** Build the argv for `maestro <args>`. Pure so the mapping is unit-tested. */
export function buildMaestroArgs(options: MaestroRunOptions): string[] {
  const args: string[] = ["test"];

  if (options.includeTags && options.includeTags.length > 0) {
    args.push("--include-tags", options.includeTags.map(toMaestroTag).join(","));
  }
  if (options.format) {
    args.push("--format", options.format);
  }
  if (options.outputPath) {
    args.push("--output", options.outputPath);
  }
  if (options.debugOutputPath) {
    args.push("--debug-output", options.debugOutputPath);
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }

  args.push(...options.flowPaths);
  return args;
}

export function assertMaestroInstalled(): void {
  const result = spawnSync("maestro", ["--version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${formatMissingPrerequisiteError("Maestro CLI", ["maestro"])} Install with: curl -fsSL "https://get.maestro.mobile.dev" | bash`,
    );
  }
}

export interface MaestroResult {
  readonly code: number | null;
}

/** Run Maestro, streaming its reporter output to the terminal. */
export async function runMaestro(
  options: MaestroRunOptions,
  spawnEnv: NodeJS.ProcessEnv,
): Promise<MaestroResult> {
  const args = buildMaestroArgs(options);
  // Redact injected `-e KEY=VALUE` pairs (pairing tokens, auth emails) so the
  // harness log never leaks secrets while still logging the real command shape.
  const redactedArgs = args.map((arg, index) =>
    args[index - 1] === "-e" ? `${arg.split("=", 1)[0]}=<redacted>` : arg,
  );
  logHarnessPhase(`maestro ${redactedArgs.join(" ")}`);
  return await new Promise<MaestroResult>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const finish = (code: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve({ code });
    };

    const child = spawn("maestro", args, { stdio: "inherit", env: spawnEnv });
    child.once("error", reject);
    // A timeout must win over a normal close arriving during graceful shutdown,
    // so the timeout sentinel (124) is preserved rather than the real exit code.
    child.once("close", (code) => finish(timedOut ? 124 : code));

    if (options.timeoutMs) {
      const timer = setTimeout(() => {
        timedOut = true;
        logHarnessPhase(`maestro timed out after ${options.timeoutMs}ms; killing run`);
        void gracefulKill({ child, primarySignal: "SIGTERM", graceMs: 5_000 }).catch(() =>
          finish(124),
        );
      }, options.timeoutMs);
      timer.unref();
      child.once("close", () => clearTimeout(timer));
    }
  });
}
