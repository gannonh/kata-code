import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

import { appendProcessLog } from "./artifacts.ts";
import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { assertDesktopBuildArtifacts } from "./desktopArtifacts.ts";
import { startDevStack } from "./devStack.ts";
import type { E2ERunContext } from "./isolatedRun.ts";
import { registerCleanup } from "./isolatedRun.ts";
import { logHarnessPhase } from "./log.ts";
import { killPids, listDescendantPids, signalProcessTree } from "./processTree.ts";
import { resolveReleaseExecutablePath } from "./releaseTarget.ts";
import { buildElectronLaunchEnv, isRendererWindow, resolveRendererTarget } from "./launchEnv.ts";

const ELECTRON_CLOSE_TIMEOUT_MS = 5_000;

async function closeElectronApp(app: ElectronApplication): Promise<void> {
  // Snapshot the tree before closing: Electron main spawns the embedded
  // server as a child (apps/server bin via --bootstrap-fd). If main dies
  // without cleanup the child orphans to PID 1 and keeps listening on the
  // run's server port, poisoning any later run that reuses the offset.
  // Capture descendants now — once main exits they reparent and disappear
  // from a post-close `signalProcessTree(mainPid)` walk.
  const mainPid = app.process().pid;
  const descendants =
    mainPid !== undefined ? listDescendantPids(mainPid) : ([] as readonly number[]);

  let settled = false;
  const close = app
    .close()
    .catch(() => undefined)
    .finally(() => {
      settled = true;
    });

  await Promise.race([close, delay(ELECTRON_CLOSE_TIMEOUT_MS)]);
  if (!settled) {
    try {
      app.process().kill("SIGKILL");
    } catch {
      // The process exited between the timeout check and the forced kill.
    }
  }

  // Reap the pre-close snapshot first so orphans that reparented to PID 1
  // during graceful close are still killed. Then re-walk mainPid for any
  // children spawned during the grace window (same policy as terminateProcessTree).
  killPids(descendants, "SIGKILL");
  if (mainPid !== undefined) {
    signalProcessTree(mainPid, "SIGKILL");
  }
}

async function resolveDevElectronLaunchCommand(
  args: string[],
  context: E2ERunContext,
): Promise<{ readonly electronPath: string; readonly args: string[] }> {
  // The launcher reads KATACODE_ELECTRON_RUNTIME_DIR and
  // KATACODE_DEV_BUNDLE_ID_SUFFIX from process.env to pick a per-worker cache
  // dir and a unique dev app bundle id. Set them for the in-process launcher
  // call so parallel workers don't clobber a shared .electron-runtime or collide
  // on macOS single-instance launch services.
  process.env.KATACODE_ELECTRON_RUNTIME_DIR = context.electronRuntimeDir;
  process.env.KATACODE_DEV_BUNDLE_ID_SUFFIX = context.devEnv.KATACODE_DEV_BUNDLE_ID_SUFFIX;
  const { resolveRawElectronLaunchCommand } =
    await import("../../../apps/desktop/scripts/electron-launcher.mjs");
  // The macOS `.app` dev launcher boots a 2s auth-callback shim that exits when
  // Playwright passes `main.cjs`. Use the raw Electron binary like dev-electron.
  return resolveRawElectronLaunchCommand(args);
}

function attachElectronLogging(context: E2ERunContext, app: ElectronApplication): void {
  // Main-process output carries embedded-server crash traces that the
  // renderer console never sees; without it a mid-test backend death is
  // undiagnosable from artifacts.
  const main = app.process();
  main.stdout?.on("data", (chunk: Buffer) => {
    void appendProcessLog(context, "electron-main-stdout", chunk.toString("utf8"));
  });
  main.stderr?.on("data", (chunk: Buffer) => {
    void appendProcessLog(context, "electron-main-stderr", chunk.toString("utf8"));
  });
  app.on("window", (page) => {
    page.on("console", (message) => {
      void appendProcessLog(context, "renderer-console", `[${message.type()}] ${message.text()}\n`);
    });
    page.on("pageerror", (error) => {
      void appendProcessLog(
        context,
        "renderer-pageerror",
        `${error.message}\n${error.stack ?? ""}\n`,
      );
    });
  });
}

export function attachFatalLaunchErrorTracking(page: Page): () => readonly string[] {
  const errors: string[] = [];
  const record = (message: string) => {
    errors.push(message);
  };

  page.on("pageerror", (error) => {
    record(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      record(message.text());
    }
  });

  return () => errors;
}

export interface LaunchedApp {
  readonly electronApp: ElectronApplication;
  readonly window: Page;
  readonly readFatalErrors: () => readonly string[];
}

async function resolveRendererWindow(
  electronApp: ElectronApplication,
  rendererPort: number,
  rendererPortLabel: string,
  timeoutMs: number,
): Promise<Page> {
  const deadline = Date.now() + timeoutMs;

  return await new Promise<Page>((resolve, reject) => {
    const fail = (error: Error) => {
      electronApp.off("close", onClose);
      reject(error);
    };

    const onClose = () => {
      const windowUrls = electronApp.windows().map((page) => page.url());
      fail(
        new Error(
          `Electron exited before the renderer window opened (expected ${rendererPortLabel} on port ${rendererPort}). Last windows: ${windowUrls.join(", ") || "(none)"}`,
        ),
      );
    };

    electronApp.once("close", onClose);

    const poll = async () => {
      while (Date.now() < deadline) {
        for (const page of electronApp.windows()) {
          const url = page.url();
          if (isRendererWindow(url, rendererPort)) {
            electronApp.off("close", onClose);
            resolve(page);
            return;
          }
        }

        await delay(250);
      }

      const windowUrls = electronApp.windows().map((page) => page.url());
      fail(
        new Error(
          `Electron renderer window not found within ${timeoutMs}ms (expected ${rendererPortLabel} on port ${rendererPort}). Open windows: ${windowUrls.join(", ") || "(none)"}`,
        ),
      );
    };

    void poll().catch(fail);
  });
}

export async function launchApp(context: E2ERunContext): Promise<LaunchedApp> {
  const repoDesktopDir = join(context.repoRoot, "apps/desktop");

  if (context.launchTarget === "dev") {
    await assertDesktopBuildArtifacts(context.repoRoot);
    await startDevStack(context);
  } else {
    // Release target binds the embedded server on serverPort inside Electron;
    // release the placeholder claim so that bind succeeds. (Dev target's claim
    // is released inside startDevStack right before Vite binds.)
    await context.releasePortClaim();
  }

  const env = buildElectronLaunchEnv(context);
  const { port: rendererPort, label: rendererPortLabel } = resolveRendererTarget(context);

  const remoteDebuggingPort = context.devEnv.KATACODE_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
  const launchArgs = [
    ...(remoteDebuggingPort ? [`--remote-debugging-port=${remoteDebuggingPort}`] : []),
    `--katacode-dev-root=${repoDesktopDir}`,
    "dist-electron/main.cjs",
  ];
  logHarnessPhase("Launching Electron...");

  let electronApp: ElectronApplication;
  if (context.launchTarget === "release") {
    electronApp = await electron.launch({
      executablePath: resolveReleaseExecutablePath(),
      env,
    });
  } else {
    const devLaunch = await resolveDevElectronLaunchCommand(launchArgs, context);
    electronApp = await electron.launch({
      executablePath: devLaunch.electronPath,
      args: devLaunch.args,
      cwd: repoDesktopDir,
      env,
    });
  }
  registerCleanup(context, () => closeElectronApp(electronApp));

  attachElectronLogging(context, electronApp);
  logHarnessPhase("Waiting for the Electron renderer window...");
  const window = await resolveRendererWindow(
    electronApp,
    rendererPort,
    rendererPortLabel,
    E2E_TIMEOUTS.electronWindowMs,
  );
  logHarnessPhase("Electron renderer window is ready.");

  const readFatalErrors = attachFatalLaunchErrorTracking(window);

  return { electronApp, window, readFatalErrors };
}
