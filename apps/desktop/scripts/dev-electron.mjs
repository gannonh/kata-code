import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import * as NodeOS from "node:os";
import { dirname, join } from "node:path";

import {
  desktopDir,
  resolveDevProtocolClient,
  resolveDevelopmentProtocolCallbackUrl,
  resolveElectronLaunchCommand,
  resolveRawElectronLaunchCommand,
} from "./electron-launcher.mjs";
import { waitForResources } from "./wait-for-resources.mjs";

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim();
if (!devServerUrl) {
  throw new Error("VITE_DEV_SERVER_URL is required for desktop development.");
}

const devServer = new URL(devServerUrl);
const port = Number.parseInt(devServer.port, 10);
if (!Number.isInteger(port) || port <= 0) {
  throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${devServerUrl}`);
}

const requiredFiles = [
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "../server/dist/bin.mjs",
];
const watchedDirectories = [
  { directory: "dist-electron", files: new Set(["main.cjs", "preload.cjs"]) },
  { directory: "../server/dist", files: new Set(["bin.mjs"]) },
];
const forcedShutdownTimeoutMs = 1_500;
const restartDebounceMs = 120;
const childTreeGracePeriodMs = 1_200;
const remoteDebuggingPort = process.env.KATACODE_DESKTOP_REMOTE_DEBUGGING_PORT?.trim();
const singletonLockDir = join(desktopDir, ".electron-runtime", "dev-electron.lock");
const singletonPidPath = join(singletonLockDir, "pid");
// oxlint-disable-next-line kata-code/no-global-process-runtime -- Standalone dev script has no Effect runtime.
const hostPlatform = NodeOS.platform();

function readPidFile(path) {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function logDevElectron(message, details = {}) {
  const payload = Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  process.stderr.write(`[dev-electron] ${message}${payload}\n`);
}

function watchedFileKey(directory, filename) {
  return `${directory}/${filename}`;
}

function readWatchedFileSnapshot(directory, filename) {
  try {
    const filePath = join(desktopDir, directory, filename);
    const stat = statSync(filePath);
    const bytes = readFileSync(filePath);
    return {
      exists: true,
      size: stat.size,
      mtimeMs: Math.round(stat.mtimeMs),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch (error) {
    return {
      exists: false,
      statError: error instanceof Error ? error.message : String(error),
    };
  }
}

function initializeWatchedFileFingerprints() {
  for (const { directory, files } of watchedDirectories) {
    for (const filename of files) {
      const snapshot = readWatchedFileSnapshot(directory, filename);
      if (snapshot.exists) {
        watchedFileFingerprints.set(watchedFileKey(directory, filename), snapshot.sha256);
      }
    }
  }
}

function shouldRestartForWatchedFileChange(directory, filename) {
  const key = watchedFileKey(directory, filename);
  const snapshot = readWatchedFileSnapshot(directory, filename);
  if (!snapshot.exists) {
    return { restart: false, changed: false, snapshot };
  }

  const previous = watchedFileFingerprints.get(key);
  watchedFileFingerprints.set(key, snapshot.sha256);
  return {
    restart: previous !== undefined && previous !== snapshot.sha256,
    changed: previous !== undefined && previous !== snapshot.sha256,
    previousSha256: previous ?? null,
    snapshot,
  };
}

function acquireSingletonOrExit() {
  mkdirSync(dirname(singletonLockDir), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(singletonLockDir);
      writeFileSync(singletonPidPath, `${process.pid}\n`);
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const existingPid = readPidFile(singletonPidPath);
      if (existingPid && processExists(existingPid)) {
        process.stderr.write(
          `Kata Code desktop dev launcher already running (pid ${existingPid}); reusing it.\n`,
        );
        process.exit(0);
      }

      rmSync(singletonLockDir, { recursive: true, force: true });
    }
  }

  process.stderr.write("Kata Code desktop dev launcher lock is busy; skipping duplicate launch.\n");
  process.exit(0);
}

function releaseSingleton() {
  if (readPidFile(singletonPidPath) === process.pid) {
    rmSync(singletonLockDir, { recursive: true, force: true });
  }
}

acquireSingletonOrExit();
process.once("exit", releaseSingleton);

await waitForResources({
  baseDir: desktopDir,
  files: requiredFiles,
  tcpHost: devServer.hostname,
  tcpPort: port,
});

const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

cleanupStaleDevApps();
const devProtocolClient = resolveDevProtocolClient();
if (devProtocolClient) {
  childEnv.KATACODE_DESKTOP_APP_USER_MODEL_ID = devProtocolClient.appBundleId;
  childEnv.KATACODE_DESKTOP_PROTOCOL_REGISTRATION_MANAGED = "1";
  childEnv.KATACODE_DESKTOP_PROTOCOL_CALLBACK_URL = resolveDevelopmentProtocolCallbackUrl();
}

let shuttingDown = false;
let restartTimer = null;
let currentApp = null;
let restartQueue = Promise.resolve();
const expectedExits = new WeakSet();
const watchers = [];
const watchedFileFingerprints = new Map();

function killChildTreeByPid(pid, signal) {
  if (hostPlatform === "win32" || typeof pid !== "number") {
    return;
  }

  spawnSync("pkill", [`-${signal}`, "-P", String(pid)], { stdio: "ignore" });
}

function cleanupStaleDevApps(reason = "startup") {
  if (hostPlatform === "win32") {
    return;
  }

  const result = spawnSync("pkill", ["-f", "--", `--katacode-dev-root=${desktopDir}`], {
    stdio: "ignore",
  });
  if (result.status === 0) {
    logDevElectron("cleaned stale dev app processes", { reason });
  }
}

function startApp() {
  if (shuttingDown || currentApp !== null) {
    return;
  }

  const electronArgs = remoteDebuggingPort
    ? [`--remote-debugging-port=${remoteDebuggingPort}`]
    : [];
  const launchArgs = [
    ...electronArgs,
    `--katacode-dev-root=${desktopDir}`,
    "dist-electron/main.cjs",
  ];
  const electronCommand = devProtocolClient
    ? resolveRawElectronLaunchCommand(launchArgs)
    : resolveElectronLaunchCommand(launchArgs);
  const app = spawn(electronCommand.electronPath, electronCommand.args, {
    cwd: desktopDir,
    env: childEnv,
    stdio: "inherit",
  });

  currentApp = app;
  logDevElectron("started app", { pid: app.pid ?? null });

  app.once("error", (error) => {
    if (currentApp === app) {
      currentApp = null;
    }

    logDevElectron("app process error", {
      message: error instanceof Error ? error.message : String(error),
    });

    if (!shuttingDown) {
      scheduleRestart("app-process-error");
    }
  });

  app.once("exit", (code, signal) => {
    if (currentApp === app) {
      currentApp = null;
    }

    const wasExpected = expectedExits.has(app);
    const exitedAbnormally = signal !== null || code !== 0;
    logDevElectron("app exited", {
      pid: app.pid ?? null,
      code,
      signal,
      expected: wasExpected,
      shuttingDown,
    });
    if (!shuttingDown && !wasExpected && exitedAbnormally) {
      scheduleRestart("app-exited-abnormally");
    }
  });
}

async function stopApp() {
  const app = currentApp;
  if (!app) {
    return;
  }

  currentApp = null;
  expectedExits.add(app);

  logDevElectron("stopping app", { pid: app.pid ?? null });

  await new Promise((resolve) => {
    let settled = false;

    const finish = () => {
      if (settled) {
        return;
      }

      settled = true;
      resolve();
    };

    app.once("exit", finish);
    app.kill("SIGTERM");
    killChildTreeByPid(app.pid, "TERM");
    cleanupStaleDevApps("stop-app");

    setTimeout(() => {
      if (settled) {
        return;
      }

      app.kill("SIGKILL");
      killChildTreeByPid(app.pid, "KILL");
      cleanupStaleDevApps("stop-app-timeout");
      finish();
    }, forcedShutdownTimeoutMs).unref();
  });
}

function scheduleRestart(reason) {
  if (shuttingDown) {
    return;
  }

  logDevElectron("restart scheduled", { reason });

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    restartQueue = restartQueue
      .catch(() => undefined)
      .then(async () => {
        await stopApp();
        if (!shuttingDown) {
          startApp();
        }
      });
  }, restartDebounceMs);
}

function startWatchers() {
  for (const { directory, files } of watchedDirectories) {
    const watcher = watch(
      join(desktopDir, directory),
      { persistent: true },
      (eventType, filename) => {
        if (typeof filename !== "string" || !files.has(filename)) {
          return;
        }

        const decision = shouldRestartForWatchedFileChange(directory, filename);
        logDevElectron("watched file changed", {
          eventType,
          directory,
          filename,
          contentChanged: decision.changed,
          ...decision.snapshot,
        });
        if (decision.restart) {
          scheduleRestart("watched-file-content-changed");
        }
      },
    );

    watchers.push(watcher);
  }
}

function killChildTree(signal) {
  if (hostPlatform === "win32") {
    return;
  }

  // Kill direct children as a final fallback in case normal shutdown leaves stragglers.
  spawnSync("pkill", [`-${signal}`, "-P", String(process.pid)], { stdio: "ignore" });
}

async function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }

  for (const watcher of watchers) {
    watcher.close();
  }

  await stopApp();
  killChildTree("TERM");
  await new Promise((resolve) => {
    setTimeout(resolve, childTreeGracePeriodMs);
  });
  killChildTree("KILL");

  process.exit(exitCode);
}

initializeWatchedFileFingerprints();
startWatchers();
startApp();

process.once("SIGINT", () => {
  void shutdown(130);
});
process.once("SIGTERM", () => {
  void shutdown(143);
});
process.once("SIGHUP", () => {
  void shutdown(129);
});
