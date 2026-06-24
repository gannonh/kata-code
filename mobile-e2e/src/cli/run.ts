import "../config/loadEnv.ts";

import { join } from "node:path";

import { buildPairingMaestroEnv } from "../flows/pairing.ts";
import {
  type RunManifest,
  resolveMaestroOutputRoot,
  resolveMobileE2eRoot,
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
import { requirePrereqs, runNeedsServer } from "../harness/prereqs.ts";
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

function buildMaestroEnv(pairing: ServePairingInfo | null): Record<string, string> {
  return pairing ? buildPairingMaestroEnv(pairing) : {};
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
  requirePrereqs({ repoRoot: resolveMobileE2eRoot(), tags: options.tags });

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
      recording = startScreenRecording(
        context.simulatorUdid,
        join(context.artifactRoot, "recording.mp4"),
      );
    }

    const result = await runMaestro(
      {
        flowPath: maestroFlowDir(),
        includeTags: options.tags,
        env: buildMaestroEnv(pairing),
        format: "junit",
        outputPath: join(context.artifactRoot, "report.xml"),
        debugOutputPath: join(resolveMaestroOutputRoot(), context.runId),
      },
      context.baseEnv,
    );

    return result.code ?? 1;
  } finally {
    if (recording) {
      await stopScreenRecording(recording);
    }
    const manifestPath = await writeRunManifest(buildManifest(context));
    logHarnessPhase(`run manifest: ${manifestPath}`);
    await cleanupRunState(context);
  }
}

async function main(): Promise<number> {
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

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
