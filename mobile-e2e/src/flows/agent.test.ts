import { describe, expect, it } from "vitest";

import {
  buildAgentPrompt,
  expectedAgentText,
  matchesExpected,
  modelMenuLabel,
  normalizeReply,
  providerMenuLabel,
} from "./agent.ts";

describe("expectedAgentText", () => {
  it("derives a unique deterministic token from the run id", () => {
    // Tying the expected text to the run id keeps two runs from matching each
    // other's leftover messages.
    expect(expectedAgentText("mobile-e2e-123-abc")).toBe("E2E_AGENT_OK_mobile-e2e-123-abc");
  });
});

describe("buildAgentPrompt", () => {
  it("instructs the model to reply with exactly the expected token", () => {
    expect(buildAgentPrompt("E2E_AGENT_OK_x")).toBe(
      "Reply to this message with exactly: E2E_AGENT_OK_x",
    );
  });
});

describe("normalizeReply", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeReply("  E2E_AGENT_OK_x \n")).toBe("E2E_AGENT_OK_x");
  });

  it("strips surrounding code fences and backticks the model may add", () => {
    expect(normalizeReply("```\nE2E_AGENT_OK_x\n```")).toBe("E2E_AGENT_OK_x");
    expect(normalizeReply("`E2E_AGENT_OK_x`")).toBe("E2E_AGENT_OK_x");
  });
});

describe("matchesExpected", () => {
  it("matches the expected token after normalization, not by raw equality", () => {
    // A real model often wraps or pads the token; the assertion must survive that
    // but still fail on a wrong token.
    expect(matchesExpected("  `E2E_AGENT_OK_x` ", "E2E_AGENT_OK_x")).toBe(true);
    expect(matchesExpected("E2E_AGENT_OK_y", "E2E_AGENT_OK_x")).toBe(false);
  });
});

describe("providerMenuLabel", () => {
  it("maps provider driver keys to the picker's submenu labels", () => {
    // The picker groups by provider display label, not the raw driver key, so the
    // flow must tap "Codex"/"Claude" rather than "openai"/"anthropic".
    expect(providerMenuLabel("openai")).toBe("Codex");
    expect(providerMenuLabel("anthropic")).toBe("Claude");
  });

  it("falls back to the raw key so a misconfigured provider fails visibly", () => {
    expect(providerMenuLabel("mystery")).toBe("mystery");
  });
});

describe("modelMenuLabel", () => {
  it("derives the picker's display label from a model slug", () => {
    // Mirrors the server's toDisplayName: GPT uppercased, first letter after each
    // dash uppercased. A mismatch here means the flow taps a non-existent row.
    expect(modelMenuLabel("gpt-5.4-mini")).toBe("GPT-5.4-Mini");
    expect(modelMenuLabel("gpt-5.3-codex")).toBe("GPT-5.3-Codex");
  });
});
