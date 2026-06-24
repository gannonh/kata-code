import { spawn } from "node:child_process";

import { formatMissingPrerequisiteError, readConfiguredSimulator } from "./env.ts";
import { type MobileE2ERunContext } from "./isolatedRun.ts";
import { logHarnessPhase } from "./log.ts";
import { runCommandToCompletion } from "./processSpawn.ts";
import { MOBILE_E2E_TIMEOUTS } from "../config/timeouts.ts";

/** Bundle id of the dev variant the suite drives (see app.config.ts). */
export const DEV_CLIENT_BUNDLE_ID = "com.katacode.dev";

export interface SimulatorDevice {
  readonly udid: string;
  readonly name: string;
  readonly state: string;
}

interface RawSimctlDevice {
  readonly udid?: string;
  readonly name?: string;
  readonly state?: string;
  readonly isAvailable?: boolean;
}

/**
 * Choose a simulator from `xcrun simctl list devices --json`. With a preference,
 * match by name or udid (any state, since the caller boots it). Otherwise prefer
 * an already-booted device, falling back to the first available one. Unavailable
 * devices are never selected. Pure so the selection rules are unit-tested.
 */
export function selectSimulator(
  simctlJson: string,
  preferred?: string,
): SimulatorDevice | undefined {
  const parsed = JSON.parse(simctlJson) as { devices?: Record<string, RawSimctlDevice[]> };
  const devices: SimulatorDevice[] = [];
  for (const list of Object.values(parsed.devices ?? {})) {
    for (const device of list) {
      if (device.isAvailable && device.udid && device.name && device.state) {
        devices.push({ udid: device.udid, name: device.name, state: device.state });
      }
    }
  }

  if (preferred) {
    return devices.find((device) => device.udid === preferred || device.name === preferred);
  }
  return devices.find((device) => device.state === "Booted") ?? devices[0];
}

async function listSimulators(context: MobileE2ERunContext): Promise<string> {
  const result = await runCommandToCompletion({
    command: "xcrun",
    args: ["simctl", "list", "devices", "--json"],
    env: context.baseEnv,
    cwd: context.repoRoot,
    timeoutMs: MOBILE_E2E_TIMEOUTS.simulatorBootMs,
    label: "simctl-list",
    artifactRoot: context.artifactRoot,
  });
  if (result.code !== 0) {
    throw new Error(
      "xcrun simctl list failed. Ensure Xcode and an iOS Simulator runtime are installed.",
    );
  }
  return result.stdout;
}

/** Resolve a target simulator, booting it if needed, and record its udid on the run. */
export async function ensureSimulator(context: MobileE2ERunContext): Promise<string> {
  const preferred = readConfiguredSimulator();
  const device = selectSimulator(await listSimulators(context), preferred);
  if (!device) {
    throw new Error(
      preferred
        ? `No available simulator matched KATACODE_E2E_SIMULATOR=${preferred}. List with: xcrun simctl list devices available`
        : "No available iOS simulator found. Install a runtime with: xcodebuild -downloadPlatform iOS",
    );
  }

  if (device.state !== "Booted") {
    logHarnessPhase(`booting simulator ${device.name} (${device.udid})`);
    await runCommandToCompletion({
      command: "xcrun",
      args: ["simctl", "bootstatus", device.udid, "-b"],
      env: context.baseEnv,
      cwd: context.repoRoot,
      timeoutMs: MOBILE_E2E_TIMEOUTS.simulatorBootMs,
      label: "simctl-boot",
      artifactRoot: context.artifactRoot,
    });
  }

  context.simulatorUdid = device.udid;
  return device.udid;
}

/** Fail loud unless the dev client is already installed on the simulator. */
export async function assertDevClientInstalled(context: MobileE2ERunContext): Promise<void> {
  const udid = context.simulatorUdid;
  if (!udid) {
    throw new Error("assertDevClientInstalled called before a simulator was booted.");
  }
  const result = await runCommandToCompletion({
    command: "xcrun",
    args: ["simctl", "get_app_container", udid, DEV_CLIENT_BUNDLE_ID, "app"],
    env: context.baseEnv,
    cwd: context.repoRoot,
    timeoutMs: MOBILE_E2E_TIMEOUTS.projectAddMs,
    label: "simctl-app-container",
    artifactRoot: context.artifactRoot,
  });
  if (result.code !== 0) {
    throw new Error(
      `${formatMissingPrerequisiteError("installed dev client", [DEV_CLIENT_BUNDLE_ID])} Build it once with: vp run e2e:mobile:build`,
    );
  }
}

/** Launch Maestro Studio against the booted simulator for interactive authoring. */
export async function launchMaestroStudio(spawnEnv: NodeJS.ProcessEnv): Promise<number | null> {
  logHarnessPhase("launching maestro studio");
  return await new Promise<number | null>((resolve, reject) => {
    const child = spawn("maestro", ["studio"], { stdio: "inherit", env: spawnEnv });
    child.once("error", reject);
    child.once("close", (code) => resolve(code));
  });
}
