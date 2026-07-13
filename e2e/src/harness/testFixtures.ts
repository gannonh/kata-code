import { test as base, expect, type ElectronApplication, type Page } from "@playwright/test";

import {
  acquireFileSession,
  disposeAllSessions,
  disposeFileSession,
  dropFileSessionRef,
  resetAppToHome,
  type E2ESession,
} from "./fileSession.ts";
import type { E2ERunContext, LaunchTarget } from "./isolatedRun.ts";
import { type AppTarget, resolveAppProject } from "./project.ts";

export interface E2EFixtures {
  appTarget: AppTarget;
  launchTarget: LaunchTarget;
  session: E2ESession;
  runContext: E2ERunContext;
  launchedApp: E2ESession["launchedApp"];
  electronApp: ElectronApplication;
  appPage: Page;
  authenticatedAppPage: Page;
  /** Compatibility alias for appPage. */
  appWindow: Page;
  /** Compatibility alias for authenticatedAppPage. */
  authenticatedAppWindow: Page;
}

export const test = base.extend<E2EFixtures, { workerSessionDisposer: void }>({
  launchTarget: async ({ browserName: _browserName }, use, testInfo) => {
    await use(resolveAppProject(testInfo.project.name, testInfo.project.metadata).launchTarget);
  },

  appTarget: async ({ browserName: _browserName }, use, testInfo) => {
    await use(resolveAppProject(testInfo.project.name, testInfo.project.metadata).appTarget);
  },

  session: async ({ browserName }, use, testInfo) => {
    const acquired = await acquireFileSession(testInfo, { browserName });
    await use(acquired);
    await dropFileSessionRef(testInfo.file);
  },

  workerSessionDisposer: [
    async ({ browserName: _browserName }, use) => {
      await use(undefined);
      await disposeAllSessions();
    },
    { scope: "worker", auto: true },
  ],

  runContext: async ({ session }, use) => use(session.runContext),
  launchedApp: async ({ session }, use) => use(session.launchedApp),
  electronApp: async ({ session }, use, testInfo) => {
    if (session.electronApp === undefined) {
      throw new Error(
        `E2E test "${testInfo.title}" requested electronApp under appTarget="${session.appTarget}". Guard native behavior with appTarget === "desktop".`,
      );
    }
    await use(session.electronApp);
  },
  appPage: async ({ session }, use) => use(session.appWindow),
  authenticatedAppPage: async ({ session }, use) => use(await session.authenticate()),
  appWindow: async ({ appPage }, use) => use(appPage),
  authenticatedAppWindow: async ({ authenticatedAppPage }, use) => use(authenticatedAppPage),
});

test.afterAll(async ({ browserName: _browserName }, testInfo) => {
  await disposeFileSession(testInfo.file);
});

export { expect, resetAppToHome };
