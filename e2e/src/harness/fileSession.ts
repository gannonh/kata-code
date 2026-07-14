import {
  chromium,
  type Browser,
  type BrowserContext,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { expectSignedInClerkState, signInWithClerkGoogleTestUser } from "../flows/auth.ts";
import { dismissBlockingToasts } from "../flows/navigation.ts";
import { waitForAppEnvironmentReady } from "../flows/pairing.ts";
import { waitForAppShell } from "../flows/shell.ts";
import { attachFatalLaunchErrorTracking, launchApp } from "./appLaunch.ts";
import { writeRunManifest } from "./artifacts.ts";
import { startWebDevStack } from "./devStack.ts";
import { assertMacOsHost } from "./env.ts";
import { cleanupRunState, createIsolatedRun, type E2ERunContext } from "./isolatedRun.ts";
import { logHarnessPhase } from "./log.ts";
import { type AppProject, resolveAppProject } from "./project.ts";

export interface AppDiagnostics {
  readonly readFatalErrors: () => readonly string[];
}

export interface E2ESession {
  readonly appTarget: AppProject["appTarget"];
  readonly runContext: E2ERunContext;
  readonly launchedApp: AppDiagnostics;
  readonly electronApp?: ElectronApplication;
  readonly browser?: Browser;
  readonly browserContext?: BrowserContext;
  readonly appWindow: Page;
  readonly authenticatedAppWindow: Page;
  readonly authenticate: () => Promise<Page>;
  readonly close: () => Promise<void>;
}

interface ManagedSession {
  readonly session: E2ESession;
  refCount: number;
}

const sessionsByFile = new Map<string, ManagedSession>();

async function authenticateSession(page: Page): Promise<void> {
  logHarnessPhase("Signing in with Clerk Google test user...");
  await signInWithClerkGoogleTestUser(page);
  await expectSignedInClerkState(page, { requireVisibleAvatar: false });
  await resetAppToHome(page);
}

async function bootDesktopSession(project: AppProject, fileKey: string): Promise<E2ESession> {
  assertMacOsHost();
  const runContext = await createIsolatedRun({
    projectName: fileKey,
    launchTarget: project.launchTarget,
  });
  await writeRunManifest(runContext);
  try {
    const launchedApp = await launchApp(runContext);
    await waitForAppEnvironmentReady(launchedApp.window, runContext);
    let authentication: Promise<Page> | undefined;
    const authenticate = () =>
      (authentication ??= authenticateSession(launchedApp.window).then(() => launchedApp.window));
    return {
      appTarget: "desktop",
      runContext,
      launchedApp,
      electronApp: launchedApp.electronApp,
      appWindow: launchedApp.window,
      authenticatedAppWindow: launchedApp.window,
      authenticate,
      close: () => cleanupRunState(runContext),
    };
  } catch (error) {
    await cleanupRunState(runContext).catch(() => undefined);
    throw error;
  }
}

async function bootWebSession(project: AppProject, fileKey: string): Promise<E2ESession> {
  const runContext = await createIsolatedRun({
    projectName: fileKey,
    launchTarget: project.launchTarget,
  });
  await writeRunManifest(runContext);
  let browser: Browser | undefined;
  let browserContext: BrowserContext | undefined;
  try {
    const { pairingUrl } = await startWebDevStack(runContext);
    browser = await chromium.launch();
    browserContext = await browser.newContext();
    const page = await browserContext.newPage();
    const readFatalErrors = attachFatalLaunchErrorTracking(page);
    await page.goto(pairingUrl);
    // Keep the one-time token in the URL until the pairing page consumes it.
    // The generic shell wait reloads a visible pairing gate for Electron startup
    // recovery, which would discard the web token hash before submission.
    await page.waitForURL((url) => url.pathname !== "/pair", {
      timeout: E2E_TIMEOUTS.pairingMs,
    });
    await waitForAppShell(page, E2E_TIMEOUTS.pairingMs);
    let authentication: Promise<Page> | undefined;
    const authenticate = () => (authentication ??= authenticateSession(page).then(() => page));
    return {
      appTarget: "web",
      runContext,
      launchedApp: { readFatalErrors },
      browser,
      browserContext,
      appWindow: page,
      authenticatedAppWindow: page,
      authenticate,
      close: async () => {
        await browserContext.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
        await cleanupRunState(runContext);
      },
    };
  } catch (error) {
    await browserContext?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await cleanupRunState(runContext).catch(() => undefined);
    throw error;
  }
}

export async function acquireFileSession(
  testInfo: {
    readonly file: string;
    readonly project: { readonly name: string; readonly metadata: unknown };
  },
  options: { readonly browserName: string },
): Promise<E2ESession> {
  const existing = sessionsByFile.get(testInfo.file);
  if (existing) {
    existing.refCount += 1;
    return existing.session;
  }

  // Playwright has no file-scoped fixtures. Keep a session while tests from the
  // same spec run, then close the previous file's idle session before booting
  // the next one. This provides one launch per spec without retaining stacks.
  for (const [fileKey, managed] of sessionsByFile) {
    if (managed.refCount === 0) {
      sessionsByFile.delete(fileKey);
      await managed.session.close();
    }
  }

  const project = resolveAppProject(testInfo.project.name, testInfo.project.metadata);
  if (project.appTarget === "web" && options.browserName !== "chromium") {
    throw new Error(`Web E2E requires Chromium; received browserName="${options.browserName}".`);
  }
  const session =
    project.appTarget === "desktop"
      ? await bootDesktopSession(project, testInfo.file)
      : await bootWebSession(project, testInfo.file);
  sessionsByFile.set(testInfo.file, { session, refCount: 1 });
  return session;
}

export async function dropFileSessionRef(fileKey: string): Promise<void> {
  const managed = sessionsByFile.get(fileKey);
  if (!managed) return;
  managed.refCount = Math.max(0, managed.refCount - 1);
}

export async function disposeFileSession(fileKey: string): Promise<void> {
  const managed = sessionsByFile.get(fileKey);
  if (!managed) return;
  sessionsByFile.delete(fileKey);
  await managed.session.close();
}

export async function disposeAllSessions(): Promise<void> {
  const pending = [...sessionsByFile.values()];
  sessionsByFile.clear();
  for (const managed of pending) await managed.session.close();
}

export async function resetAppToHome(page: Page): Promise<void> {
  await dismissBlockingToasts(page);
  const home = page.getByRole("link", { name: "Go to threads" });
  if (await home.isVisible().catch(() => false)) {
    await home.click().catch(() => undefined);
  }
  await dismissBlockingToasts(page);
  await waitForAppShell(page, E2E_TIMEOUTS.assertionMs);
}
