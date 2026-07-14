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

/** Hint appended to deterministic-turn failure messages so a usage/credit/
 *  rate-limit failure points the operator at the model override env vars. */
const RATE_LIMIT_HINT =
  "If this is a usage/credit/rate-limit error, set a different KATACODE_E2E_PI_MODEL (or the deterministic-chat model) in .env and re-run.";

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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function modelSlugToPickerPattern(modelSlug: string): RegExp {
  const tokenAssertions = modelSlug
    .split(/[-./_\s]+/u)
    .filter((segment) => segment.length > 0)
    .map((segment) => `(?=.*${escapeRegex(segment)})`)
    .join("");
  return new RegExp(tokenAssertions, "i");
}

function modelSlugToSearchQuery(modelSlug: string): string {
  return modelSlug.replace(/[-./_]+/gu, " ");
}

async function selectVisibleModelOption(page: Page, modelSlug: string): Promise<void> {
  await page.getByPlaceholder("Search models...").fill(modelSlugToSearchQuery(modelSlug));

  const modelOption = page
    .getByRole("option", { name: modelSlugToPickerPattern(modelSlug) })
    .first();
  await modelOption.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  await modelOption.click();
}

async function openComposerModelPicker(page: Page) {
  await dismissBlockingToasts(page);
  await page
    .getByTestId("composer-editor")
    .waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });

  const modelPicker = page.locator('[data-chat-provider-model-picker="true"]');
  await modelPicker.click();

  const modelList = page.locator(".model-picker-list");
  await modelList.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  return modelList;
}

export async function selectComposerModel(page: Page, modelSlug: string): Promise<void> {
  const modelList = await openComposerModelPicker(page);
  await selectVisibleModelOption(page, modelSlug);
  await modelList
    .waitFor({ state: "hidden", timeout: E2E_TIMEOUTS.assertionMs })
    .catch(() => undefined);
}

export async function selectComposerModelForProvider(
  page: Page,
  providerLabel: string,
  modelSlug: string,
): Promise<void> {
  const modelList = await openComposerModelPicker(page);
  await page
    .locator('[data-model-picker-sidebar="true"]')
    .getByRole("button", { name: providerLabel, exact: true })
    .click();
  await selectVisibleModelOption(page, modelSlug);
  await modelList
    .waitFor({ state: "hidden", timeout: E2E_TIMEOUTS.assertionMs })
    .catch(() => undefined);
}

export async function sendAgentInstruction(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId("composer-editor");
  const sendButton = page.getByRole("button", { name: "Send message" });
  const userMessages = page.locator('[data-message-role="user"]');
  const initialMessageCount = await userMessages.count();
  const deadline = Date.now() + E2E_TIMEOUTS.assertionMs;

  await editor.click();
  await editor.fill(text);

  // A newly-created web draft can render before its environment API and active
  // thread are attached. The form handler ignores a submit during that window,
  // so retry only while the draft remains unchanged and no user message exists.
  while (Date.now() < deadline) {
    if ((await userMessages.count()) > initialMessageCount) return;

    const currentDraft = (await editor.innerText()).trim();
    if (currentDraft === text && (await sendButton.isEnabled().catch(() => false))) {
      await sendButton.click();
    }
    await page.waitForTimeout(250);
  }

  throw new Error(
    `Composer did not submit the agent instruction within ${E2E_TIMEOUTS.assertionMs}ms. url=${page.url()} draft=${JSON.stringify((await editor.innerText()).trim())}`,
  );
}

export async function readLatestAssistantMessage(page: Page): Promise<string> {
  const assistantMessages = page.locator('[data-message-role="assistant"] .chat-markdown');
  const count = await assistantMessages.count();
  if (count === 0) {
    return "";
  }
  return (await assistantMessages.nth(count - 1).innerText()).trim();
}

/**
 * Read the thread error banner text, if present. A failed turn (provider out of
 * credits, auth error, rate limit, model unavailable) surfaces here as the real
 * server-side error message. Returns null when no thread error is shown.
 */
export async function readThreadError(page: Page): Promise<string | null> {
  const description = page.locator('[role="alert"] [data-slot="alert-description"]').first();
  if (!(await description.isVisible().catch(() => false))) {
    return null;
  }
  return (await description.innerText()).trim();
}

export async function expectAssistantReply(
  page: Page,
  expected: string,
  metadata: DeterministicAgentTurn,
  timeoutMs = E2E_TIMEOUTS.agentReplyMs,
): Promise<void> {
  const expectedText = normalizeAssistantText(expected);
  const deadline = Date.now() + timeoutMs;

  // Race the reply poll against the thread error banner. A failed turn (out of
  // credits, auth error, rate limit, model unavailable) surfaces in the banner
  // as the real server-side error. Fail fast with that message instead of
  // polling to timeout and reporting an empty capture.
  while (Date.now() < deadline) {
    const threadError = await readThreadError(page);
    if (threadError) {
      throw new Error(
        [
          "Deterministic agent turn failed before replying.",
          `provider=${metadata.provider}`,
          `model=${metadata.model}`,
          `prompt=${metadata.prompt}`,
          `expected=${metadata.expected}`,
          `threadError=${JSON.stringify(threadError)}`,
          RATE_LIMIT_HINT,
        ].join("\n"),
      );
    }

    if (normalizeAssistantText(await readLatestAssistantMessage(page)) === expectedText) {
      return;
    }

    await page.waitForTimeout(500);
  }

  const captured = await readLatestAssistantMessage(page);
  const threadError = await readThreadError(page);
  throw new Error(
    [
      "Deterministic agent assertion failed.",
      `provider=${metadata.provider}`,
      `model=${metadata.model}`,
      `prompt=${metadata.prompt}`,
      `expected=${metadata.expected}`,
      `captured=${JSON.stringify(captured)}`,
      ...(threadError ? [`threadError=${JSON.stringify(threadError)}`] : []),
      RATE_LIMIT_HINT,
    ].join("\n"),
  );
}

/**
 * Poll a value until `satisfies` returns true, but fail fast if the thread
 * error banner appears. A failed turn (out of credits, auth error, rate limit,
 * model unavailable) surfaces in the banner as the real server-side error;
 * waiting out the full reply timeout would just mask it as an empty result.
 */
export async function pollWithThreadErrorGuard<T>(
  page: Page,
  read: () => Promise<T>,
  satisfies: (value: T) => boolean,
  timeoutMessage: string,
  timeoutMs: number = E2E_TIMEOUTS.agentReplyMs,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const threadError = await readThreadError(page);
    if (threadError) {
      throw new Error(
        [
          `${timeoutMessage}: the agent turn failed first.`,
          `threadError=${JSON.stringify(threadError)}`,
          RATE_LIMIT_HINT,
        ].join("\n"),
      );
    }
    if (satisfies(await read())) {
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error([`${timeoutMessage} within ${timeoutMs}ms.`, RATE_LIMIT_HINT].join("\n"));
}

export function normalizeAssistantText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export type RuntimeModeOption = "Supervised" | "Auto-accept edits" | "Full access";

/** Select a runtime mode in the composer (AC 9). The combobox exposes
 *  `Supervised` (approval-required), `Auto-accept edits`, and `Full access`. */
export async function selectRuntimeMode(page: Page, label: RuntimeModeOption): Promise<void> {
  await dismissBlockingToasts(page);
  await page.getByRole("combobox", { name: "Runtime mode" }).click();
  await page.getByRole("option", { name: label, exact: false }).click();
}

/** Click the composer Stop generation button to interrupt an in-flight turn
 *  (AC 5). Resolves once the Send button is visible again. */
export async function interruptAgentTurn(page: Page): Promise<void> {
  const stopButton = page.getByRole("button", { name: "Stop generation" });
  await stopButton.waitFor({ state: "visible", timeout: E2E_TIMEOUTS.assertionMs });
  await stopButton.click();
  await expect(page.getByRole("button", { name: "Send message" })).toBeVisible({
    timeout: E2E_TIMEOUTS.assertionMs,
  });
}

/** Assert a runtime warning with `text` surfaced in the thread timeline (AC 9).
 *  Warnings render as `data-timeline-row-kind="work"` rows whose text includes
 *  the warning message. */
export async function expectTimelineWarning(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () => page.locator('[data-timeline-row-kind="work"]').filter({ hasText: text }).count(),
      { timeout: E2E_TIMEOUTS.agentReplyMs },
    )
    .toBeGreaterThanOrEqual(1);
}

/** Assert a tool-call work row rendered in the timeline (AC 5 tool lifecycle).
 *  Tool calls surface as `data-timeline-row-kind="work"` rows whose group
 *  section carries an `aria-label` of "N tool call(s)". Runtime warnings also
 *  use `work` rows but their group label is "work log", so asserting on the
 *  tool-call label proves an actual tool lifecycle row rendered — not a
 *  warning. */
export async function expectToolCallWorkRow(page: Page): Promise<void> {
  await pollWithThreadErrorGuard(
    page,
    async () =>
      page.locator('[data-timeline-row-kind="work"] section[aria-label*="tool call"]').count(),
    (count) => count >= 1,
    "Tool-call work row did not appear",
  );
}
