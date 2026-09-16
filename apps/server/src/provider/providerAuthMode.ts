import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

/**
 * E2E stacks set these variables to describe which credential a provider may
 * use. `oauth-or-api-key` means: use the API key when the environment provides
 * one, otherwise fall back to the provider's stored OAuth login.
 *
 * Claude resolves `ANTHROPIC_API_KEY` before its stored login, so it already
 * prefers the key. Codex resolves `OPENAI_API_KEY` only when no ChatGPT login
 * exists, and its app-server keeps using stored ChatGPT tokens even with a key
 * in the environment. Codex therefore gets a managed private home whose
 * `auth.json` selects API-key auth while every other entry still comes from
 * the shared Codex home.
 */
export const PROVIDER_AUTH_MODE_ENV = {
  codex: "KATACODE_E2E_CODEX_AUTH_MODE",
  claude: "KATACODE_E2E_CLAUDE_AUTH_MODE",
} as const;

export type ProviderAuthMode = "prefer-api-key" | "unchanged";

export function resolveProviderAuthMode(value: string | undefined): ProviderAuthMode {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return normalized === "oauth-or-api-key" || normalized === "api-key"
    ? "prefer-api-key"
    : "unchanged";
}

export function codexApiKeyFromEnvironment(env: NodeJS.ProcessEnv): string | undefined {
  if (resolveProviderAuthMode(env[PROVIDER_AUTH_MODE_ENV.codex]) !== "prefer-api-key")
    return undefined;
  const key = (env.CODEX_API_KEY ?? env.OPENAI_API_KEY ?? "").trim();
  return key.length > 0 ? key : undefined;
}

export function managedCodexAuthHome(baseDir: string, instanceId: string): string {
  return `${baseDir}/codex-auth/${instanceId}`;
}

export const CodexApiKeyAuth = Schema.Struct({
  auth_mode: Schema.Literal("apikey"),
  OPENAI_API_KEY: Schema.String,
});
const encodeCodexApiKeyAuth = Schema.encodeSync(Schema.fromJsonString(CodexApiKeyAuth));

export const writeCodexApiKeyAuth = Effect.fn("provider.writeCodexApiKeyAuth")(function* (input: {
  readonly homePath: string;
  readonly apiKey: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const authPath = path.join(input.homePath, "auth.json");
  yield* fileSystem.makeDirectory(input.homePath, { recursive: true });
  yield* fileSystem.writeFileString(
    authPath,
    encodeCodexApiKeyAuth({ auth_mode: "apikey", OPENAI_API_KEY: input.apiKey }),
  );
  yield* fileSystem.chmod(authPath, 0o600);
});
