import { formatModelDisplayName } from "@kata-sh/code-shared/model";

import { readAgentProviderConfig } from "../harness/env.ts";

/**
 * Provider id -> the submenu label the mobile model picker shows. The picker
 * groups models by provider using `providerDisplayLabel`
 * (apps/mobile/src/lib/modelOptions.ts): a provider with `driver: "codex"`
 * shows "Codex"; `driver: "claudeAgent"` shows "Claude". The harness injects
 * `KATACODE_E2E_AGENT_PROVIDER` as a *provider id* (`openai` / `anthropic`,
 * per the README env table), so only those keys are mapped here. An unknown
 * provider id falls back to the raw value so a misconfiguration is visible in
 * the flow (the tap targets nothing) rather than silently matching nothing.
 */
const PROVIDER_LABELS: Record<string, string> = {
  openai: "Codex",
  anthropic: "Claude",
};

export function providerMenuLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Mobile model-picker display label for a model slug. Delegates to the shared
 * formatter `packages/shared/model.ts` so the label the flow taps always matches
 * what the app renders (previously a fragile in-harness duplicate).
 */
export function modelMenuLabel(slug: string): string {
  return formatModelDisplayName(slug);
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
