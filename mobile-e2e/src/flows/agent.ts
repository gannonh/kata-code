import { readAgentProviderConfig } from "../harness/env.ts";

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
 * KC_PROMPT (typed into the composer), KC_MODEL (selected in the model picker),
 * and KC_EXPECTED (asserted visible). Requires provider config; throws fail-loud
 * if KATACODE_E2E_AGENT_PROVIDER / _MODEL are unset.
 */
export function buildAgentMaestroEnv(runId: string): Record<string, string> {
  const { model } = readAgentProviderConfig();
  const expected = expectedAgentText(runId);
  return {
    KC_EXPECTED: expected,
    KC_PROMPT: buildAgentPrompt(expected),
    KC_MODEL: model,
  };
}
