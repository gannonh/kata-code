import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import type { Page } from "@playwright/test";

import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { assertAgentProviderConfigured } from "../../src/flows/agentChat.ts";
import { createOrOpenProject, createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

const execFile = promisify(execFileCallback);

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

/**
 * Task-owned stage conversations are internal to the Task route. None of the
 * task's threads may surface as a peer row in the Chats sidebar.
 */
async function expectNoTaskThreadsInChatSidebar(page: Page): Promise<void> {
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

async function expectActiveStage(page: Page, stage: string): Promise<void> {
  const stageItem = page.getByTestId(`guided-stage-${stage}`);
  const approveOnce = page.getByRole("button", { name: "Approve once", exact: true });
  const deadline = Date.now() + Math.max(E2E_TIMEOUTS.agentReplyMs, 180_000);

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

async function answerGuidedClarifyQuestions(page: Page): Promise<void> {
  const panel = page.getByTestId("pending-user-input-panel");
  const researchStage = page.getByTestId("guided-stage-research");
  const approveOnce = page.getByRole("button", { name: "Approve once", exact: true });
  const assistantMessages = page.locator('[data-message-role="assistant"] .chat-markdown');
  const clarificationReply =
    "Use a small web onboarding flow with three ordered steps. Persist progress across refreshes and sessions, and store the readable Plan as repository Markdown.";
  const deadline = Date.now() + E2E_TIMEOUTS.guidedAgentTestMs;
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
  test.describe.configure({ timeout: E2E_TIMEOUTS.guidedAgentTestMs });

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

    // Permissions default to Full access and warn that planning runs in the
    // working checkout while worktree timing is Later.
    await expect(appWindow.getByTestId("task-permissions-picker")).toBeVisible();
    await expect(appWindow.getByTestId("task-permissions-option-full-access")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(appWindow.getByTestId("task-permissions-checkout-warning")).toBeVisible();
    // A non-default permission can be selected before the task is created.
    await appWindow.getByTestId("task-permissions-option-approval-required").click();
    await expect(
      appWindow.getByTestId("task-permissions-option-approval-required"),
    ).toHaveAttribute("data-active", "true");

    const taskId = "task-e2e-guided-approved-plan";
    await appWindow.getByTestId("task-title-input").fill("Guided approved Plan E2E");
    await appWindow.getByTestId("task-slug-input").fill(taskId);
    await appWindow
      .getByTestId("task-brief-input")
      .fill(
        "Requirements are complete; do not ask clarifying questions. Add `src/onboarding.js` exporting `getOnboardingSteps()` with exactly the ordered string IDs `welcome`, `profile`, and `complete`, plus readable labels. Add `test/onboarding.test.js` asserting those IDs and run it until it passes. The Guided 0.3 Plan must contain exactly one `## Phase [phase:id] Title`, followed immediately by the literal line `Checkpoint: always`, exactly one `### Work item [work:id] Title`, and exactly one automated check bullet `- Automated check [check:typecheck]: Typecheck | node --test test/onboarding.test.js`. No manual check is required.",
      );
    await appWindow.getByTestId("task-base-ref-input").fill("main");
    await appWindow.getByTestId("task-worktree-option-later").click();
    await selectTaskProvider(appWindow, turn.provider, turn.model);
    await appWindow.getByTestId("task-create-submit").click();

    await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
    await expect(appWindow.getByTestId("guided-task-panel")).toBeVisible();
    // The panel exposes the current permission and lets it be changed.
    await expect(appWindow.getByTestId("guided-task-permissions")).toBeVisible();
    await expect(
      appWindow.getByTestId("task-panel-permissions-option-approval-required"),
    ).toHaveAttribute("data-active", "true");
    // Permission changes apply to the open conversation without creating a
    // new stage occurrence. Rejection recovery is covered by the browser
    // component test because a real E2E run must not mock a transport failure.
    await appWindow.getByTestId("task-panel-permissions-option-auto-accept-edits").click();
    await expect(
      appWindow.getByTestId("task-panel-permissions-option-auto-accept-edits"),
    ).toHaveAttribute("data-active", "true");
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

    // The Task is the navigation unit: its stage conversations stay inside the
    // Task route and never appear as peer Chat rows.
    await expectNoTaskThreadsInChatSidebar(appWindow);

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
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });
    await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });
    await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
    await expectNoTaskThreadsInChatSidebar(appWindow);

    // Completed stages are inspectable history, and the route never changes.
    await appWindow.getByTestId("guided-stage-plan").click();
    await expect(appWindow.getByTestId("task-stage-historical-banner")).toBeVisible();
    await expect(appWindow.getByTestId("task-stage-subtitle")).toContainText("read-only history");
    await expect(appWindow.getByTestId("task-stage-outcome-view")).toBeVisible();
    await expect(appWindow.getByTestId("guided-stage-build")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));

    await appWindow.getByTestId("task-stage-return-to-current").click();
    await expect(appWindow.getByTestId("task-stage-subtitle")).toContainText("current stage");
    await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });
  });
});
