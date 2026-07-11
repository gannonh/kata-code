import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type Page } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { logHarnessPhase } from "../harness/log.ts";
import {
  formatMissingPrerequisiteError,
  readClerkPrerequisites,
  readGoogleTestUserEmail,
  readGoogleTestUserPrerequisites,
} from "../harness/env.ts";
import type { E2ERunContext } from "../harness/isolatedRun.ts";

/**
 * E2E flow helpers for Kata Code Connect (the headless CLI OAuth path). The
 * `katacode connect login` CLI command runs a browser PKCE OAuth flow against
 * Clerk's `/oauth/authorize` endpoint (a dedicated CLI OAuth client, distinct
 * from the desktop app's frontend Clerk session). The sandbox `startSession`
 * Connect step (`reconcileDesiredCloudLink`) requires the CLI OAuth token this
 * flow mints, so the environments-deploy e2e must authorize Connect against the
 * dev server's isolated home before starting a session.
 *
 * The authorize URL redirects to the Clerk Account Portal sign-in page, which
 * loads the Clerk frontend SDK (`window.Clerk`). `setupClerkTestingToken`
 * bypasses Clerk bot detection on the Frontend API, and `clerk.signIn` signs in
 * the Google test user via the ticket strategy (the same path the app sign-in
 * uses). After sign-in, Clerk shows an OAuth consent screen and redirects to
 * the CLI's callback server on `127.0.0.1:34338`, which exchanges the code for
 * the token. The CLI then exits 0.
 */

/** Assert the env prerequisites for Clerk Connect authorization are present. */
export function assertConnectAuthPrerequisites(phase: string): void {
  const clerkPrereqs = readClerkPrerequisites();
  if (!clerkPrereqs.ok) {
    throw new Error(formatMissingPrerequisiteError(phase, clerkPrereqs.missing));
  }
  const google = readGoogleTestUserPrerequisites();
  if (!google.ok) {
    throw new Error(formatMissingPrerequisiteError(phase, google.missing));
  }
}

interface ConnectLoginHandle {
  /** Resolves with the authorize URL once the CLI prints it. */
  readonly authorizeUrl: Promise<string>;
  /** Resolves when the CLI process exits (0 on success). */
  readonly done: Promise<void>;
  /** Abort the CLI process (for teardown on test failure). */
  readonly cancel: () => void;
}

/**
 * Spawn `katacode connect login` against the isolated e2e home. The CLI starts a
 * callback server on `127.0.0.1:34338`, prints the authorize URL, and waits for
 * the OAuth callback to exchange the code for a token (then exits 0).
 *
 * Must pass `VITE_DEV_SERVER_URL` so the CLI stores the OAuth token under
 * `{KATACODE_HOME}/dev/secrets/` — the same state dir the Electron-embedded
 * server uses in desktop-dev. Without it the CLI writes `userdata/secrets/`
 * and Create & run falls through to a short-lived Clerk JWT that the relay
 * rejects as `invalid_bearer`.
 */
function spawnConnectLogin(runContext: E2ERunContext): ConnectLoginHandle {
  const bin = join(runContext.repoRoot, "apps/server/dist/bin.mjs");
  const viteDevServerUrl = `http://127.0.0.1:${runContext.webPort}`;
  const child: ChildProcess = spawn(
    process.execPath,
    [bin, "connect", "login", "--base-dir", runContext.katacodeHome],
    {
      env: {
        ...process.env,
        KATACODE_HOME: runContext.katacodeHome,
        VITE_DEV_SERVER_URL: viteDevServerUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let resolveAuthorizeUrl: ((url: string) => void) | null = null;
  const authorizeUrl = new Promise<string>((resolve) => {
    resolveAuthorizeUrl = resolve;
  });

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
    if (resolveAuthorizeUrl) {
      const match = stdout.match(/https:\/\/\S+\/oauth\/authorize\S+/);
      if (match) {
        resolveAuthorizeUrl(match[0]);
        resolveAuthorizeUrl = null;
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    // Surface CLI errors (e.g. missing relay config) for debugging.
    process.stderr.write(`[connect login stderr] ${chunk.toString()}`);
  });

  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (error) =>
      reject(new Error(`connect login failed to start: ${error.message}`)),
    );
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`connect login exited with code ${code}. stdout: ${stdout.slice(-512)}`));
    });
  });

  const cancel = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // Already exited.
    }
  };

  return { authorizeUrl, done, cancel };
}

/**
 * Launch a standalone Chromium browser for the Connect OAuth flow and run `fn`
 * with its page. Electron's browser context cannot open arbitrary external
 * URLs (Clerk's authorize endpoint), so a separate Chromium is required.
 */
export async function withConnectBrowser<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Authorize Kata Code Connect for the dev server's isolated home by driving the
 * `katacode connect login` browser OAuth flow. Spawns the CLI, launches a
 * standalone Chromium browser, opens the authorize URL, signs in the Google
 * test user via the ticket strategy, consents, and awaits the CLI's token
 * exchange. After this resolves, `reconcileDesiredCloudLink` (and thus
 * `sandbox.startSession`) succeeds.
 *
 * Electron's browser context cannot open arbitrary external URLs, so this
 * launches its own Chromium. The Clerk testing token is installed on the
 * browser context to bypass bot detection.
 */
export async function authorizeConnectCli(runContext: E2ERunContext, page: Page): Promise<void> {
  assertConnectAuthPrerequisites("Kata Code Connect CLI auth");
  const email = readGoogleTestUserEmail();

  // Install the Clerk testing token on the context so Clerk's Frontend API
  // (called by the Account Portal sign-in page) bypasses bot detection.
  await setupClerkTestingToken({ context: page.context() });

  logHarnessPhase("Starting `katacode connect login` and capturing the authorize URL...");
  const handle = spawnConnectLogin(runContext);
  let authorizeUrlTimeout: ReturnType<typeof setTimeout> | undefined;
  const authorizeUrl = await Promise.race([
    handle.authorizeUrl,
    handle.done.then(() => {
      throw new Error("`katacode connect login` exited before printing the OAuth authorize URL.");
    }),
    new Promise<never>((_, reject) => {
      authorizeUrlTimeout = setTimeout(() => {
        handle.cancel();
        reject(
          new Error(
            "`katacode connect login` did not print the OAuth authorize URL before timing out.",
          ),
        );
      }, E2E_TIMEOUTS.authMs);
    }),
  ])
    .catch((error) => {
      handle.cancel();
      throw error;
    })
    .finally(() => {
      if (authorizeUrlTimeout) clearTimeout(authorizeUrlTimeout);
    });

  logHarnessPhase(`Opening Clerk authorize URL and signing in the Google test user (${email})...`);
  await page.goto(authorizeUrl, { waitUntil: "domcontentloaded", timeout: E2E_TIMEOUTS.authMs });

  // The authorize URL redirects to the Account Portal sign-in page. Its Clerk
  // global can be replaced during the redirect, while @clerk/testing's
  // `loaded()` helper dereferences `window.Clerk` without optional chaining.
  // Wait on the stable, optional-chained signal before using the ticket flow.
  await page.waitForFunction(() => Boolean(window.Clerk?.loaded), undefined, {
    timeout: E2E_TIMEOUTS.authMs,
  });
  await clerk.signIn({ page, emailAddress: email });

  // After sign-in, Clerk redirects to the OAuth consent screen. Approve the
  // CLI client, which redirects to :34338/callback and exchanges the code.
  logHarnessPhase("Approving the Kata Code Connect OAuth consent screen...");
  const consent = page.getByRole("button", { name: /allow|approve|continue|authorize/i }).first();
  await consent.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.authMs });
  await consent.click();

  // The callback exchange + CLI exit can take a few seconds. If the CLI does
  // not exit, surface its output rather than hanging.
  logHarnessPhase("Awaiting the CLI token exchange...");
  await Promise.race([
    handle.done,
    delay(E2E_TIMEOUTS.authMs).then(() => {
      handle.cancel();
      throw new Error(
        "`katacode connect login` did not complete after the OAuth consent. " +
          "Check the CLI stderr above and the Clerk OAuth app's redirect URI.",
      );
    }),
  ]);

  // Fail loud if the token landed outside the Electron server's secrets dir.
  const expectedTokenPath = join(
    runContext.katacodeHome,
    "dev",
    "secrets",
    "cloud-cli-oauth-token.bin",
  );
  try {
    await access(expectedTokenPath);
  } catch {
    throw new Error(
      `Kata Code Connect CLI authorized, but the OAuth token was not written to ${expectedTokenPath}. ` +
        "The Electron server reads `{KATACODE_HOME}/dev/secrets/` in desktop-dev; without that file, " +
        "Create & run falls through to a Clerk JWT and the relay returns invalid_bearer.",
    );
  }
  logHarnessPhase(`Kata Code Connect CLI authorized (${expectedTokenPath}).`);
}
