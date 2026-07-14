/**
 * Web E2E fixture — starts the dev server, captures the pairing URL from
 * startup output, and provides an authenticated page for web tests.
 *
 * The server is started as a child process so we can capture the
 * `pairingUrl` line from stdout. The process is killed when the fixture
 * scope ends.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { type Page, test as base } from "@playwright/test";

const WEB_URL = process.env["KATACODE_WEB_URL"] ?? "http://localhost:5733";
const PAIRING_URL_TIMEOUT_MS = 60_000;

interface WebFixture {
  pairingUrl: string;
  webUrl: string;
}

export function resolveRepoRoot(): string {
  return join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
}

/**
 * Start `pnpm run dev` and capture the pairing URL from stdout.
 * If the server is already running and has an active session (cookie
 * from a prior run), the pairing URL may not appear — in that case
 * we return the base web URL and let the test proceed without pairing.
 */
async function startDevServerAndCapturePairingUrl(): Promise<{
  pairingUrl: string | null;
  process: ChildProcess | null;
}> {
  const repoRoot = resolveRepoRoot();

  // Check if a server is already running on the web port.
  const alreadyRunning = await fetch(`${WEB_URL}/`, { method: "GET" })
    .then((res) => res.ok)
    .catch(() => false);

  if (alreadyRunning) {
    return { pairingUrl: null, process: null };
  }

  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["run", "dev"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        KATACODE_NO_BROWSER: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    let pairingUrl: string | null = null;
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        reject(new Error("Timed out waiting for dev server pairing URL."));
      }
    }, PAIRING_URL_TIMEOUT_MS);

    const onLine = (line: string) => {
      if (pairingUrl) return;
      const match = line.match(/pairingUrl:\s*(\S+)/);
      if (match) {
        pairingUrl = match[1];
        clearTimeout(timeout);
        resolved = true;
        resolve({ pairingUrl, process: child });
      }
    };

    // Buffer incomplete trailing fragments across chunk boundaries so a
    // `pairingUrl:` line split between two data events still matches.
    const lineBuffer = () => {
      let pending = "";
      return (chunk: string) => {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      };
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    const onStdout = lineBuffer();
    const onStderr = lineBuffer();
    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);

    child.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

/**
 * Authenticate a Playwright page by navigating to the pairing URL.
 * The app auto-submits the token from the URL hash and redirects to "/".
 * If no pairing URL is available (server already running with an existing
 * session), just navigate to "/" and hope for the best.
 */
async function authenticatePage(page: Page, pairingUrl: string | null): Promise<void> {
  if (pairingUrl) {
    await page.goto(pairingUrl);
    // The app auto-submits the one-time token and leaves the pairing route.
    await page.waitForURL((url) => url.pathname !== "/pair", { timeout: 30_000 });
  } else {
    await page.goto("/");
  }

  // Wait for the app shell to render (authenticated state).
  await page.getByTestId("command-palette-trigger").waitFor({ state: "visible", timeout: 30_000 });
}

export const webTest = base.extend<{
  webPage: Page;
  webFixture: WebFixture;
}>({
  webFixture: async ({ browserName: _browserName }, use) => {
    const { pairingUrl, process: serverProcess } = await startDevServerAndCapturePairingUrl();

    try {
      await use({ pairingUrl: pairingUrl ?? "", webUrl: WEB_URL });
    } finally {
      if (serverProcess) {
        // Signal the whole detached process group (pnpm wraps the real dev
        // server as a grandchild), then give SIGTERM a grace window before
        // escalating to SIGKILL so the dev server can shut down gracefully.
        const pid = serverProcess.pid;
        if (pid) {
          try {
            process.kill(-pid, "SIGTERM");
          } catch {
            serverProcess.kill("SIGTERM");
          }
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          try {
            process.kill(-pid, "SIGKILL");
          } catch {
            serverProcess.kill("SIGKILL");
          }
        }
      }
    }
  },
  webPage: async ({ page, webFixture }, use) => {
    await authenticatePage(page, webFixture.pairingUrl || null);
    await use(page);
  },
});

export { expect } from "@playwright/test";
