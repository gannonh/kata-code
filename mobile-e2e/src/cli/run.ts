import { loadEnv } from "../config/loadEnv.ts";

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { type PairEnvKind, selectedDescriptors, tagMatches } from "../config/tags.ts";
import { buildAgentMaestroEnv } from "../flows/agent.ts";
import { buildAuthMaestroEnv } from "../flows/auth.ts";
import { buildPairingMaestroEnv } from "../flows/pairing.ts";
import {
  type RunManifest,
  resolveMaestroOutputRoot,
  resolveMobileE2eRoot,
  resolveRepoRoot,
  writeRunManifest,
} from "../harness/artifacts.ts";
import { assertMacOsHost, isVideoEnabled } from "../harness/env.ts";
import {
  cleanupRunState,
  createIsolatedRun,
  type MobileE2ERunContext,
} from "../harness/isolatedRun.ts";
import { logHarnessPhase } from "../harness/log.ts";
import { assertMaestroInstalled, runMaestro } from "../harness/maestroRunner.ts";
import { type ResolvedCredentials, requirePrereqs, runNeedsServer } from "../harness/prereqs.ts";
import { type ServePairingInfo, startServerStack } from "../harness/serverStack.ts";
import {
  DEV_CLIENT_BUNDLE_ID,
  assertDevClientInstalled,
  ensureSimulator,
  launchMaestroStudio,
  type ScreenRecording,
  startScreenRecording,
  stopScreenRecording,
} from "../harness/simulator.ts";
import { type CliOptions, parseCliArgs } from "./args.ts";
import { discoverFlows } from "./flows.ts";

function maestroFlowDir(): string {
  return join(resolveMobileE2eRoot(), "maestro");
}

/** Resolve absolute paths for flows whose tags intersect the selection (all if no tags). */
export function resolveFlowPaths(selection: readonly string[]): string[] {
  const dir = maestroFlowDir();
  const flows = discoverFlows();
  const matching = flows.filter(
    // An empty selection runs every discovered flow, including untagged ones,
    // so `[].some(...)` returning false must not silently exclude them.
    (flow) => selection.length === 0 || flow.tags.some((tag) => tagMatches(selection, tag)),
  );
  return matching.map((flow) => join(dir, flow.relativePath));
}

function buildManifest(context: MobileE2ERunContext): RunManifest {
  return {
    runId: context.runId,
    tags: context.tags,
    katacodeHome: context.katacodeHome,
    serverPort: context.serverPort,
    serverHost: context.serverHost ?? "n/a",
    simulatorUdid: context.simulatorUdid,
    appBundleId: DEV_CLIENT_BUNDLE_ID,
    artifactRoot: context.artifactRoot,
    projectPath: context.projectPath,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build the runner timeout from the selected flows: the slowest descriptor wins,
 * so an `--include-tags @agent` run gets the agent round-trip budget even when
 * composed with a faster flow.
 */
export function resolveRunTimeoutMs(selection: readonly string[]): number {
  const descriptors = selectedDescriptors(selection);
  return Math.max(...descriptors.map((descriptor) => descriptor.timeoutMs));
}

/**
 * Maestro variables for the selected flows, derived from the descriptor table:
 * pairing env (when a server is running), the `@auth` Google email, and the
 * `@agent` deterministic-prompt token + model-picker labels. Pure given the
 * resolved credentials and pairing info.
 */
export function buildMaestroEnv(input: {
  readonly selection: readonly string[];
  readonly runId: string;
  readonly credentials: ResolvedCredentials;
  readonly pairing: ServePairingInfo | null;
}): Record<string, string> {
  const builders: Record<PairEnvKind, () => Record<string, string>> = {
    none: () => ({}),
    pairing: () => (input.pairing ? buildPairingMaestroEnv(input.pairing) : {}),
    auth: () => buildAuthMaestroEnv(input.credentials),
    agent: () => buildAgentMaestroEnv(input.runId),
  };
  const env: Record<string, string> = {};
  for (const descriptor of selectedDescriptors(input.selection)) {
    // Flows that compose the bearer-pairing subflow (pairing, agent) need
    // KC_HOST/KC_TOKEN injected alongside their own env.
    if (descriptor.needsPairingVars && input.pairing) {
      Object.assign(env, buildPairingMaestroEnv(input.pairing));
    }
    Object.assign(env, builders[descriptor.pairEnv]());
  }
  return env;
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: vp run e2e:mobile -- [--include-tags <tag,...>] [--list] [--studio]",
      "",
      "  --include-tags   Run only flows with the given Maestro tags (@smoke, @pairing, @auth, @agent)",
      "  --list           List discovered flows and their tags, then exit",
      "  --studio         Boot the simulator, verify the dev client, and open Maestro Studio",
      "  --help           Show this help",
      "",
      "See mobile-e2e/README.md for prerequisites and environment variables.",
      "",
    ].join("\n"),
  );
}

function runList(): number {
  const flows = discoverFlows();
  logHarnessPhase(`discovered ${flows.length} flow(s) under maestro/:`);
  for (const flow of flows) {
    process.stdout.write(
      `  ${flow.relativePath}${flow.tags.length ? `  ${flow.tags.join(" ")}` : ""}\n`,
    );
  }
  return 0;
}

async function runStudio(): Promise<number> {
  assertMacOsHost();
  assertMaestroInstalled();
  const context = await createIsolatedRun({ tags: [] });
  try {
    await ensureSimulator(context);
    await assertDevClientInstalled(context);
    return (await launchMaestroStudio(context.baseEnv)) ?? 0;
  } finally {
    await cleanupRunState(context);
  }
}

async function runFlows(options: CliOptions): Promise<number> {
  const credentials = requirePrereqs({ repoRoot: resolveRepoRoot(), tags: options.tags });

  const context = await createIsolatedRun({ tags: options.tags });
  let recording: ScreenRecording | null = null;
  try {
    await ensureSimulator(context);
    await assertDevClientInstalled(context);

    let pairing: ServePairingInfo | null = null;
    if (runNeedsServer(options.tags)) {
      const stack = await startServerStack(context);
      pairing = stack.pairing;
    }

    if (isVideoEnabled() && context.simulatorUdid) {
      recording = await startScreenRecording(
        context.simulatorUdid,
        join(context.artifactRoot, "recording.mp4"),
      );
    }

    const result = await runMaestro(
      {
        flowPaths: resolveFlowPaths(options.tags),
        includeTags: options.tags,
        env: buildMaestroEnv({
          selection: options.tags,
          runId: context.runId,
          credentials,
          pairing,
        }),
        format: "junit",
        outputPath: join(context.artifactRoot, "report.xml"),
        debugOutputPath: join(resolveMaestroOutputRoot(), context.runId),
        timeoutMs: resolveRunTimeoutMs(options.tags),
      },
      context.baseEnv,
    );

    return result.code ?? 1;
  } finally {
    // Run every cleanup step even if an earlier one throws, so a recording
    // flush failure can't skip the manifest write or run-state teardown.
    const cleanupErrors: unknown[] = [];
    if (recording) {
      try {
        await stopScreenRecording(recording);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      const manifestPath = await writeRunManifest(buildManifest(context));
      logHarnessPhase(`run manifest: ${manifestPath}`);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await cleanupRunState(context);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length === 1) {
      throw cleanupErrors[0]!;
    }
    if (cleanupErrors.length > 1) {
      throw new AggregateError(cleanupErrors, "Mobile E2E cleanup failed");
    }
  }
}

async function main(): Promise<number> {
  loadEnv();
  const options = parseCliArgs(process.argv.slice(2));
  switch (options.mode) {
    case "help":
      printHelp();
      return 0;
    case "list":
      return runList();
    case "studio":
      return await runStudio();
    case "run":
      return await runFlows(options);
  }
}

// Run only when invoked as the CLI entrypoint, not when imported (e.g. by tests).
// The package script (`e2e:mobile`) points directly at this file.
const entryHref = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (entryHref) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
