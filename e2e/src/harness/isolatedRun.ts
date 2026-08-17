import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir, platform, userInfo } from "node:os";
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
let nextPortOffset: number | undefined;

export function resolvePortScanStart(
  configuredStartOffset: number,
  nextUnusedOffset: number | undefined,
  workerIndex = 0,
): number {
  // Per-worker stride keeps parallel Playwright workers from contending on the
  // same offset band. Monotonic nextUnusedOffset avoids immediate reuse after a
  // prior run in the same worker once tree-kill + HTTP readiness have cleared
  // the previous stack.
  const workerStartOffset = configuredStartOffset + Math.max(0, workerIndex) * 20;
  return Math.max(workerStartOffset, nextUnusedOffset ?? workerStartOffset);
}

/** Create a unique run id for an isolated E2E worker. */
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

/**
 * Resolve the host `gh` auth token so the isolated harness can forward it as
 * `GH_TOKEN`. The harness overrides `HOME`, so the in-app GitHub source picker
 * (which shells out to `gh`) cannot read the real `~/.config/gh` auth. `gh`
 * honors `GH_TOKEN`/`GITHUB_TOKEN` regardless of `HOME`, so forwarding the
 * host token restores authenticated repository/branch discovery for the
 * credentialed Vercel source flow. Returns `undefined` when `gh` is missing or
 * unauthenticated (non-credentialed runs are unaffected).
 */
async function resolveHostGitHubToken(): Promise<string | undefined> {
  const preset = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  if (preset) return preset;
  try {
    const { stdout } = await execFileAsync("gh", ["auth", "token"], { env: process.env });
    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

type CodexE2eAuthMode = "oauth" | "oauth-or-api-key" | "api-key";

function readCodexE2eAuthMode(): CodexE2eAuthMode {
  const value = process.env.KATACODE_E2E_CODEX_AUTH_MODE?.trim().toLowerCase();
  if (value === "oauth" || value === "oauth-or-api-key" || value === "api-key") {
    return value;
  }
  return "api-key";
}

async function stageCodexOAuthAuth(katacodeHome: string): Promise<boolean> {
  const mode = readCodexE2eAuthMode();
  if (mode === "api-key") return false;

  const sourceAuthPath = join(
    process.env.KATACODE_E2E_CODEX_AUTH_SOURCE?.trim() || join(homedir(), ".codex"),
    "auth.json",
  );
  const destinationHome = join(katacodeHome, ".codex");
  const destinationAuthPath = join(destinationHome, "auth.json");

  try {
    await mkdir(destinationHome, { recursive: true });
    await copyFile(sourceAuthPath, destinationAuthPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && mode === "oauth-or-api-key") {
      return false;
    }
    throw new Error(
      `Codex OAuth auth is required for KATACODE_E2E_CODEX_AUTH_MODE=${mode}, but ${sourceAuthPath} could not be staged.`,
      { cause: error },
    );
  }
}

type ClaudeE2eAuthMode = "oauth" | "oauth-or-api-key" | "api-key";

function readClaudeE2eAuthMode(): ClaudeE2eAuthMode {
  const value = process.env.KATACODE_E2E_CLAUDE_AUTH_MODE?.trim().toLowerCase();
  if (value === "oauth" || value === "oauth-or-api-key" || value === "api-key") {
    return value;
  }
  // OAuth-first is the local policy: an unset knob must not silently bill the
  // ambient ANTHROPIC_API_KEY when the host has a Claude subscription staged.
  return "oauth-or-api-key";
}

/**
 * Claude OAuth state lives in the host `~/.claude.json` (`oauthAccount`),
 * resolved by the Claude agent SDK under its HOME. Stage it into the isolated
 * HOME exactly like Codex's auth.json so E2E runs can reuse the host OAuth
 * session without re-authenticating interactively.
 */
async function stageClaudeOAuth(katacodeHome: string): Promise<boolean> {
  const mode = readClaudeE2eAuthMode();
  if (mode === "api-key") return false;

  const sourceAuthPath = join(homedir(), ".claude.json");
  const destinationAuthPath = join(katacodeHome, ".claude.json");

  try {
    await copyFile(sourceAuthPath, destinationAuthPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && mode === "oauth-or-api-key") {
      return false;
    }
    throw new Error(
      `Claude OAuth auth is required for KATACODE_E2E_CLAUDE_AUTH_MODE=${mode}, but ${sourceAuthPath} could not be staged.`,
      { cause: error },
    );
  }
}

/**
 * Claude Code stores its OAuth credentials in the macOS login keychain under
 * the "Claude Code-credentials" generic password; `~/.claude.json` only
 * mirrors the account profile (no token). The isolated E2E keychain starts
 * empty, so the host credential item is read (the item ACL permits the
 * harness's `security` calls without prompting on the maintainer machine) and
 * re-added to the isolated keychain, exactly like Codex's auth.json staging.
 */
async function stageClaudeKeychainCredentials(katacodeHome: string): Promise<boolean> {
  const mode = readClaudeE2eAuthMode();
  if (mode === "api-key" || process.platform !== "darwin") return false;

  try {
    const { stdout } = await execFileAsync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { env: process.env },
    );
    const secret = stdout.trim();
    if (secret.length === 0) throw new Error("The host Claude credential item is empty.");
    const keychainPath = join(katacodeHome, "Library", "Keychains", "login.keychain-db");
    await execFileAsync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-a",
        userInfo().username,
        "-s",
        "Claude Code-credentials",
        "-w",
        secret,
        keychainPath,
      ],
      { env: { ...process.env, HOME: katacodeHome } },
    );
    return true;
  } catch (error) {
    if (mode === "oauth-or-api-key") {
      // Surface the reason in the harness log; the run continues on the
      // ambient-key fallback but the operator must see why OAuth was skipped.
      console.error(
        `[e2e] Claude keychain OAuth staging failed; falling back: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
    throw new Error(
      `Claude OAuth auth is required for KATACODE_E2E_CLAUDE_AUTH_MODE=${mode}, but the host "Claude Code-credentials" keychain item could not be staged.`,
      { cause: error },
    );
  }
}

/** Provision an isolated E2E home, ports, and dev env for one Playwright worker. */
export async function createIsolatedRun(input: {
  readonly projectName: string;
  readonly launchTarget: LaunchTarget;
}): Promise<E2ERunContext> {
  const runId = createRunId();
  const { offset: configuredStartOffset } = resolveStartOffsetFromEnv();
  // Prefer a fresh offset band after each prior run in this worker so a slow
  // OS port release cannot collide with the next stack boot.
  const workerIndex = Number.parseInt(process.env.TEST_WORKER_INDEX ?? "0", 10);
  const startOffset = resolvePortScanStart(
    configuredStartOffset,
    nextPortOffset,
    Number.isInteger(workerIndex) ? workerIndex : 0,
  );
  // Claim ports by holding listening sockets so concurrent workers can't both
  // pick the same free port (TOCTOU). The claim is released right before the
  // dev stack binds the ports in startDevStack.
  const {
    offset,
    serverPort,
    webPort,
    release: releasePortClaim,
  } = await claimAvailablePortOffset(startOffset);
  nextPortOffset = offset + 1;
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
    // Provider-agent failures are only diagnosable from the isolated HOME's
    // server/provider logs, which normally die with the run.
    if (process.env.KATACODE_E2E_KEEP_HOME === "1") {
      console.error(`[e2e] KATACODE_E2E_KEEP_HOME=1 — retained isolated HOME: ${katacodeHome}`);
      return;
    }
    const removeOptions = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 } as const;
    await rm(katacodeHome, removeOptions);
    await rm(workspaceRoot, removeOptions);
    await rm(electronRuntimeDir, removeOptions);
  });
  cleanupCallbacksByRunId.set(runId, cleanupCallbacks);

  // On macOS, Electron safeStorage backs onto the Keychain. The isolated
  // HOME has no login keychain, so the first encrypted-secret write pops a
  // native "Keychain Not Found" dialog that blocks the test. Provision a
  // login keychain inside the temp home and make it the default for any
  // process that inherits HOME=katacodeHome. The default-keychain setting
  // lives in the per-user Security preferences under HOME, so the real
  // user's keychain default is untouched. Skip on non-darwin.
  if (platform() === "darwin") {
    try {
      await provisionIsolatedKeychain(katacodeHome);
    } catch (error) {
      await Promise.allSettled(cleanupCallbacks.map((callback) => callback()));
      throw error;
    }
  }

  // Codex OAuth lives in the host user's auth file. Stage only that file into
  // the isolated HOME when the repository .env requests OAuth-first auth.
  // Codex itself chooses OAuth before an inherited API key; the API key remains
  // available only for the explicit oauth-or-api-key fallback mode.
  const codexOAuthStaged = await stageCodexOAuthAuth(katacodeHome);

  // Claude OAuth lives in the host ~/.claude.json (oauthAccount). Stage it
  // into the isolated HOME like Codex auth when the repository .env requests
  // OAuth-first Claude auth. The ambient Anthropic keys are only forwarded as
  // the explicit oauth-or-api-key fallback when staging fails.
  await stageClaudeOAuth(katacodeHome);
  const claudeKeychainStaged = await stageClaudeKeychainCredentials(katacodeHome);

  // Forward the E2E Cursor API key to the Cursor Agent CLI's expected env
  // name. The isolated HOME has no macOS login keychain, so interactive
  // `agent login` token storage is unavailable; the API-key auth path skips
  // the keychain entirely and works on all platforms including CI.
  const cursorApiKey = process.env.KATACODE_E2E_CURSOR_API_KEY?.trim();
  // Forward the host `gh` token so the GitHub source picker stays authenticated
  // under the isolated HOME (see resolveHostGitHubToken).
  const githubToken = await resolveHostGitHubToken();
  const {
    ANTHROPIC_API_KEY: _ambientAnthropicApiKey,
    ANTHROPIC_AUTH_TOKEN: _ambientAnthropicAuthToken,
    CURSOR_API_KEY: _ambientCursorApiKey,
    OPENAI_API_KEY: ambientOpenAiApiKey,
    ...envWithoutProviderSecrets
  } = process.env;
  const inheritedEnv = codexOAuthStaged
    ? envWithoutProviderSecrets
    : {
        ...envWithoutProviderSecrets,
        ...(ambientOpenAiApiKey ? { OPENAI_API_KEY: ambientOpenAiApiKey } : {}),
      };
  // Claude OAuth staging does not strip the OpenAI key: Codex fallback auth
  // must keep working for mixed-provider suites in the same isolated run.
  // Claude OAuth staging does not strip the OpenAI key: Codex fallback auth
  // must keep working for mixed-provider suites in the same isolated run.
  // The keychain credential item is the real OAuth material; ambient
  // Anthropic keys are forwarded for explicit api-key mode or as the
  // oauth-or-api-key fallback when the keychain item could not be staged.
  const claudeAuthMode = readClaudeE2eAuthMode();
  const forwardAnthropicKeys =
    claudeAuthMode === "api-key" ||
    (claudeAuthMode === "oauth-or-api-key" && !claudeKeychainStaged);
  const inheritedEnvWithClaudeFallback = forwardAnthropicKeys
    ? {
        ...inheritedEnv,
        ...(_ambientAnthropicApiKey ? { ANTHROPIC_API_KEY: _ambientAnthropicApiKey } : {}),
        ...(_ambientAnthropicAuthToken ? { ANTHROPIC_AUTH_TOKEN: _ambientAnthropicAuthToken } : {}),
      }
    : inheritedEnv;

  const baseEnv = {
    ...inheritedEnvWithClaudeFallback,
    KATACODE_HOME: katacodeHome,
    HOME: katacodeHome,
    USERPROFILE: katacodeHome,
    ...(cursorApiKey ? { CURSOR_API_KEY: cursorApiKey } : {}),
    ...(githubToken ? { GH_TOKEN: githubToken } : {}),
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

/** Tear down temp directories, port claims, and registered cleanup callbacks for a run. */
export async function cleanupRunState(context: E2ERunContext): Promise<void> {
  const callbacks = cleanupCallbacksByRunId.get(context.runId) ?? [];
  for (const callback of [...callbacks].toReversed()) {
    await callback();
  }
  cleanupCallbacksByRunId.delete(context.runId);
}

/** Register an extra cleanup callback to run when an isolated E2E run finishes. */
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
