import { platform } from "node:os";
import { request } from "node:http";

/* oxlint-disable kata-code/no-global-process-runtime -- Local E2E harness reads process.env for prerequisite checks. */

export type PrerequisiteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: string[] };

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

export function formatMissingPrerequisiteError(phase: string, missing: readonly string[]): string {
  return `${phase}: missing required environment variable(s): ${missing.join(", ")}. See e2e/README.md for setup.`;
}

export function readClerkPrerequisites(): PrerequisiteResult {
  const publishableKey = firstNonEmpty(
    process.env.CLERK_PUBLISHABLE_KEY,
    process.env.KATACODE_CLERK_PUBLISHABLE_KEY,
    process.env.VITE_CLERK_PUBLISHABLE_KEY,
  );
  const secretKey = firstNonEmpty(process.env.CLERK_SECRET_KEY);

  const missing: string[] = [];
  if (!publishableKey) {
    missing.push("CLERK_PUBLISHABLE_KEY");
  }
  if (!secretKey) {
    missing.push("CLERK_SECRET_KEY");
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export function readGoogleTestUserPrerequisites(): PrerequisiteResult {
  if (!firstNonEmpty(process.env.KATACODE_E2E_GOOGLE_EMAIL)) {
    return { ok: false, missing: ["KATACODE_E2E_GOOGLE_EMAIL"] };
  }

  return { ok: true };
}

export function readGoogleTestUserEmail(): string {
  const email = firstNonEmpty(process.env.KATACODE_E2E_GOOGLE_EMAIL);
  if (!email) {
    throw new Error(
      formatMissingPrerequisiteError("Google test-user auth", ["KATACODE_E2E_GOOGLE_EMAIL"]),
    );
  }

  return email;
}

export function readAgentProviderConfig(): { readonly provider: string; readonly model: string } {
  const provider = firstNonEmpty(process.env.KATACODE_E2E_AGENT_PROVIDER);
  const model = firstNonEmpty(process.env.KATACODE_E2E_AGENT_MODEL);
  const missing: string[] = [];

  if (!provider) {
    missing.push("KATACODE_E2E_AGENT_PROVIDER");
  }
  if (!model) {
    missing.push("KATACODE_E2E_AGENT_MODEL");
  }
  if (missing.length > 0) {
    throw new Error(formatMissingPrerequisiteError("Agent provider config", missing));
  }

  return { provider, model } as { readonly provider: string; readonly model: string };
}

export function readAgentProviderPrerequisites(): PrerequisiteResult {
  const missing: string[] = [];
  const provider = firstNonEmpty(process.env.KATACODE_E2E_AGENT_PROVIDER);
  const model = firstNonEmpty(process.env.KATACODE_E2E_AGENT_MODEL);

  if (!provider) {
    missing.push("KATACODE_E2E_AGENT_PROVIDER");
  }
  if (!model) {
    missing.push("KATACODE_E2E_AGENT_MODEL");
  }

  const providerKey = provider?.trim().toLowerCase();
  if (providerKey === "openai" && !firstNonEmpty(process.env.OPENAI_API_KEY)) {
    missing.push("OPENAI_API_KEY");
  }
  if (providerKey === "anthropic" && !firstNonEmpty(process.env.ANTHROPIC_API_KEY)) {
    missing.push("ANTHROPIC_API_KEY");
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

export function readClerkPublishableKey(): string {
  const key = firstNonEmpty(
    process.env.CLERK_PUBLISHABLE_KEY,
    process.env.KATACODE_CLERK_PUBLISHABLE_KEY,
    process.env.VITE_CLERK_PUBLISHABLE_KEY,
  );
  if (!key) {
    throw new Error(
      formatMissingPrerequisiteError("Clerk configuration", ["CLERK_PUBLISHABLE_KEY"]),
    );
  }
  return key;
}

export function isVideoEnabled(): boolean {
  return process.env.KATACODE_E2E_VIDEO === "1";
}

export function readWorkerCount(): number {
  const configured = Number.parseInt(process.env.KATACODE_E2E_WORKERS ?? "1", 10);
  return Number.isInteger(configured) && configured > 0 ? configured : 1;
}

export function assertMacOsHost(): void {
  if (platform() !== "darwin") {
    throw new Error(
      "Kata Code local Electron E2E currently supports macOS only. Run these tests on a macOS GUI session.",
    );
  }
}

export function readDockerSocketPath(): string {
  return process.env.DOCKER_HOST?.replace(/^unix:\/\//, "") ?? "/var/run/docker.sock";
}

/**
 * Fail loud if the local Docker/OrbStack daemon isn't reachable over the raw
 * Engine API (Unix socket). The `@environments-deploy` container flow provisions
 * real containers, so a missing daemon is a hard prerequisite, not a skip.
 */
export async function assertDockerDaemonReachable(): Promise<void> {
  const socketPath = readDockerSocketPath();
  await new Promise<void>((resolve, reject) => {
    const req = request({ socketPath, path: "/_ping", method: "GET", timeout: 3_000 }, (res) => {
      res.resume();
      res.on("end", () =>
        res.statusCode === 200
          ? resolve()
          : reject(new Error(`Docker daemon _ping returned ${res.statusCode ?? 0}.`)),
      );
    });
    req.on("error", (error) =>
      reject(new Error(`Docker daemon unreachable at ${socketPath}: ${error.message}.`)),
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Docker daemon _ping timed out at ${socketPath}.`));
    });
    req.end();
  });
}

/**
 * Fail loud if the `katacode:local` container image is absent. The
 * `@environments-deploy` flow provisions the real Kata server image (built by
 * `pnpm run build:docker-image`); a missing image makes the driver pull or fail
 * with a confusing reason. Assert it up front so the failure names the fix.
 */
export async function assertKatacodeImageBuilt(image = "katacode:local"): Promise<void> {
  const socketPath = readDockerSocketPath();
  await new Promise<void>((resolve, reject) => {
    const req = request(
      {
        socketPath,
        path: `/images/${encodeURIComponent(image)}/json`,
        method: "GET",
        timeout: 3_000,
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          res.statusCode === 200
            ? resolve()
            : reject(
                new Error(
                  `Container image ${image} is not built (inspect returned ${res.statusCode ?? 0}). Run \`pnpm run build:docker-image\` first.`,
                ),
              ),
        );
      },
    );
    req.on("error", (error) =>
      reject(new Error(`Docker image inspect failed for ${image}: ${error.message}.`)),
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Docker image inspect timed out for ${image}.`));
    });
    req.end();
  });
}

/**
 * Read Vercel Sandbox credentials for the E2E harness from the
 * `E2E_VERCEL_*` env vars. Namespaced separately from the production
 * `VERCEL_*` trio so a `.env` can hold test-only credentials without
 * colliding with real dev use of the kata-code app. Unlike the Docker
 * hard-fail helpers, Vercel credentialed checks are maintainer-local:
 * callers SKIP when any of the trio is absent rather than failing the suite.
 */
export function readVercelCredentials(): {
  readonly token: string;
  readonly teamId: string;
  readonly projectId: string;
} | null {
  const token = process.env.E2E_VERCEL_TOKEN;
  const teamId = process.env.E2E_VERCEL_TEAM_ID;
  const projectId = process.env.E2E_VERCEL_PROJECT_ID;
  if (!token || !teamId || !projectId) return null;
  return { token, teamId, projectId };
}

/**
 * Read the GitHub source repository + branch the Vercel source-picker E2E
 * selects. `E2E_VERCEL_SOURCE_REPOSITORY` is an `owner/name` the host `gh`
 * session can access; `E2E_VERCEL_SOURCE_BRANCH` defaults to the repository
 * default branch when omitted (the picker auto-selects it). Maintainer-local:
 * callers SKIP the source flow when the repository is absent.
 *
 * Shell-exported values win over `.env` (see `loadRepoEnv`). If a stale
 * `E2E_VERCEL_SOURCE_BRANCH=main` is exported in the terminal, it overrides
 * `master` in `.env` — `unset E2E_VERCEL_SOURCE_BRANCH` before re-running.
 */
export function readVercelSourceSelection(): {
  readonly repository: string;
  readonly branch: string | undefined;
} | null {
  const repository = firstNonEmpty(process.env.E2E_VERCEL_SOURCE_REPOSITORY);
  if (!repository) return null;
  return { repository, branch: firstNonEmpty(process.env.E2E_VERCEL_SOURCE_BRANCH) };
}
