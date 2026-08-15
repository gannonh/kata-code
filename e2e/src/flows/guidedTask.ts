import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { expect, type Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../config/timeouts.ts";
import { createOrOpenProject, createSeededGitWorkspace } from "./workspace.ts";

const execFile = promisify(execFileCallback);

/**
 * Deterministic Guided brief used by provider-parity acceptance runs. The
 * approved Plan must contain exactly one phase with `Checkpoint: always`, one
 * work item, and one automated check (`node --test test/onboarding.test.js`),
 * so every provider proves the same implement contract: progress, check run
 * through the Task CLI, a clean commit, and completed Implement.
 */
export const GUIDED_PARITY_BRIEF =
  "Requirements are complete; do not ask clarifying questions. Add `src/onboarding.js` exporting `getOnboardingSteps()` with exactly the ordered string IDs `welcome`, `profile`, and `complete`, plus readable labels. Add `test/onboarding.test.js` asserting those IDs and run it until it passes. The Guided 0.3 Plan must contain exactly one `## Phase [phase:id] Title`, followed immediately by the literal line `Checkpoint: always`, exactly one `### Work item [work:id] Title`, and exactly one automated check bullet `- Automated check [check:typecheck]: Typecheck | node --test test/onboarding.test.js`. No manual check is required.";

export async function seedGuidedWorkspace(
  runContext: Parameters<typeof createSeededGitWorkspace>[0],
  name: string,
): Promise<string> {
  const workspaceRoot = await createSeededGitWorkspace(runContext, {
    name,
    remoteUrl: "https://example.test/gannonh/task-workspace-e2e.git",
    files: { "README.md": "# Task workspace Guided E2E\n" },
  });
  await execFile("git", ["config", "user.name", "Kata E2E"], { cwd: workspaceRoot });
  await execFile("git", ["config", "user.email", "kata-e2e@example.test"], {
    cwd: workspaceRoot,
  });
  await execFile("git", ["add", "."], { cwd: workspaceRoot });
  await execFile("git", ["commit", "-m", "test: seed guided task workspace"], {
    cwd: workspaceRoot,
  });
  await execFile("git", ["branch", "-M", "main"], { cwd: workspaceRoot });
  return workspaceRoot;
}

export async function selectTaskProvider(
  page: Page,
  provider: string,
  model: string | ReadonlyArray<string>,
): Promise<void> {
  const modelCandidates = typeof model === "string" ? [model] : model;
  const agentSelect = page.getByTestId("task-agent-select");
  if ((await agentSelect.locator("option").count()) === 0) {
    throw new Error(
      `No eligible provider is available for Guided E2E '${provider}'. Configure an enabled provider instance and rerun.`,
    );
  }
  await expect(agentSelect).toBeEnabled();
  const providerOption = await agentSelect
    .locator("option")
    .evaluateAll((options, requestedProvider) => {
      const normalized = String(requestedProvider).toLowerCase();
      return options
        .find((option) => {
          const value = option.getAttribute("value")?.toLowerCase() ?? "";
          const label = option.textContent?.toLowerCase() ?? "";
          return value === normalized || value.includes(normalized) || label.includes(normalized);
        })
        ?.getAttribute("value");
    }, provider);
  if (!providerOption) {
    const available = await agentSelect.locator("option").allTextContents();
    throw new Error(
      `Guided E2E provider '${provider}' is unavailable. Configured agents: ${available.join(", ") || "none"}.`,
    );
  }
  await agentSelect.selectOption(providerOption);

  const modelSelect = page.getByTestId("task-model-select");
  await expect(modelSelect).toBeEnabled();
  // Catalog labels and env values differ in punctuation and casing
  // ("Claude Haiku 4.5" vs "haiku-4.5"); compare alphanumeric-only folds.
  // Candidates are tried in priority order so fallback chains select the
  // first model the instance actually offers.
  const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wantedFolds = modelCandidates.map(fold);
  const modelOption = await modelSelect.locator("option").evaluateAll((options, wanted) => {
    return (
      options
        .find((option) => {
          const value = option.getAttribute("value")?.toLowerCase() ?? "";
          const label = option.textContent?.toLowerCase() ?? "";
          const foldValue = value.replace(/[^a-z0-9]/g, "");
          const foldLabel = label.replace(/[^a-z0-9]/g, "");
          return wanted.some(
            (candidate) =>
              foldValue === candidate ||
              foldValue.includes(candidate) ||
              foldLabel.includes(candidate),
          );
        })
        ?.getAttribute("value") ?? null
    );
  }, wantedFolds);
  if (!modelOption) {
    const available = await modelSelect.locator("option").allTextContents();
    throw new Error(
      `Guided E2E model '${modelCandidates.join("', '")}' is unavailable for '${provider}'. Models: ${available.join(", ") || "none"}.`,
    );
  }
  await modelSelect.selectOption(modelOption);
}

/**
 * Task-owned stage conversations are internal to the Task route. None of the
 * task's threads may surface as a peer row in the Chats sidebar.
 */
export async function expectNoTaskThreadsInChatSidebar(page: Page): Promise<void> {
  // Anchor on a rendered sidebar; an empty page would satisfy the count check.
  const chatList = page.getByTestId("sidebar-thread-list");
  await expect(chatList).toBeVisible();
  // The Chats list is live: it renders the empty state, or real chat rows.
  // Task-owned conversations must never be among the rows either way. The
  // filtering itself is asserted non-vacuously in the browser suite, where
  // chats are seeded beside the task.
  await expect(
    chatList
      .locator('[data-testid^="thread-row-"]:not([data-testid^="thread-row-thread-task-"])')
      .or(chatList.getByText("No threads yet"))
      .first(),
  ).toBeVisible();
  // Task stage threads are created by the server as `thread-task-<uuid>`.
  const taskThreadRows = chatList.locator('[data-testid^="thread-row-thread-task-"]');
  await expect(taskThreadRows).toHaveCount(0);
}

export async function expectActiveStage(
  page: Page,
  stage: string,
  deadlineMs: number = Math.max(E2E_TIMEOUTS.agentReplyMs, 180_000),
): Promise<void> {
  const stageItem = page.getByTestId(`guided-stage-${stage}`);
  const approveOnce = page.getByRole("button", { name: "Approve once", exact: true });
  const deadline = Date.now() + deadlineMs;

  while (Date.now() < deadline) {
    if ((await stageItem.getAttribute("data-active")) === "true") {
      return;
    }
    if (await approveOnce.isVisible().catch(() => false)) {
      await expect(approveOnce).toBeEnabled();
      await approveOnce.click();
      await page.waitForTimeout(350);
      continue;
    }
    await page.waitForTimeout(500);
  }

  await expect(stageItem).toHaveAttribute("data-active", "true", {
    timeout: E2E_TIMEOUTS.assertionMs,
  });
}

export async function answerGuidedClarifyQuestions(page: Page): Promise<void> {
  const panel = page.getByTestId("pending-user-input-panel");
  const researchStage = page.getByTestId("guided-stage-research");
  const approveOnce = page.getByRole("button", { name: "Approve once", exact: true });
  const assistantMessages = page.locator('[data-message-role="assistant"] .chat-markdown');
  const clarificationReply =
    "Use a small web onboarding flow with three ordered steps. Persist progress across refreshes and sessions, and store the readable Plan as repository Markdown.";
  const deadline = Date.now() + E2E_TIMEOUTS.guidedAgentTestMs;
  let lastConversationalQuestion = "";
  let lastAssistantText = "";

  while (Date.now() < deadline) {
    if ((await researchStage.getAttribute("data-active")) === "true") {
      return;
    }
    if (await approveOnce.isVisible().catch(() => false)) {
      await expect(approveOnce).toBeEnabled();
      await approveOnce.click();
      await page.waitForTimeout(350);
      continue;
    }
    if (!(await panel.isVisible().catch(() => false))) {
      const latestAssistant = assistantMessages.last();
      const latestText = (await latestAssistant.innerText({ timeout: 500 }).catch(() => "")).trim();
      if (latestText.length > 0) lastAssistantText = latestText;
      const sendButton = page.getByRole("button", { name: "Send message", exact: true });
      if (
        latestText.length > 0 &&
        latestText !== lastConversationalQuestion &&
        latestText.includes("?")
      ) {
        // The send button is disabled while the editor is empty. Fill first,
        // then let the next poll submit once the provider turn is ready.
        await page.getByTestId("composer-editor").fill(clarificationReply);
        if (await sendButton.isEnabled().catch(() => false)) {
          await sendButton.click();
          lastConversationalQuestion = latestText;
          await page.waitForTimeout(350);
          continue;
        }
      }
      await page.waitForTimeout(500);
      continue;
    }

    const options = panel.getByTestId("pending-user-input-option");
    const isMultiSelect =
      (await panel.getByText("Select one or more options.", { exact: true }).count()) > 0;
    const respondingOptions = panel.locator(
      '[data-testid="pending-user-input-option"][aria-disabled="true"]',
    );
    if ((await respondingOptions.count()) > 0) {
      await page.waitForTimeout(350);
      continue;
    }

    const unselectedOptions = panel.locator(
      '[data-testid="pending-user-input-option"][aria-pressed="false"]',
    );
    if ((await unselectedOptions.count()) > 0) {
      await unselectedOptions.first().click();
      // Single-select questions schedule their own advance. Submitting here
      // would race that timer and can skip the next question.
      if (!isMultiSelect) {
        await page.waitForTimeout(350);
        continue;
      }
    } else if ((await options.count()) === 0) {
      await page.getByTestId("composer-editor").fill("Use the simplest maintainable approach.");
    } else if (!isMultiSelect) {
      await page.waitForTimeout(350);
      continue;
    }

    const advance = page.getByRole("button", {
      name: /^(Next|Next question|Submit|Submit answer|Submit answers)$/,
    });
    if (
      (await advance.count()) > 0 &&
      (await advance
        .first()
        .isEnabled()
        .catch(() => false))
    ) {
      await advance.first().click();
    }
    await page.waitForTimeout(350);
  }

  const visibleMessages = (await assistantMessages.allTextContents().catch(() => []))
    .map((text) => text.trim())
    .filter((text) => text.length > 0);
  throw new Error(
    `Guided Clarify questions did not settle within the E2E timeout. Last assistant message: ${JSON.stringify(lastAssistantText.slice(0, 800))}. Visible assistant messages: ${JSON.stringify(visibleMessages.slice(-6).map((text) => text.slice(0, 300)))}.`,
  );
}

export { createOrOpenProject };
