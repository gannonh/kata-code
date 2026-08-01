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
  await expect(page.getByTestId(`guided-stage-${stage}`)).toHaveAttribute("data-active", "true", {
    timeout: E2E_TIMEOUTS.agentReplyMs,
  });
}

test.describe(`Task workspaces Guided approved Plan ${E2E_TAGS.taskWorkspaces} ${E2E_TAGS.agent}`, () => {
  test.describe.configure({ timeout: E2E_TIMEOUTS.agentTestMs });

  test("creates through the form, advances conversations, and approves Plan", async ({
    appWindow,
    runContext,
  }) => {
    const turn = assertAgentProviderConfigured("Guided task workspace E2E");
    const workspaceRoot = await seedWorkspace(runContext, "task-workspace-guided-approved-plan");
    await createOrOpenProject(appWindow, workspaceRoot);

    await appWindow.getByRole("link", { name: "New task" }).click();
    await expect(appWindow.getByTestId("task-create-submit")).toBeVisible();
    await expect(appWindow.getByTestId("task-workflow-option-guided")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(appWindow.getByTestId("task-resolved-definition")).toContainText("guided@0.2.0");

    const taskId = "task-e2e-guided-approved-plan";
    await appWindow.getByTestId("task-title-input").fill("Guided approved Plan E2E");
    await appWindow.getByTestId("task-slug-input").fill(taskId);
    await appWindow
      .getByTestId("task-brief-input")
      .fill("Add a deterministic onboarding flow with a readable Plan.");
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

    await expectActiveStage(appWindow, "research");
    await expectActiveStage(appWindow, "design");
    await expectActiveStage(appWindow, "plan");
    await expect(appWindow.getByTestId("guided-plan-gate")).toBeVisible({
      timeout: E2E_TIMEOUTS.agentReplyMs,
    });

    await appWindow.getByTestId("guided-plan-approve").click();
    await expect(appWindow.getByTestId("task-approved-plan-readonly")).toBeVisible({
      timeout: E2E_TIMEOUTS.assertionMs,
    });
    await expect(appWindow.getByText("Plan approved", { exact: true })).toBeVisible();
    await expect(appWindow.getByTestId("guided-stage-build")).toHaveCount(0);
    await expect(appWindow.getByTestId("task-apply-fixture")).toHaveCount(0);
    await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
  });
});
