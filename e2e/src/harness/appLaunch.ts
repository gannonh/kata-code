import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

import { appendProcessLog } from "./artifacts.ts";
import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { cleanupStaleDesktopDevApps } from "./cleanupStaleDesktopDev.ts";
import { assertDesktopBuildArtifacts } from "./desktopArtifacts.ts";
import { startDevStack } from "./devStack.ts";
import type { E2ERunContext } from "./isolatedRun.ts";
import { registerCleanup } from "./isolatedRun.ts";
import { logHarnessPhase } from "./log.ts";
import { resolveReleaseExecutablePath } from "./releaseTarget.ts";
import { buildElectronLaunchEnv, isRendererWindow, resolveRendererTarget } from "./launchEnv.ts";

async function resolveDevElectronLaunchCommand(
  args: string[],
): Promise<{ readonly electronPath: string; readonly args: string[] }> {
  const { resolveRawElectronLaunchCommand } =
    await import("../../../apps/desktop/scripts/electron-launcher.mjs");
  // The macOS `.app` dev launcher boots a 2s auth-callback shim that exits when
  // Playwright passes `main.cjs`. Use the raw Electron binary like dev-electron.
  return resolveRawElectronLaunchCommand(args);
}

function attachElectronLogging(context: E2ERunContext, app: ElectronApplication): void {
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

function attachFatalLaunchErrorTracking(page: Page): () => readonly string[] {
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
  signal: AbortSignal,
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
        if (signal.aborted) {
          fail(signal.reason instanceof Error ? signal.reason : new Error("Renderer wait aborted"));
          return;
        }

        for (const page of electronApp.windows()) {
          const url = page.url();
          if (isRendererWindow(url, rendererPort)) {
            electronApp.off("close", onClose);
            resolve(page);
            return;
          }
        }

        await delay(250, undefined, { signal });
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
    cleanupStaleDesktopDevApps(context.repoRoot);
    await assertDesktopBuildArtifacts(context.repoRoot);
    await startDevStack(context);
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
    const devLaunch = await resolveDevElectronLaunchCommand(launchArgs);
    electronApp = await electron.launch({
      executablePath: devLaunch.electronPath,
      args: devLaunch.args,
      cwd: repoDesktopDir,
      env,
    });
  }
  registerCleanup(context, async () => {
    await electronApp.close();
  });

  attachElectronLogging(context, electronApp);
  logHarnessPhase("Waiting for the Electron renderer window...");
  const window = await resolveRendererWindow(
    electronApp,
    rendererPort,
    rendererPortLabel,
    E2E_TIMEOUTS.electronWindowMs,
    AbortSignal.timeout(E2E_TIMEOUTS.electronWindowMs),
  );
  logHarnessPhase("Electron renderer window is ready.");

  const readFatalErrors = attachFatalLaunchErrorTracking(window);

  return { electronApp, window, readFatalErrors };
}
