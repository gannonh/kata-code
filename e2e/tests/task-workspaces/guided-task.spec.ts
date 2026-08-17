import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { assertGuidedProviderCredentials, GUIDED_PROVIDERS } from "../../src/config/providers.ts";
import {
  answerGuidedClarifyQuestions,
  createOrOpenProject,
  expectActiveStage,
  expectCompletedGuidedImplement,
  expectNoTaskThreadsInChatSidebar,
  GUIDED_PARITY_BRIEF,
  seedGuidedWorkspace,
  selectTaskProvider,
} from "../../src/flows/guidedTask.ts";
import { configureDefaultPiProvider, stagePiAgentDirectory } from "../../src/flows/piProvider.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

test.describe(`${E2E_TAGS.taskWorkspaces} ${E2E_TAGS.agent}`, () => {
  test.describe.configure({ timeout: 45 * 60_000 });

  for (const provider of GUIDED_PROVIDERS) {
    test(`guided task > ${provider.id} ${provider.tag}`, async ({
      authenticatedAppWindow,
      runContext,
    }) => {
      const appWindow = authenticatedAppWindow;
      await assertGuidedProviderCredentials(provider);

      if (provider.id === "pi") {
        const agentDir = await stagePiAgentDirectory(
          runContext,
          provider.agentDir!,
          provider.model,
        );
        await configureDefaultPiProvider(appWindow, {
          agentDir,
          model: provider.model,
          modelFallbacks: provider.models.slice(1),
        });
      }

      const workspaceRoot = await seedGuidedWorkspace(
        runContext,
        `task-workspace-guided-${provider.id}`,
      );
      await createOrOpenProject(appWindow, workspaceRoot);

      await appWindow.getByRole("link", { name: "New task" }).click();
      await expect(appWindow.getByTestId("task-create-submit")).toBeVisible();
      await expect(appWindow.getByTestId("task-workflow-option-guided")).toHaveAttribute(
        "data-active",
        "true",
      );
      await expect(appWindow.getByTestId("task-resolved-definition")).toContainText("guided@0.3.0");

      await expect(appWindow.getByTestId("task-permissions-picker")).toBeVisible();
      await expect(appWindow.getByTestId("task-permissions-option-full-access")).toHaveAttribute(
        "data-active",
        "true",
      );
      await expect(appWindow.getByTestId("task-permissions-checkout-warning")).toBeVisible();
      await appWindow.getByTestId("task-permissions-option-approval-required").click();
      await expect(
        appWindow.getByTestId("task-permissions-option-approval-required"),
      ).toHaveAttribute("data-active", "true");
      await appWindow.getByTestId("task-permissions-option-auto-accept-edits").click();
      await expect(
        appWindow.getByTestId("task-permissions-option-auto-accept-edits"),
      ).toHaveAttribute("data-active", "true");

      const taskId = `task-e2e-guided-${provider.id}`;
      await appWindow.getByTestId("task-title-input").fill(`Guided ${provider.id} E2E`);
      await appWindow.getByTestId("task-slug-input").fill(taskId);
      await appWindow.getByTestId("task-brief-input").fill(GUIDED_PARITY_BRIEF);
      await appWindow.getByTestId("task-base-ref-input").fill("main");
      await appWindow.getByTestId("task-worktree-option-later").click();
      await selectTaskProvider(appWindow, provider.id, provider.models);
      await appWindow.getByTestId("task-create-submit").click();

      await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
      await expect(appWindow.getByTestId("guided-task-panel")).toBeVisible();
      await expect(appWindow.getByTestId("guided-task-permissions")).toBeVisible();
      await expect(
        appWindow.getByTestId("task-panel-permissions-option-auto-accept-edits"),
      ).toHaveAttribute("data-active", "true");
      await expect(appWindow.getByTestId("guided-stage-questions")).toBeVisible();
      await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
        timeout: E2E_TIMEOUTS.agentReplyMs,
      });

      await expect(appWindow.getByTestId("task-questions-editor")).toHaveCount(0);
      await expect(appWindow.getByTestId("task-save-questions")).toHaveCount(0);
      await expect(appWindow.getByTestId("task-context-manifests-panel")).toHaveCount(0);
      await expect(appWindow.getByTestId("task-sessions-panel")).toHaveCount(0);
      await expectNoTaskThreadsInChatSidebar(appWindow);

      const stageDeadlineMs = provider.stageDeadlineMs;
      await answerGuidedClarifyQuestions(appWindow, { deadlineMs: stageDeadlineMs });
      await expectActiveStage(appWindow, "research", stageDeadlineMs);
      await expectActiveStage(appWindow, "design", stageDeadlineMs);
      await expectActiveStage(appWindow, "plan", stageDeadlineMs);
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

      await expectCompletedGuidedImplement(appWindow);

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
  }
});
