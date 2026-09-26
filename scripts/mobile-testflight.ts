#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalConsole:off - Host-side Xcode build automation drives subprocesses and logs progress directly, like mobile-showcase.ts.
/**
 * mobile-testflight.ts — build the production iOS app and upload it to App Store Connect.
 *
 * Runs the same way in CI and on a maintainer's Mac. With the App Store Connect API key trio
 * (APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER) xcodebuild signs and uploads with the key;
 * without it, xcodebuild uses the Apple account signed in to Xcode.
 *
 * Usage: node scripts/mobile-testflight.ts [--no-upload]
 */

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { loadRepoEnv } from "./lib/public-config.ts";

const MOBILE_ROOT = NodeURL.fileURLToPath(new URL("../apps/mobile", import.meta.url));
const IOS_ROOT = NodePath.join(MOBILE_ROOT, "ios");
const APPLE_TEAM_ID = "ZBZKKWF95G";
const SCHEME = "KataCode";

export type AppStoreConnectAuth =
  | {
      readonly kind: "api-key";
      readonly key: string;
      readonly keyId: string;
      readonly issuerId: string;
    }
  | { readonly kind: "xcode-account" };

const API_KEY_VARIABLES = ["APPLE_API_KEY", "APPLE_API_KEY_ID", "APPLE_API_ISSUER"] as const;

export function resolveAppStoreConnectAuth(
  env: Readonly<Record<string, string | undefined>>,
): AppStoreConnectAuth {
  const present = API_KEY_VARIABLES.filter((name) => env[name]?.trim());
  if (present.length === 0) return { kind: "xcode-account" };
  if (present.length < API_KEY_VARIABLES.length) {
    const missing = API_KEY_VARIABLES.filter((name) => !present.includes(name));
    throw new Error(`App Store Connect API key is incomplete; missing ${missing.join(", ")}.`);
  }
  return {
    kind: "api-key",
    key: normalizePrivateKey(env.APPLE_API_KEY!),
    keyId: env.APPLE_API_KEY_ID!.trim(),
    issuerId: env.APPLE_API_ISSUER!.trim(),
  };
}

/**
 * Rebuilds PEM line structure. 1Password Environments store the `.p8` as one line, and xcodebuild
 * rejects a key whose base64 body isn't on its own lines.
 */
export function normalizePrivateKey(value: string): string {
  const match = /-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/.exec(value);
  if (!match) throw new Error("APPLE_API_KEY is not a PEM private key (.p8 contents).");
  const body = match[1]!.replace(/\s+/g, "");
  const lines = body.match(/.{1,64}/g) ?? [];
  return ["-----BEGIN PRIVATE KEY-----", ...lines, "-----END PRIVATE KEY-----"].join("\n");
}

const CONNECT_VARIABLES = [
  "KATACODE_CLERK_PUBLISHABLE_KEY",
  "KATACODE_CLERK_JWT_TEMPLATE",
  "KATACODE_RELAY_URL",
] as const;

/** Kata Code Connect settings an uploaded build must embed; a build without them can't sign in. */
export function missingConnectConfig(env: Readonly<Record<string, string | undefined>>): string[] {
  return CONNECT_VARIABLES.filter((name) => !env[name]?.trim());
}

/** UTC minutes as YYYYMMDDHHmm, so CI and local uploads always increase and never collide. */
export function iosBuildNumber(now: Date): string {
  return now.toISOString().slice(0, 16).replace(/\D/g, "");
}

function exportOptionsPlist(destination: "upload" | "export"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>${destination}</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
`;
}

function run(
  command: string,
  args: ReadonlyArray<string>,
  options: NodeChildProcess.SpawnSyncOptions,
) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = NodeChildProcess.spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args[0] ?? ""} exited with ${String(result.status ?? result.signal)}.`,
    );
  }
}

function readPlistValue(plistPath: string, keyPath: string): string {
  return NodeChildProcess.execFileSync(
    "plutil",
    ["-extract", keyPath, "raw", "-o", "-", plistPath],
    {
      encoding: "utf8",
    },
  ).trim();
}

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== "--no-upload");
  if (unknown.length > 0) {
    throw new Error(
      `Unknown argument: ${unknown.join(" ")}. Usage: mobile-testflight.ts [--no-upload]`,
    );
  }
  const upload = !args.includes("--no-upload");
  const repoEnv = loadRepoEnv();
  const auth = resolveAppStoreConnectAuth(repoEnv);
  const missing = missingConnectConfig(repoEnv);
  if (upload && missing.length > 0) {
    throw new Error(
      `Refusing to upload a build without Kata Code Connect config; missing ${missing.join(", ")}. Set OP_SERVICE_ACCOUNT_TOKEN or the variables, or pass --no-upload.`,
    );
  }
  const buildNumber = iosBuildNumber(new Date());
  const workDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "katacode-testflight-"));
  const archivePath = NodePath.join(workDir, `${SCHEME}.xcarchive`);
  const exportPath = NodePath.join(workDir, "export");
  const exportOptionsPath = NodePath.join(workDir, "ExportOptions.plist");
  NodeFS.writeFileSync(exportOptionsPath, exportOptionsPlist(upload ? "upload" : "export"));

  const authArgs: string[] = [];
  if (auth.kind === "api-key") {
    const keyPath = NodePath.join(workDir, `AuthKey_${auth.keyId}.p8`);
    NodeFS.writeFileSync(keyPath, `${auth.key}\n`, { mode: 0o600 });
    // Runs after success and after a thrown build failure; the archive and export stay behind.
    process.on("exit", () => NodeFS.rmSync(keyPath, { force: true }));
    authArgs.push(
      "-authenticationKeyPath",
      keyPath,
      "-authenticationKeyID",
      auth.keyId,
      "-authenticationKeyIssuerID",
      auth.issuerId,
    );
  }

  // Store builds carry no OTA channel: Kata has no EAS Update project, and the
  // configured updates URL belongs to upstream.
  const env = {
    ...repoEnv,
    APP_VARIANT: "production",
    KATACODE_MOBILE_UPDATES_ENABLED: "0",
    KATACODE_IOS_BUILD_NUMBER: buildNumber,
    EXPO_NO_GIT_STATUS: "1",
  };

  console.log(`Building ${SCHEME} build ${buildNumber} (${auth.kind} auth) in ${workDir}`);
  run("vp", ["exec", "expo", "prebuild", "--clean", "--platform", "ios", "--no-install"], {
    cwd: MOBILE_ROOT,
    env,
  });
  run("pod", ["install"], { cwd: IOS_ROOT, env });
  run(
    "xcodebuild",
    [
      "-workspace",
      NodePath.join(IOS_ROOT, `${SCHEME}.xcworkspace`),
      "-scheme",
      SCHEME,
      "-configuration",
      "Release",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      archivePath,
      "-allowProvisioningUpdates",
      ...authArgs,
      `DEVELOPMENT_TEAM=${APPLE_TEAM_ID}`,
      "archive",
    ],
    { cwd: IOS_ROOT, env },
  );

  const archiveInfo = NodePath.join(archivePath, "Info.plist");
  const version = readPlistValue(archiveInfo, "ApplicationProperties.CFBundleShortVersionString");
  const archivedBuild = readPlistValue(archiveInfo, "ApplicationProperties.CFBundleVersion");
  if (archivedBuild !== buildNumber) {
    throw new Error(`Archive has build ${archivedBuild}, expected ${buildNumber}.`);
  }

  run(
    "xcodebuild",
    [
      "-exportArchive",
      "-archivePath",
      archivePath,
      "-exportPath",
      exportPath,
      "-exportOptionsPlist",
      exportOptionsPath,
      "-allowProvisioningUpdates",
      ...authArgs,
    ],
    { cwd: IOS_ROOT, env },
  );

  const outcome = upload
    ? `Uploaded Kata Code ${version} (${buildNumber}) to App Store Connect.`
    : `Exported Kata Code ${version} (${buildNumber}) to ${exportPath}; not uploaded.`;
  console.log(outcome);
  if (process.env.GITHUB_STEP_SUMMARY) {
    NodeFS.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## Kata Code TestFlight",
        "",
        `- Version: \`${version}\``,
        `- Build: \`${buildNumber}\``,
        `- Commit: \`${process.env.GITHUB_SHA ?? "local"}\``,
        `- Result: ${upload ? "uploaded; App Store Connect processing takes a few minutes before TestFlight lists it" : "exported, not uploaded"}`,
        "",
      ].join("\n"),
    );
  }
}

if (import.meta.main) {
  main();
}
