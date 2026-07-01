import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { claimAvailablePortOffset, resolveStartOffsetFromEnv } from "./ports.ts";
import { resolveArtifactRoot } from "./artifacts.ts";

/* oxlint-disable kata-code/no-global-process-runtime -- E2E harness runs outside Effect runtime; platform gate for keychain provisioning. */

export type LaunchTarget = "dev" | "release";

export interface E2ERunContext {
  readonly runId: string;
  readonly projectName: string;
  readonly launchTarget: LaunchTarget;
  readonly repoRoot: string;
  readonly katacodeHome: string;
  readonly workspaceRoot: string;
  readonly artifactRoot: string;
  readonly electronRuntimeDir: string;
  readonly serverPort: number;
  readonly webPort: number;
  /** Releases the placeholder sockets holding this run's ports. Called once,
   * right before the dev stack binds the ports, to close the TOCTOU window
   * between port selection and Vite listen. */
  readonly releasePortClaim: () => Promise<void>;
  readonly devEnv: NodeJS.ProcessEnv;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const cleanupCallbacksByRunId = new Map<string, Array<() => Promise<void> | void>>();

function createRunId(): string {
  return `e2e-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

const execFileAsync = promisify(execFile);

/**
 * Provision a login keychain inside an isolated E2E HOME so macOS Electron
 * `safeStorage` can encrypt/decrypt secrets without popping the native
 * "Keychain Not Found" dialog. Creates `Library/Keychains/login.keychain-db`,
 * unlocks it, and sets it as the default keychain for processes inheriting
 * `HOME=homePath`. The default-keychain preference is per-HOME, so the real
 * user's keychain default is not affected.
 */
async function provisionIsolatedKeychain(homePath: string): Promise<void> {
  const keychainsDir = join(homePath, "Library", "Keychains");
  await mkdir(keychainsDir, { recursive: true });
  const keychainPath = join(keychainsDir, "login.keychain-db");
  // Use a fixed password; the keychain is destroyed with the temp home on
  // cleanup and holds only ephemeral E2E secrets.
  const password = "katacode-e2e";
  const runSecurity = (args: ReadonlyArray<string>) =>
    execFileAsync("security", [...args], {
      env: { ...process.env, HOME: homePath },
    });

  await runSecurity(["create-keychain", "-p", password, keychainPath]);
  // Suppress the GUI password prompt by unlocking the keychain and disabling
  // auto-lock timeouts for the lifetime of the run.
  await runSecurity(["unlock-keychain", "-p", password, keychainPath]);
  await runSecurity(["set-keychain-settings", "-lut", "7200", keychainPath]);
  await runSecurity(["default-keychain", "-s", keychainPath]);
}

export async function createIsolatedRun(input: {
  readonly projectName: string;
  readonly launchTarget: LaunchTarget;
}): Promise<E2ERunContext> {
  const runId = createRunId();
  const { offset: startOffset } = resolveStartOffsetFromEnv();
  // Claim ports by holding listening sockets so concurrent workers can't both
  // pick the same free port (TOCTOU). The claim is released right before the
  // dev stack binds the ports in startDevStack.
  const {
    offset,
    serverPort,
    webPort,
    release: releasePortClaim,
  } = await claimAvailablePortOffset(startOffset);
  const katacodeHome = await mkdtemp(join(tmpdir(), `katacode-e2e-home-${runId}-`));
  const workspaceRoot = await mkdtemp(join(tmpdir(), `katacode-e2e-workspace-${runId}-`));
  // Per-worker Electron launcher cache so parallel workers don't clobber a
  // shared apps/desktop/.electron-runtime (concurrent bundle copy + launcher
  // script writes race and corrupt the cached dev .app).
  const electronRuntimeDir = await mkdtemp(
    join(tmpdir(), `katacode-e2e-electron-runtime-${runId}-`),
  );
  const artifactRoot = join(resolveArtifactRoot(), runId);
  const cleanupCallbacks: Array<() => Promise<void> | void> = [];

  // On macOS, Electron safeStorage backs onto the Keychain. The isolated
  // HOME has no login keychain, so the first encrypted-secret write pops a
  // native "Keychain Not Found" dialog that blocks the test. Provision a
  // login keychain inside the temp home and make it the default for any
  // process that inherits HOME=katacodeHome. The default-keychain setting
  // lives in the per-user Security preferences under HOME, so the real
  // user's keychain default is untouched. Skip on non-darwin.
  if (platform() === "darwin") {
    await provisionIsolatedKeychain(katacodeHome);
  }

  // Forward the E2E Cursor API key to the Cursor Agent CLI's expected env
  // name. The isolated HOME has no macOS login keychain, so interactive
  // `agent login` token storage is unavailable; the API-key auth path skips
  // the keychain entirely and works on all platforms including CI.
  const cursorApiKey = process.env.KATACODE_E2E_CURSOR_API_KEY?.trim();

  const baseEnv = {
    ...process.env,
    KATACODE_HOME: katacodeHome,
    HOME: katacodeHome,
    USERPROFILE: katacodeHome,
    ...(cursorApiKey ? { CURSOR_API_KEY: cursorApiKey } : {}),
    KATACODE_PORT_OFFSET: String(offset),
    KATACODE_ELECTRON_RUNTIME_DIR: electronRuntimeDir,
    // Unique per-worker dev app bundle ID so macOS Launch Services treats each
    // parallel worker's Electron as a distinct app (same bundle ID = single
    // instance = second launch exits before opening a window).
    KATACODE_DEV_BUNDLE_ID_SUFFIX: runId.replaceAll(/[^a-z0-9]+/gi, ""),
    // Each worker is an independent isolated instance; the desktop app's
    // single-instance lock would otherwise quit every worker past the first.
    KATACODE_DESKTOP_DISABLE_SINGLE_INSTANCE_LOCK: "1",
    HOST: "127.0.0.1",
    KATACODE_NO_BROWSER: "1",
    KATACODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "0",
  } satisfies NodeJS.ProcessEnv;

  // Make the port-claim release idempotent so it's safe to call both from the
  // dev stack (before bind) and from cleanup (on failure). If the dev stack
  // already released the claim, the cleanup call is a no-op.
  let portClaimReleased = false;
  const releasePortClaimIdempotent = async () => {
    if (portClaimReleased) return;
    portClaimReleased = true;
    await releasePortClaim();
  };

  cleanupCallbacks.push(async () => {
    await releasePortClaimIdempotent();
    await rm(katacodeHome, { recursive: true, force: true });
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(electronRuntimeDir, { recursive: true, force: true });
  });
  cleanupCallbacksByRunId.set(runId, cleanupCallbacks);

  return {
    runId,
    projectName: input.projectName,
    launchTarget: input.launchTarget,
    repoRoot,
    katacodeHome,
    workspaceRoot,
    artifactRoot,
    electronRuntimeDir,
    serverPort,
    webPort,
    releasePortClaim: releasePortClaimIdempotent,
    devEnv: baseEnv,
  };
}

export async function cleanupRunState(context: E2ERunContext): Promise<void> {
  const callbacks = cleanupCallbacksByRunId.get(context.runId) ?? [];
  for (const callback of [...callbacks].toReversed()) {
    await callback();
  }
  cleanupCallbacksByRunId.delete(context.runId);
}

export function registerCleanup(
  context: E2ERunContext,
  callback: () => Promise<void> | void,
): void {
  const callbacks = cleanupCallbacksByRunId.get(context.runId);
  if (!callbacks) {
    throw new Error(`E2E run ${context.runId} is not registered for cleanup.`);
  }
  callbacks.push(callback);
}
