import { platform } from "node:os";

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
