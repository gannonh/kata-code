import { resolveAppBranding } from "../../../packages/shared/src/branding.ts";

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import * as NodeOS from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const __dirname = dirname(fileURLToPath(import.meta.url));
export const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "..", "..");
const devBundleIdSuffix = basename(repoRoot)
  .toLowerCase()
  .replaceAll(/[^a-z0-9]+/g, "");
const devBranding = resolveAppBranding({
  isDevelopment,
  appVersion: process.env.npm_package_version ?? "0.0.0-dev",
});
export const APP_DISPLAY_NAME = devBranding.displayName;
export const APP_BUNDLE_ID = isDevelopment
  ? `com.katacode.dev.${devBundleIdSuffix || "local"}`
  : "com.katacode.app";
const APP_PROTOCOL_SCHEMES = isDevelopment ? ["katacode-dev"] : ["katacode"];
const LAUNCHER_VERSION = 13;
const defaultIconPath = join(desktopDir, "resources", "icon.icns");
const developmentMacIconPngPath = join(desktopDir, "resources", "source.png");
// oxlint-disable-next-line kata-code/no-global-process-runtime -- Standalone launcher script has no Effect runtime.
const hostPlatform = NodeOS.platform();

export function resolveDevelopmentProtocolCallbackUrl() {
  const configuredPort = Number.parseInt(process.env.KATACODE_PORT ?? "", 10);
  const port =
    Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort < 65535
      ? configuredPort + 1
      : 13774;
  return `http://127.0.0.1:${port}/auth/callback`;
}

function setPlistValue(plistPath, key, type, serialized) {
  const replaceResult = spawnSync("plutil", ["-replace", key, `-${type}`, serialized, plistPath], {
    encoding: "utf8",
  });
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = spawnSync("plutil", ["-insert", key, `-${type}`, serialized, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function setPlistString(plistPath, key, value) {
  setPlistValue(plistPath, key, "string", value);
}

function setPlistJson(plistPath, key, value) {
  setPlistValue(plistPath, key, "json", JSON.stringify(value));
}

function setPlistBool(plistPath, key, value) {
  setPlistValue(plistPath, key, "bool", value ? "YES" : "NO");
}

function runChecked(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export const AUTH_CALLBACK_RETRY_DELAYS_MS = [0, 200, 500, 1000];

export function createDevelopmentLauncherScript({ envEntries, electronBinaryPath, shimEntryPath }) {
  const shellRetryDelays = AUTH_CALLBACK_RETRY_DELAYS_MS.map((ms) =>
    ms === 0 ? "0" : String(ms / 1000),
  ).join(" ");
  return [
    "#!/bin/sh",
    ...envEntries.map(([name, value]) => `export ${name}=${shellSingleQuote(value)}`),
    "forward_auth_callback() {",
    '  if [ -z "$KATACODE_DESKTOP_PROTOCOL_CALLBACK_URL" ]; then',
    '    echo "Kata Code dev auth callback URL is not configured." >&2',
    "    return 1",
    "  fi",
    "",
    "  for delay in " + shellRetryDelays + "; do",
    '    if [ "$delay" != "0" ]; then',
    '      /bin/sleep "$delay"',
    "    fi",
    '    /usr/bin/curl -fsS --connect-timeout 1 --max-time 2 -X POST --data-binary "$1" "$KATACODE_DESKTOP_PROTOCOL_CALLBACK_URL" >/dev/null 2>&1 && return 0',
    "  done",
    "",
    '  echo "Kata Code dev auth callback forward failed: $KATACODE_DESKTOP_PROTOCOL_CALLBACK_URL" >&2',
    "  return 1",
    "}",
    "",
    'for arg in "$@"; do',
    '  case "$arg" in',
    "    katacode-dev://auth/callback*)",
    '      forward_auth_callback "$arg"',
    "      exit $?",
    "      ;;",
    "  esac",
    "done",
    `exec ${shellSingleQuote(electronBinaryPath)} --katacode-dev-root=${shellSingleQuote(desktopDir)} ${shellSingleQuote(shimEntryPath)} "$@"`,
    "",
  ].join("\n");
}

export function createDevelopmentLauncherShim() {
  const retryDelaysLiteral = JSON.stringify(AUTH_CALLBACK_RETRY_DELAYS_MS);
  return [
    'const { app } = require("electron");',
    'const http = require("node:http");',
    'const { URL } = require("node:url");',
    "",
    "const callbackForwardUrl = process.env.KATACODE_DESKTOP_PROTOCOL_CALLBACK_URL;",
    "let callbackHandled = false;",
    "",
    "function isAuthCallback(rawUrl) {",
    '  return typeof rawUrl === "string" && rawUrl.startsWith("katacode-dev://auth/callback");',
    "}",
    "",
    "function delay(milliseconds) {",
    "  return new Promise((resolve) => setTimeout(resolve, milliseconds));",
    "}",
    "",
    "function postCallback(rawUrl) {",
    "  return new Promise((resolve, reject) => {",
    "    if (!callbackForwardUrl) {",
    '      reject(new Error("Kata Code dev auth callback URL is not configured."));',
    "      return;",
    "    }",
    "",
    "    let target;",
    "    try {",
    "      target = new URL(callbackForwardUrl);",
    "    } catch (error) {",
    "      reject(error);",
    "      return;",
    "    }",
    "",
    '    if (target.protocol !== "http:") {',
    "      reject(new Error(`Unsupported Kata Code dev auth callback URL: ${target.protocol}`));",
    "      return;",
    "    }",
    "",
    "    const request = http.request(",
    "      {",
    "        hostname: target.hostname,",
    '        method: "POST",',
    "        path: `${target.pathname}${target.search}`,",
    "        port: target.port,",
    "        timeout: 2_000,",
    "      },",
    "      (response) => {",
    "        response.resume();",
    '        response.on("end", () => {',
    "          const ok = response.statusCode >= 200 && response.statusCode < 300;",
    "          if (ok) {",
    "            resolve();",
    "            return;",
    "          }",
    "          reject(new Error(`Kata Code dev auth callback returned HTTP ${response.statusCode}`));",
    "        });",
    "      },",
    "    );",
    "",
    '    request.on("timeout", () => {',
    '      request.destroy(new Error("Kata Code dev auth callback timed out."));',
    "    });",
    '    request.on("error", reject);',
    "    request.end(rawUrl);",
    "  });",
    "}",
    "",
    "async function forwardAuthCallback(rawUrl) {",
    "  callbackHandled = true;",
    "  let lastError;",
    "",
    "  for (const waitMs of " + retryDelaysLiteral + ") {",
    "    if (waitMs > 0) {",
    "      await delay(waitMs);",
    "    }",
    "",
    "    try {",
    "      await postCallback(rawUrl);",
    "      app.exit(0);",
    "      return;",
    "    } catch (error) {",
    "      lastError = error;",
    "    }",
    "  }",
    "",
    '  console.error("Kata Code dev auth callback forward failed.", lastError);',
    "  app.exit(1);",
    "}",
    "",
    'app.on("open-url", (event, rawUrl) => {',
    "  if (!isAuthCallback(rawUrl)) {",
    "    return;",
    "  }",
    "  event.preventDefault();",
    "  void forwardAuthCallback(rawUrl);",
    "});",
    "",
    "const callbackArg = process.argv.find(isAuthCallback);",
    "if (callbackArg) {",
    "  void forwardAuthCallback(callbackArg);",
    "} else {",
    "  setTimeout(() => {",
    "    if (!callbackHandled) {",
    "      app.exit(0);",
    "    }",
    "  }, 2000);",
    "}",
    "",
  ].join("\n");
}

function writeDevelopmentLauncherScript(targetBinaryPath, electronBinaryPath) {
  const shimEntryPath = join(dirname(targetBinaryPath), "katacode-dev-callback.cjs");
  const protocolCallbackUrl = resolveDevelopmentProtocolCallbackUrl();
  const envEntries = [
    ["VITE_DEV_SERVER_URL", process.env.VITE_DEV_SERVER_URL],
    ["KATACODE_PORT", process.env.KATACODE_PORT],
    ["KATACODE_HOME", process.env.KATACODE_HOME],
    ["KATACODE_COMMIT_HASH", process.env.KATACODE_COMMIT_HASH],
    ["KATACODE_OTLP_TRACES_URL", process.env.KATACODE_OTLP_TRACES_URL],
    ["KATACODE_OTLP_EXPORT_INTERVAL_MS", process.env.KATACODE_OTLP_EXPORT_INTERVAL_MS],
    ["KATACODE_DESKTOP_APP_USER_MODEL_ID", APP_BUNDLE_ID],
    ["KATACODE_DESKTOP_PROTOCOL_REGISTRATION_MANAGED", "1"],
    ["KATACODE_DESKTOP_PROTOCOL_CALLBACK_URL", protocolCallbackUrl],
  ].filter((entry) => typeof entry[1] === "string" && entry[1].trim().length > 0);
  writeFileSync(shimEntryPath, createDevelopmentLauncherShim());
  writeFileSync(
    targetBinaryPath,
    createDevelopmentLauncherScript({ envEntries, electronBinaryPath, shimEntryPath }),
  );
  chmodSync(targetBinaryPath, 0o755);
}

function registerMacLauncherBundle(appBundlePath) {
  runChecked(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", appBundlePath],
  );

  if (!isDevelopment) {
    return;
  }

  for (const scheme of APP_PROTOCOL_SCHEMES) {
    runChecked("osascript", [
      "-l",
      "JavaScript",
      "-e",
      [
        'ObjC.import("CoreServices");',
        `const scheme = $.NSString.alloc.initWithUTF8String(${JSON.stringify(scheme)});`,
        `const bundle = $.NSString.alloc.initWithUTF8String(${JSON.stringify(APP_BUNDLE_ID)});`,
        "const status = $.LSSetDefaultHandlerForURLScheme(scheme, bundle);",
        "if (status !== 0) throw new Error(`LSSetDefaultHandlerForURLScheme failed: ${status}`);",
      ].join(" "),
    ]);
  }
}

function ensureDevelopmentIconIcns(runtimeDir) {
  const generatedIconPath = join(runtimeDir, "icon-dev.icns");
  mkdirSync(runtimeDir, { recursive: true });

  if (!existsSync(developmentMacIconPngPath)) {
    return defaultIconPath;
  }

  const sourceMtimeMs = statSync(developmentMacIconPngPath).mtimeMs;
  if (existsSync(generatedIconPath) && statSync(generatedIconPath).mtimeMs >= sourceMtimeMs) {
    return generatedIconPath;
  }

  const iconsetRoot = mkdtempSync(join(runtimeDir, "dev-iconset-"));
  const iconsetDir = join(iconsetRoot, "icon.iconset");
  mkdirSync(iconsetDir, { recursive: true });

  try {
    for (const size of [16, 32, 128, 256, 512]) {
      runChecked("sips", [
        "-z",
        String(size),
        String(size),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}.png`),
      ]);

      const retinaSize = size * 2;
      runChecked("sips", [
        "-z",
        String(retinaSize),
        String(retinaSize),
        developmentMacIconPngPath,
        "--out",
        join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
    }

    runChecked("iconutil", ["-c", "icns", iconsetDir, "-o", generatedIconPath]);
    return generatedIconPath;
  } catch (error) {
    console.warn(
      "[desktop-launcher] Failed to generate dev macOS icon, falling back to default icon.",
      error,
    );
    return defaultIconPath;
  } finally {
    rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

function patchMainBundleInfoPlist(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");
  setPlistJson(infoPlistPath, "CFBundleURLTypes", [
    {
      CFBundleURLName: APP_BUNDLE_ID,
      CFBundleURLSchemes: APP_PROTOCOL_SCHEMES,
    },
  ]);
  if (isDevelopment) {
    setPlistBool(infoPlistPath, "LSUIElement", true);
  }

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function patchHelperBundleInfoPlists(appBundlePath) {
  const helperBundleNames = [
    ["Electron Helper.app", "helper", `${APP_DISPLAY_NAME} Helper`],
    ["Electron Helper (GPU).app", "helper.gpu", `${APP_DISPLAY_NAME} Helper (GPU)`],
    ["Electron Helper (Plugin).app", "helper.plugin", `${APP_DISPLAY_NAME} Helper (Plugin)`],
    ["Electron Helper (Renderer).app", "helper.renderer", `${APP_DISPLAY_NAME} Helper (Renderer)`],
  ];

  for (const [bundleName, bundleIdentifierSuffix, bundleDisplayName] of helperBundleNames) {
    const infoPlistPath = join(
      appBundlePath,
      "Contents",
      "Frameworks",
      bundleName,
      "Contents",
      "Info.plist",
    );
    if (!existsSync(infoPlistPath)) {
      continue;
    }

    setPlistString(infoPlistPath, "CFBundleDisplayName", bundleDisplayName);
    setPlistString(infoPlistPath, "CFBundleName", bundleDisplayName);
    setPlistString(
      infoPlistPath,
      "CFBundleIdentifier",
      `${APP_BUNDLE_ID}.${bundleIdentifierSuffix}`,
    );
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(dirname(electronBinaryPath), "../..");
  const runtimeDir = join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const iconPath = isDevelopment ? ensureDevelopmentIconIcns(runtimeDir) : defaultIconPath;
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
    appBundleId: APP_BUNDLE_ID,
    appProtocolSchemes: APP_PROTOCOL_SCHEMES,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    // Dev ports are chosen at runtime by dev-runner; refresh the launcher script
    // so a cached .app bundle does not keep a stale VITE_DEV_SERVER_URL.
    if (isDevelopment) {
      writeDevelopmentLauncherScript(targetBinaryPath, electronBinaryPath);
    }
    registerMacLauncherBundle(targetAppBundlePath);
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  // verbatimSymlinks keeps the framework's relative symlinks intact
  // (e.g. Resources -> Versions/Current/Resources). Without it cpSync
  // rewrites them to absolute paths into node_modules, which escape the
  // bundle and crash sandboxed helper processes (icudtl.dat not found).
  cpSync(sourceAppBundlePath, targetAppBundlePath, { recursive: true, verbatimSymlinks: true });
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath);
  patchHelperBundleInfoPlists(targetAppBundlePath);
  if (isDevelopment) {
    writeDevelopmentLauncherScript(targetBinaryPath, electronBinaryPath);
  }
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);
  registerMacLauncherBundle(targetAppBundlePath);

  return targetBinaryPath;
}

function isLinuxSetuidSandboxConfigured(electronBinaryPath) {
  if (hostPlatform !== "linux") {
    return true;
  }

  const sandboxPath = join(dirname(electronBinaryPath), "chrome-sandbox");
  try {
    const sandboxStat = statSync(sandboxPath);
    return sandboxStat.uid === 0 && (sandboxStat.mode & 0o4777) === 0o4755;
  } catch {
    return false;
  }
}

function resolveLinuxSandboxArgs(electronBinaryPath) {
  if (isLinuxSetuidSandboxConfigured(electronBinaryPath)) {
    return [];
  }

  console.warn(
    "[desktop-launcher] Electron chrome-sandbox is not root-owned with mode 4755; launching local Electron with --no-sandbox.",
  );
  return ["--no-sandbox"];
}

export function resolveElectronBinaryPath() {
  ensureElectronRuntime();

  const require = createRequire(import.meta.url);
  return require("electron");
}

export function resolveElectronPath() {
  const electronBinaryPath = resolveElectronBinaryPath();

  if (hostPlatform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}

function resolveElectronLaunchCommandFrom(resolvePath, args = []) {
  const electronPath = resolvePath();
  return {
    electronPath,
    args: [...resolveLinuxSandboxArgs(electronPath), ...args],
  };
}

export function resolveElectronLaunchCommand(args = []) {
  return resolveElectronLaunchCommandFrom(resolveElectronPath, args);
}

export function resolveRawElectronLaunchCommand(args = []) {
  return resolveElectronLaunchCommandFrom(resolveElectronBinaryPath, args);
}

export function resolveDevProtocolClient() {
  if (hostPlatform !== "darwin" || !isDevelopment) {
    return null;
  }

  const launcherBinaryPath = buildMacLauncher(resolveElectronBinaryPath());
  return {
    appBundlePath: resolve(launcherBinaryPath, "..", "..", ".."),
    appBundleId: APP_BUNDLE_ID,
  };
}
