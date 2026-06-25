import { readAgentProviderConfig } from "../harness/env.ts";

/**
 * Provider driver -> the label the mobile model picker shows for its submenu.
 * The picker groups models by provider using `providerDisplayLabel`
 * (apps/mobile/src/lib/modelOptions.ts): codex -> "Codex", claudeAgent ->
 * "Claude". The harness injects `KATACODE_E2E_AGENT_PROVIDER` as a driver key.
 */
const PROVIDER_LABELS: Record<string, string> = {
  openai: "Codex",
  codex: "Codex",
  anthropic: "Claude",
  claudeAgent: "Claude",
};

/**
 * Provider submenu label for the mobile model picker. Falls back to the raw
 * provider key so a misconfigured provider fails visibly in the flow rather than
 * silently matching nothing.
 */
export function providerMenuLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Mobile model-picker display label for a Codex/OpenAI model slug. Mirrors the
 * server's `toDisplayName` (apps/server/.../CodexProvider.ts): capitalize a
 * leading "gpt" to "GPT" and uppercase the first letter after each dash, e.g.
 * `gpt-5.4-mini` -> `GPT-5.4-Mini`. Keep in sync with that formatter.
 */
export function modelMenuLabel(slug: string): string {
  return slug.replace(/^gpt/i, "GPT").replace(/-([a-z])/g, (_, c: string) => `-${c.toUpperCase()}`);
}

/**
 * Deterministic agent token tied to the run id, so a real provider's reply can be
 * asserted exactly and never collides with another run's messages.
 */
export function expectedAgentText(runId: string): string {
  return `E2E_AGENT_OK_${runId}`;
}

export function buildAgentPrompt(expected: string): string {
  return `Reply to this message with exactly: ${expected}`;
}

/**
 * Whitespace/wrapper normalization contract for the assistant reply: trim, collapse
 * internal whitespace, and strip surrounding code fences or backticks a model may add.
 */
export function normalizeReply(text: string): string {
  return text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesExpected(reply: string, expected: string): boolean {
  return normalizeReply(reply) === normalizeReply(expected);
}

/**
 * Maestro variables for `maestro/agent/deterministic-chat.yaml`:
 * KC_PROMPT (typed into the composer), KC_MODEL (the model slug), KC_EXPECTED
 * (asserted visible), and the model-picker display labels KC_PROVIDER_LABEL /
 * KC_MODEL_LABEL (tapped in the picker). Requires provider config; throws
 * fail-loud if KATACODE_E2E_AGENT_PROVIDER / _MODEL are unset.
 */
export function buildAgentMaestroEnv(runId: string): Record<string, string> {
  const { provider, model } = readAgentProviderConfig();
  const expected = expectedAgentText(runId);
  return {
    KC_EXPECTED: expected,
    KC_PROMPT: buildAgentPrompt(expected),
    KC_MODEL: model,
    // The picker shows display labels, not the raw slug/provider key; inject both
    // so the Maestro flow can tap the provider submenu then the model row.
    KC_PROVIDER_LABEL: providerMenuLabel(provider),
    KC_MODEL_LABEL: modelMenuLabel(model),
  };
}
