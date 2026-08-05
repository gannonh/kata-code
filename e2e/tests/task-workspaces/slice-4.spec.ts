import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { assertAgentProviderConfigured, sendAgentInstruction } from "../../src/flows/agentChat.ts";
import { createOrOpenProject, createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

const execFile = promisify(execFileCallback);
const IMPLEMENTATION_READY_TIMEOUT_MS = E2E_TIMEOUTS.agentReplyMs;

async function seedWorkspace(
  runContext: Parameters<typeof createSeededGitWorkspace>[0],
  name: string,
) {
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

async function selectTaskProvider(page: Page, provider: string, model: string): Promise<void> {
  const agentSelect = page.getByTestId("task-agent-select");
  if ((await agentSelect.locator("option").count()) === 0) {
    throw new Error(
      `No provider with task-stage capability is available for Guided E2E '${provider}'. Configure an eligible provider instance and rerun.`,
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
  const modelOption = await modelSelect.locator("option").evaluateAll((options, requestedModel) => {
    const normalized = String(requestedModel).toLowerCase();
    return options
      .find((option) => {
        const value = option.getAttribute("value")?.toLowerCase() ?? "";
        const label = option.textContent?.toLowerCase() ?? "";
        return value === normalized || label.includes(normalized);
      })
      ?.getAttribute("value");
  }, model);
  if (!modelOption) {
    const available = await modelSelect.locator("option").allTextContents();
    throw new Error(
      `Guided E2E model '${model}' is unavailable for '${provider}'. Models: ${available.join(", ") || "none"}.`,
    );
  }
  await modelSelect.selectOption(modelOption);
}

async function expectActiveStage(page: Page, stage: string): Promise<void> {
  const stageItem = page.getByTestId(`guided-stage-${stage}`);
  const approveOnce = page.getByRole("button", { name: "Approve once", exact: true });
  const deadline = Date.now() + E2E_TIMEOUTS.agentReplyMs;

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

async function approveVisibleProviderRequests(page: Page): Promise<void> {
  const approveOnce = page.getByRole("button", { name: "Approve once", exact: true });
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (!(await approveOnce.isVisible().catch(() => false))) return;
    await expect(approveOnce).toBeEnabled();
    await approveOnce.click();
    await page.waitForTimeout(350);
  }
}

async function waitForImplementationCheckpoint(
  page: Page,
  continuedCheckpointIds: ReadonlyArray<string> = [],
): Promise<string | null> {
  const checkpoints = page.locator('[data-testid^="guided-checkpoint-continue-"]');
  const implementationComplete = page.getByTestId("guided-implementation-complete");
  const deadline = Date.now() + IMPLEMENTATION_READY_TIMEOUT_MS;
  let noEligibleSince: number | null = null;
  while (Date.now() < deadline) {
    await approveVisibleProviderRequests(page);
    if (await implementationComplete.isVisible().catch(() => false)) return null;
    const latestAssistant = page.locator('[data-message-role="assistant"] .chat-markdown').last();
    const latestAssistantText = (await latestAssistant.innerText().catch(() => "")).trim();
    const count = await checkpoints.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = checkpoints.nth(index);
      const testId = await candidate.getAttribute("data-testid");
      const checkpointId = testId?.replace("guided-checkpoint-continue-", "") ?? "";
      if (!checkpointId || continuedCheckpointIds.includes(checkpointId)) continue;
      if ((await candidate.getAttribute("title")) === "Checkpoint already continued.") continue;
      if (await candidate.isVisible().catch(() => false)) return checkpointId;
    }
    if (
      /no eligible .*work item|all (?:approved )?phases and work items .*already completed|Build stage completed/iu.test(
        latestAssistantText,
      )
    ) {
      noEligibleSince ??= Date.now();
      if (Date.now() - noEligibleSince >= 30_000) return null;
    } else {
      noEligibleSince = null;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `No eligible implementation checkpoint appeared within ${IMPLEMENTATION_READY_TIMEOUT_MS}ms.`,
  );
}

async function findVisibleImplementationCheckpoint(
  page: Page,
  continuedCheckpointIds: ReadonlyArray<string>,
): Promise<string | null> {
  const checkpoints = page.locator('[data-testid^="guided-checkpoint-continue-"]');
  const count = await checkpoints.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = checkpoints.nth(index);
    const testId = await candidate.getAttribute("data-testid");
    const checkpointId = testId?.replace("guided-checkpoint-continue-", "") ?? "";
    if (!checkpointId || continuedCheckpointIds.includes(checkpointId)) continue;
    if ((await candidate.getAttribute("title")) === "Checkpoint already continued.") continue;
    if (await candidate.isEnabled().catch(() => false)) return checkpointId;
  }
  return null;
}

async function continueImplementationCheckpoint(
  page: Page,
  checkpointId: string,
  continuedCheckpointIds: string[],
): Promise<void> {
  await expect(page.getByTestId(`guided-checkpoint-${checkpointId}`)).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("guided-implementation-panel")).toBeVisible({
    timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
  });
  const continueButton = page.getByTestId(`guided-checkpoint-continue-${checkpointId}`);
  await expect(continueButton).toBeEnabled({ timeout: E2E_TIMEOUTS.assertionMs });
  await continueButton.click();
  await expect(continueButton).toHaveAttribute("title", "Checkpoint already continued.", {
    timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
  });
  continuedCheckpointIds.push(checkpointId);
  await expect(page.getByTestId("task-conversation-starting")).toHaveCount(0, {
    timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
  });
}

async function answerGuidedClarifyQuestions(page: Page): Promise<void> {
  const panel = page.getByTestId("pending-user-input-panel");
  const researchStage = page.getByTestId("guided-stage-research");
  const approveOnce = page.getByRole("button", { name: "Approve once", exact: true });
  const assistantMessages = page.locator('[data-message-role="assistant"] .chat-markdown');
  const clarificationReply =
    "Use a small web onboarding flow with three ordered steps. Persist progress across refreshes and sessions, and store the readable Plan as repository Markdown.";
  const deadline = Date.now() + E2E_TIMEOUTS.agentTestMs;
  let lastConversationalQuestion = "";

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
      const latestText = (await latestAssistant.innerText().catch(() => "")).trim();
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

  throw new Error("Guided Clarify questions did not settle within the E2E timeout.");
}

test.describe(`Task workspaces Guided approved Plan ${E2E_TAGS.taskWorkspaces} ${E2E_TAGS.agent}`, () => {
  test.describe.configure({ timeout: E2E_TIMEOUTS.agentTestMs });

  test("creates through the form, approves Plan, and enters Implement", async ({
    authenticatedAppWindow,
    runContext,
  }) => {
    const appWindow = authenticatedAppWindow;
    const turn = assertAgentProviderConfigured("Guided task workspace E2E");
    const workspaceRoot = await seedWorkspace(runContext, "task-workspace-guided-approved-plan");
    await createOrOpenProject(appWindow, workspaceRoot);

    await appWindow.getByRole("link", { name: "New task" }).click();
    await expect(appWindow.getByTestId("task-create-submit")).toBeVisible();
    await expect(appWindow.getByTestId("task-workflow-option-guided")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(appWindow.getByTestId("task-resolved-definition")).toContainText("guided@0.3.0");

    const taskId = "task-e2e-guided-approved-plan";
    await appWindow.getByTestId("task-title-input").fill("Guided approved Plan E2E");
    await appWindow.getByTestId("task-slug-input").fill(taskId);
    await appWindow
      .getByTestId("task-brief-input")
      .fill(
        "Add a deterministic onboarding flow with a readable Plan. Implement `src/onboarding.js` exporting `getOnboardingSteps()` that returns exactly three objects with string IDs `welcome`, `profile`, and `complete`, plus readable labels. Add `test/onboarding.test.js` that imports the implementation and asserts `getOnboardingSteps().map((step) => step.id)` equals `['welcome', 'profile', 'complete']`; do not compare step objects directly to strings, and run the test until it passes. The Guided 0.3 Plan must use exact headings `## Phase [phase:id] Title` and `### Work item [work:id] Title`. Immediately after every Phase heading and before its first Work item, put the literal line `Checkpoint: always`, never `Checkpoint policy:`. Include exactly two phases with exactly one work item in each phase, and one automated check using an exact bullet such as `- Automated check [check:typecheck]: Typecheck | node --test test/onboarding.test.js`; do not describe the automated check in prose instead of that bullet. Use the always checkpoint as the human review checkpoint; no manual check is required.",
      );
    await appWindow.getByTestId("task-base-ref-input").fill("main");
    await appWindow.getByTestId("task-worktree-option-later").click();
    await selectTaskProvider(appWindow, turn.provider, turn.model);
    await appWindow.getByTestId("task-create-submit").click();

    await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
    await expect(appWindow.getByTestId("guided-task-panel")).toBeVisible();
    await expect(appWindow.getByTestId("guided-stage-questions")).toBeVisible();
    await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });

    // Guided v0.3 is conversation-first. Manual artifact editors, session
    // linking, and context-manifest inspection are absent from this surface.
    await expect(appWindow.getByTestId("task-questions-editor")).toHaveCount(0);
    await expect(appWindow.getByTestId("task-save-questions")).toHaveCount(0);
    await expect(appWindow.getByTestId("task-context-manifests-panel")).toHaveCount(0);
    await expect(appWindow.getByTestId("task-sessions-panel")).toHaveCount(0);

    await answerGuidedClarifyQuestions(appWindow);
    await expectActiveStage(appWindow, "research");
    await expectActiveStage(appWindow, "design");
    await expectActiveStage(appWindow, "plan");
    await expect(appWindow.getByTestId("guided-plan-gate")).toBeVisible({
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });

    await appWindow.getByTestId("guided-plan-approve").click();
    await expect(appWindow.getByTestId("guided-stage-build")).toBeVisible({
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });
    await expect(appWindow.getByTestId("guided-implementation-panel")).toBeVisible({
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });
    await expect(appWindow.getByTestId("guided-build-plan-link")).toContainText(
      "Approved Plan revision",
    );
    await expect(appWindow.getByTestId("guided-stage-build")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(appWindow.getByTestId("task-apply-fixture")).toHaveCount(0);
    await expect(appWindow.getByTestId("task-conversation-starting")).toHaveCount(0, {
      timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
    });
    await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
      timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
    });
    await approveVisibleProviderRequests(appWindow);
    await sendAgentInstruction(
      appWindow,
      "Continue the Implement stage. First mark the current eligible phase and work item running with task_implementation_progress, implement it, use task_implementation_check_run for every approved automated check, then mark the work item completed and stop at the next checkpoint.",
      IMPLEMENTATION_READY_TIMEOUT_MS,
      { approveOnce: true },
    );
    const continuedCheckpointIds: string[] = [];
    let nextCheckpointId = await waitForImplementationCheckpoint(appWindow);
    if (nextCheckpointId === null) {
      throw new Error("Implement completed before its required checkpoint.");
    }
    for (let checkpointCount = 0; nextCheckpointId !== null; checkpointCount += 1) {
      if (checkpointCount >= 6) {
        throw new Error("Implement exceeded the bounded checkpoint continuation budget.");
      }
      await continueImplementationCheckpoint(appWindow, nextCheckpointId, continuedCheckpointIds);
      if (
        await appWindow
          .getByTestId("guided-implementation-complete")
          .isVisible()
          .catch(() => false)
      ) {
        break;
      }
      await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
        timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
      });
      await approveVisibleProviderRequests(appWindow);
      await sendAgentInstruction(
        appWindow,
        "Continue the Implement stage. First mark the current eligible phase and work item running with task_implementation_progress, implement it, use task_implementation_check_run for every approved automated check, then mark the work item completed and stop at the next checkpoint.",
        IMPLEMENTATION_READY_TIMEOUT_MS,
        { approveOnce: true },
      );
      nextCheckpointId = await waitForImplementationCheckpoint(appWindow, continuedCheckpointIds);
    }
    const implementationComplete = appWindow.getByTestId("guided-implementation-complete");
    const continuePrompt =
      "Continue the Implement stage. First mark the current eligible phase and work item running with task_implementation_progress, implement it, use task_implementation_check_run for every approved automated check, then mark the work item completed and stop at the next checkpoint.";
    const finishPrompt =
      "Finish the Implement stage now. Verify every work item and approved check, commit the implementation changes on the canonical task branch so the worktree is clean, then call task_implementation_complete with the required session, provider turn, exact resulting HEAD, and a concise summary. Do not only report completion and do not call task_stage_complete.";
    const hasCompletionSubmission = async (): Promise<boolean> => {
      const assistantMessages = appWindow.locator('[data-message-role="assistant"] .chat-markdown');
      const text = (await assistantMessages.allInnerTexts()).join("\n");
      return /(?:task_implementation_complete|implementation completion|completion proposal|completion submitted successfully|recorded session and provider-turn metadata|exact HEAD)/iu.test(
        text,
      );
    };
    const waitForCompletionOrCheckpoint = async (): Promise<
      "complete" | "checkpoint" | "timeout"
    > => {
      const deadline = Date.now() + IMPLEMENTATION_READY_TIMEOUT_MS;
      while (Date.now() < deadline) {
        await approveVisibleProviderRequests(appWindow);
        if (await implementationComplete.isVisible().catch(() => false)) return "complete";
        const lateCheckpointId = await findVisibleImplementationCheckpoint(
          appWindow,
          continuedCheckpointIds,
        );
        if (lateCheckpointId !== null) {
          await continueImplementationCheckpoint(
            appWindow,
            lateCheckpointId,
            continuedCheckpointIds,
          );
          await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
            timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
          });
          await approveVisibleProviderRequests(appWindow);
          await sendAgentInstruction(appWindow, continuePrompt, IMPLEMENTATION_READY_TIMEOUT_MS, {
            approveOnce: true,
          });
          return "checkpoint";
        }
        await appWindow.waitForTimeout(500);
      }
      return "timeout";
    };

    for (let completionAttempt = 0; completionAttempt < 4; completionAttempt += 1) {
      if (await implementationComplete.isVisible().catch(() => false)) break;
      const pendingCheckpointId = await findVisibleImplementationCheckpoint(
        appWindow,
        continuedCheckpointIds,
      );
      if (pendingCheckpointId !== null) {
        await continueImplementationCheckpoint(
          appWindow,
          pendingCheckpointId,
          continuedCheckpointIds,
        );
        await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
          timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
        });
        await approveVisibleProviderRequests(appWindow);
        await sendAgentInstruction(appWindow, continuePrompt, IMPLEMENTATION_READY_TIMEOUT_MS, {
          approveOnce: true,
        });
        continue;
      }
      if (!(await hasCompletionSubmission())) {
        await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
          timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
        });
        await approveVisibleProviderRequests(appWindow);
        await sendAgentInstruction(appWindow, finishPrompt, IMPLEMENTATION_READY_TIMEOUT_MS, {
          approveOnce: true,
        });
      }
      const outcome = await waitForCompletionOrCheckpoint();
      if (outcome === "complete") break;
      if (outcome === "timeout") break;
    }
    await expect(implementationComplete).toBeVisible({
      timeout: IMPLEMENTATION_READY_TIMEOUT_MS,
    });
    await expect(appWindow.getByTestId("guided-resulting-commit")).toHaveText(/^[0-9a-f]{40}$/u);
    await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
  });
});
