import { expect, type Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import {
  formatMissingPrerequisiteError,
  readAgentProviderConfig,
  readAgentProviderPrerequisites,
} from "../harness/env.ts";
import { dismissBlockingToasts } from "./navigation.ts";

export interface DeterministicAgentTurn {
  readonly provider: string;
  readonly model: string;
  readonly prompt: string;
  readonly expected: string;
}

export function assertAgentProviderConfigured(phase: string): {
  readonly provider: string;
  readonly model: string;
} {
  const prerequisites = readAgentProviderPrerequisites();
  if (!prerequisites.ok) {
    throw new Error(formatMissingPrerequisiteError(phase, prerequisites.missing));
  }

  return readAgentProviderConfig();
}

export function buildDeterministicAgentTurn(
  provider: string,
  model: string,
): DeterministicAgentTurn {
  const runId = crypto.randomUUID().slice(0, 8);
  const expected = `E2E_AGENT_OK_${runId}`;
  const prompt = `Reply to this message with exactly: ${expected}`;

  return { provider, model, prompt, expected };
}

export function assertAgentPrerequisites(phase: string): DeterministicAgentTurn {
  const { provider, model } = assertAgentProviderConfigured(phase);
  return buildDeterministicAgentTurn(provider, model);
}

function modelSlugToPickerPattern(modelSlug: string): RegExp {
  const pattern = modelSlug
    .split("-")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[-.\\s]");
  return new RegExp(pattern, "i");
}

function modelSlugToSearchQuery(modelSlug: string): string {
  return modelSlug.replace(/-/g, " ");
}

export async function selectComposerModel(page: Page, modelSlug: string): Promise<void> {
  await dismissBlockingToasts(page);
  await page
    .getByTestId("composer-editor")
    .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });

  const modelPicker = page.locator('[data-chat-provider-model-picker="true"]');
  await modelPicker.click();

  const modelList = page.locator(".model-picker-list");
  await modelList.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });

  await page.getByPlaceholder("Search models...").fill(modelSlugToSearchQuery(modelSlug));

  const modelOption = page
    .getByRole("option", { name: modelSlugToPickerPattern(modelSlug) })
    .first();
  await modelOption.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  await modelOption.click();

  await modelList
    .waitFor({ state: "hidden", timeout: E2E_TIMEOUTS.assertionMs })
    .catch(() => undefined);
}

export async function sendAgentInstruction(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId("composer-editor");
  await editor.click();
  await editor.fill(text);
  await page.getByRole("button", { name: "Send message" }).click();
}

export async function readLatestAssistantMessage(page: Page): Promise<string> {
  const assistantMessages = page.locator('[data-message-role="assistant"] .chat-markdown');
  const count = await assistantMessages.count();
  if (count === 0) {
    return "";
  }
  return (await assistantMessages.nth(count - 1).innerText()).trim();
}

export async function expectAssistantReply(
  page: Page,
  expected: string,
  metadata: DeterministicAgentTurn,
  timeoutMs = E2E_TIMEOUTS.agentReplyMs,
): Promise<void> {
  try {
    await expect
      .poll(async () => normalizeAssistantText(await readLatestAssistantMessage(page)), {
        timeout: timeoutMs,
      })
      .toBe(normalizeAssistantText(expected));
  } catch (error) {
    const captured = await readLatestAssistantMessage(page);
    throw new Error(
      [
        "Deterministic agent assertion failed.",
        `provider=${metadata.provider}`,
        `model=${metadata.model}`,
        `prompt=${metadata.prompt}`,
        `expected=${metadata.expected}`,
        `captured=${JSON.stringify(captured)}`,
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
      { cause: error },
    );
  }
}

export function normalizeAssistantText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
