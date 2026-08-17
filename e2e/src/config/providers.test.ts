import { homedir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assertGuidedProviderCredentials, resolveGuidedProviders } from "./providers.ts";

describe("guided provider registry", () => {
  it("keeps all checked-in providers when provider env overrides are absent", () => {
    expect(resolveGuidedProviders({}).map((provider) => provider.id)).toEqual([
      "codex",
      "claude",
      "pi",
    ]);
    expect(resolveGuidedProviders({}).map((provider) => provider.model)).toEqual([
      "gpt-5.6-luna",
      "haiku-4.5",
      "openrouter/google/gemini-flash-latest",
    ]);
    expect(resolveGuidedProviders({})[2]?.models).toEqual([
      "openrouter/google/gemini-flash-latest",
      "opencode-go/deepseek-v4-flash",
      "openai-codex/gpt-5.6-luna",
    ]);
    expect(resolveGuidedProviders({}).map((provider) => provider.stageDeadlineMs)).toEqual([
      180_000, 300_000, 180_000,
    ]);
  });

  it("applies model, fallback, agent-directory, and provider-list overrides", () => {
    const providers = resolveGuidedProviders({
      KATACODE_E2E_PROVIDERS: "codex,pi",
      KATACODE_E2E_AGENT_MODEL: "codex-override",
      KATACODE_E2E_PI_MODEL: "pi-override",
      KATACODE_E2E_PI_MODEL_FALLBACKS: "pi-fallback",
      KATACODE_E2E_PI_AGENT_DIR: "/tmp/pi-agent",
    });

    expect(providers).toEqual([
      expect.objectContaining({ id: "codex", model: "codex-override" }),
      expect.objectContaining({
        id: "pi",
        model: "pi-override",
        models: ["pi-override", "pi-fallback"],
        agentDir: "/tmp/pi-agent",
      }),
    ]);
  });

  it("rejects malformed provider allowlists", () => {
    expect(() => resolveGuidedProviders({ KATACODE_E2E_PROVIDERS: "codex," })).toThrow(
      "comma-separated allowlist",
    );
    expect(() => resolveGuidedProviders({ KATACODE_E2E_PROVIDERS: "codex,gemini" })).toThrow(
      "unknown provider(s): gemini",
    );
  });

  it("rejects unsupported auth mode overrides", async () => {
    const codex = resolveGuidedProviders({}).find((provider) => provider.id === "codex")!;
    await expect(
      assertGuidedProviderCredentials(codex, {
        KATACODE_E2E_CODEX_AUTH_MODE: "browser",
      }),
    ).rejects.toThrow("Invalid KATACODE_E2E_CODEX_AUTH_MODE=browser");
  });

  it("fails selected providers when their credentials are missing", async () => {
    const codex = resolveGuidedProviders({}).find((provider) => provider.id === "codex")!;
    await expect(
      assertGuidedProviderCredentials(codex, { KATACODE_E2E_CODEX_AUTH_MODE: "api-key" }),
    ).rejects.toThrow("OPENAI_API_KEY");

    const pi = resolveGuidedProviders({
      KATACODE_E2E_PI_AGENT_DIR: join(homedir(), "missing-katacode-pi-agent"),
    }).find((provider) => provider.id === "pi")!;
    await expect(assertGuidedProviderCredentials(pi, {})).rejects.toThrow("auth.json");
  });
});
