import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveArtifactRoot } from "./artifacts.ts";
import { findAvailablePortOffset, resolveStartOffsetFromEnv } from "./ports.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface MobileE2ERunContext {
  readonly runId: string;
  readonly tags: readonly string[];
  readonly repoRoot: string;
  readonly katacodeHome: string;
  readonly serverPort: number;
  readonly artifactRoot: string;
  readonly baseEnv: NodeJS.ProcessEnv;
  /** Resolved once a simulator is booted. */
  simulatorUdid: string | null;
  /** Resolved once `katacode serve` prints its connection string (e.g. `127.0.0.1:3773`). */
  serverHost: string | null;
  /** The repo path registered via `project add` (seeded or user-supplied). */
  projectPath: string | null;
  /** Cleanup callbacks registered during the run; run to completion in `cleanupRunState`. */
  readonly cleanupCallbacks: Array<() => Promise<void> | void>;
}

function createRunId(): string {
  return `mobile-e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

export async function createIsolatedRun(input: {
  readonly tags: readonly string[];
}): Promise<MobileE2ERunContext> {
  const runId = createRunId();
  const { offset: startOffset } = resolveStartOffsetFromEnv();
  const { serverPort } = await findAvailablePortOffset(startOffset);
  const katacodeHome = await mkdtemp(join(tmpdir(), `katacode-mobile-e2e-home-${runId}-`));
  const artifactRoot = join(resolveArtifactRoot(), runId);

  const baseEnv = {
    ...process.env,
    KATACODE_HOME: katacodeHome,
    HOST: "127.0.0.1",
    KATACODE_NO_BROWSER: "1",
    KATACODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
  } satisfies NodeJS.ProcessEnv;

  const cleanupCallbacks: Array<() => Promise<void> | void> = [
    async () => {
      await rm(katacodeHome, { recursive: true, force: true });
    },
  ];

  return {
    runId,
    tags: input.tags,
    repoRoot,
    katacodeHome,
    serverPort,
    artifactRoot,
    baseEnv,
    simulatorUdid: null,
    serverHost: null,
    projectPath: null,
    cleanupCallbacks,
  };
}

/** Register a cleanup callback to run (LIFO) when the run tears down. */
export function registerCleanup(
  context: MobileE2ERunContext,
  callback: () => Promise<void> | void,
): void {
  context.cleanupCallbacks.push(callback);
}

/** Run registered cleanup callbacks in reverse order. Safe to call unconditionally in `finally`. */
export async function cleanupRunState(context: MobileE2ERunContext): Promise<void> {
  // Run every callback to completion even if one rejects, so a single failing
  // teardown step can't leak temp state or child processes registered later.
  const errors: unknown[] = [];
  for (const callback of [...context.cleanupCallbacks].toReversed()) {
    try {
      await callback();
    } catch (error) {
      errors.push(error);
    }
  }
  context.cleanupCallbacks.length = 0;
  if (errors.length === 1) {
    throw errors[0]!;
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "mobile-e2e cleanup failed");
  }
}
