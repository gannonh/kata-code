/* oxlint-disable kata-code/no-global-process-runtime -- E2E provider checks run outside the Effect runtime. */

import { execFile as execFileCallback } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { E2E_TAGS, type E2ETag } from "./tags.ts";

const execFile = promisify(execFileCallback);

const AUTH_MODES = ["oauth", "oauth-or-api-key", "api-key"] as const;
type AuthMode = (typeof AUTH_MODES)[number];

export type GuidedProviderId = "codex" | "claude" | "pi";

export type GuidedProviderAuth = "host-oauth-or-api-key" | "agent-dir";

export interface GuidedProvider {
  readonly id: GuidedProviderId;
  readonly tag: E2ETag;
  readonly model: string;
  readonly models: ReadonlyArray<string>;
  readonly auth: GuidedProviderAuth;
  readonly agentDir?: string;
}

const PROVIDER_DEFAULTS = [
  {
    id: "codex",
    tag: E2E_TAGS.codex,
    auth: "host-oauth-or-api-key",
    defaultModel: "gpt-5.6-luna",
    modelEnv: "KATACODE_E2E_AGENT_MODEL",
  },
  {
    id: "claude",
    tag: E2E_TAGS.claude,
    auth: "host-oauth-or-api-key",
    defaultModel: "haiku-4.5",
    modelEnv: "KATACODE_E2E_CLAUDE_MODEL",
  },
  {
    id: "pi",
    tag: E2E_TAGS.pi,
    auth: "agent-dir",
    defaultModel: "openrouter/google/gemini-flash-latest",
    defaultModelFallbacks: ["opencode-go/deepseek-v4-flash", "openai-codex/gpt-5.6-luna"],
    modelEnv: "KATACODE_E2E_PI_MODEL",
    modelFallbacksEnv: "KATACODE_E2E_PI_MODEL_FALLBACKS",
    defaultAgentDir: join(homedir(), ".pi", "agent"),
    agentDirEnv: "KATACODE_E2E_PI_AGENT_DIR",
  },
] as const;

function nonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

function resolveModels(
  defaultModel: string,
  modelEnv: string,
  env: NodeJS.ProcessEnv,
  defaultModelFallbacks: ReadonlyArray<string> = [],
  modelFallbacksEnv?: string,
): { readonly model: string; readonly models: ReadonlyArray<string> } {
  const model = nonEmptyEnv(env, modelEnv) ?? defaultModel;
  const fallbackValue = modelFallbacksEnv === undefined ? undefined : env[modelFallbacksEnv];
  const fallbacks =
    fallbackValue === undefined
      ? defaultModelFallbacks
      : fallbackValue
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
  return { model, models: [model, ...fallbacks] };
}

export function resolveGuidedProviders(
  env: NodeJS.ProcessEnv = process.env,
): ReadonlyArray<GuidedProvider> {
  const requested = nonEmptyEnv(env, "KATACODE_E2E_PROVIDERS");
  const requestedIds = requested?.split(",").map((entry) => entry.trim().toLowerCase()) ?? null;

  if (requestedIds?.some((id) => id.length === 0)) {
    throw new Error(
      "KATACODE_E2E_PROVIDERS must be a comma-separated allowlist of codex, claude, and pi.",
    );
  }

  const knownIds = new Set<GuidedProviderId>(PROVIDER_DEFAULTS.map((provider) => provider.id));
  const unknownIds = requestedIds?.filter((id) => !knownIds.has(id as GuidedProviderId)) ?? [];
  if (unknownIds.length > 0) {
    throw new Error(
      `KATACODE_E2E_PROVIDERS contains unknown provider(s): ${unknownIds.join(", ")}. Expected codex, claude, or pi.`,
    );
  }

  const selectedIds = requestedIds === null ? null : new Set(requestedIds);
  return PROVIDER_DEFAULTS.filter(
    (provider) => selectedIds === null || selectedIds.has(provider.id),
  ).map((provider) => {
    const models = resolveModels(
      provider.defaultModel,
      provider.modelEnv,
      env,
      "defaultModelFallbacks" in provider ? provider.defaultModelFallbacks : [],
      "modelFallbacksEnv" in provider ? provider.modelFallbacksEnv : undefined,
    );
    const agentDir =
      "defaultAgentDir" in provider
        ? (nonEmptyEnv(env, provider.agentDirEnv) ?? provider.defaultAgentDir)
        : undefined;
    return {
      id: provider.id,
      tag: provider.tag,
      auth: provider.auth,
      ...models,
      ...(agentDir ? { agentDir } : {}),
    };
  });
}

export const GUIDED_PROVIDERS = resolveGuidedProviders();

function authMode(env: NodeJS.ProcessEnv, name: string): AuthMode {
  const value = nonEmptyEnv(env, name)?.toLowerCase();
  if (value === undefined) return "oauth-or-api-key";
  if (AUTH_MODES.includes(value as AuthMode)) return value as AuthMode;
  throw new Error(`Invalid ${name}=${value}. Expected one of: ${AUTH_MODES.join(", ")}.`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function claudeKeychainCredentialExists(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    const { stdout } = await execFile("security", [
      "find-generic-password",
      "-s",
      "Claude Code-credentials",
      "-w",
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function missingCredentialsMessage(
  provider: GuidedProviderId,
  missing: ReadonlyArray<string>,
): Error {
  return new Error(
    `Guided E2E ${provider} credentials are missing: ${missing.join(" or ")}. Provide one of the listed credentials or exclude ${provider} with KATACODE_E2E_PROVIDERS.`,
  );
}

export async function assertGuidedProviderCredentials(
  provider: GuidedProvider,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  if (provider.id === "pi") {
    const authPath = join(provider.agentDir ?? join(homedir(), ".pi", "agent"), "auth.json");
    if (!(await fileExists(authPath))) {
      throw missingCredentialsMessage("pi", [`${authPath} (auth.json)`]);
    }
    return;
  }

  if (provider.id === "codex") {
    const mode = authMode(env, "KATACODE_E2E_CODEX_AUTH_MODE");
    const oauthPath = join(
      nonEmptyEnv(env, "KATACODE_E2E_CODEX_AUTH_SOURCE") ?? join(homedir(), ".codex"),
      "auth.json",
    );
    const hasOAuth = await fileExists(oauthPath);
    const hasApiKey = nonEmptyEnv(env, "OPENAI_API_KEY") !== undefined;
    if (
      (mode === "oauth" && !hasOAuth) ||
      (mode === "api-key" && !hasApiKey) ||
      (mode === "oauth-or-api-key" && !hasOAuth && !hasApiKey)
    ) {
      const missing =
        mode === "oauth"
          ? [`${oauthPath} (Codex OAuth)`]
          : mode === "api-key"
            ? ["OPENAI_API_KEY"]
            : [`${oauthPath} (Codex OAuth)`, "OPENAI_API_KEY (API-key fallback)"];
      throw missingCredentialsMessage("codex", missing);
    }
    return;
  }

  const mode = authMode(env, "KATACODE_E2E_CLAUDE_AUTH_MODE");
  const oauthFile = join(homedir(), ".claude.json");
  const hasOAuth = (await fileExists(oauthFile)) && (await claudeKeychainCredentialExists());
  const hasApiKey =
    nonEmptyEnv(env, "ANTHROPIC_API_KEY") !== undefined ||
    nonEmptyEnv(env, "ANTHROPIC_AUTH_TOKEN") !== undefined;
  if (
    (mode === "oauth" && !hasOAuth) ||
    (mode === "api-key" && !hasApiKey) ||
    (mode === "oauth-or-api-key" && !hasOAuth && !hasApiKey)
  ) {
    const missing =
      mode === "oauth"
        ? [`${oauthFile} and macOS keychain item Claude Code-credentials (Claude OAuth)`]
        : mode === "api-key"
          ? ["ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN"]
          : [
              `${oauthFile} and macOS keychain item Claude Code-credentials (Claude OAuth)`,
              "ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN (API-key fallback)",
            ];
    throw missingCredentialsMessage("claude", missing);
  }
}
