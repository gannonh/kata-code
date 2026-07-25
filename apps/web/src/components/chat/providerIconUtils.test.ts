import { describe, expect, it } from "vite-plus/test";

import {
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
  type ModelEsque,
} from "./providerIconUtils";

describe("getTriggerDisplayModelLabel", () => {
  const openaiSol: ModelEsque = {
    slug: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    subProvider: "openai",
  };
  const openaiCodexSol: ModelEsque = {
    slug: "openai-codex/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    subProvider: "openai-codex",
  };
  const uniqueOpus: ModelEsque = {
    slug: "github-copilot/claude-opus-4.5",
    name: "Claude Opus 4.5",
    shortName: "Opus 4.5",
    subProvider: "GitHub Copilot",
  };

  it("keeps unique display names plain in the trigger", () => {
    expect(getTriggerDisplayModelName(uniqueOpus)).toBe("Opus 4.5");
    expect(getTriggerDisplayModelLabel(uniqueOpus, [uniqueOpus])).toBe("Opus 4.5");
  });

  it("disambiguates colliding display names with subProvider", () => {
    const siblings = [openaiSol, openaiCodexSol];
    expect(getTriggerDisplayModelLabel(openaiCodexSol, siblings)).toBe(
      "GPT-5.6 Sol · openai-codex",
    );
    expect(getTriggerDisplayModelLabel(openaiSol, siblings)).toBe("GPT-5.6 Sol · openai");
  });
});
