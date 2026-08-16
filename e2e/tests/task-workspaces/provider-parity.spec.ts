import { E2E_TIMEOUTS } from "../../src/config/timeouts.ts";
import { E2E_TAGS } from "../../src/config/tags.ts";
import {
  answerGuidedClarifyQuestions,
  createOrOpenProject,
  expectActiveStage,
  expectNoTaskThreadsInChatSidebar,
  GUIDED_PARITY_BRIEF,
  seedGuidedWorkspace,
  selectTaskProvider,
} from "../../src/flows/guidedTask.ts";
import {
  configureDefaultPiProvider,
  readPiSmokeConfig,
  stagePiAgentDirectory,
} from "../../src/flows/piProvider.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

const piSmoke = readPiSmokeConfig();
const claudeModel = process.env.KATACODE_E2E_CLAUDE_MODEL?.trim();

type ParityCase =
  | { readonly name: "Pi"; readonly provider: "pi"; readonly models: ReadonlyArray<string> }
  | { readonly name: "Claude"; readonly provider: "claude"; readonly model: string };

const parityCases: ReadonlyArray<ParityCase> = [
  ...(piSmoke.ok
    ? [
        {
          name: "Pi" as const,
          provider: "pi" as const,
          models: [piSmoke.config.model, ...piSmoke.config.modelFallbacks],
        },
      ]
    : []),
  ...(claudeModel
    ? [{ name: "Claude" as const, provider: "claude" as const, model: claudeModel }]
    : []),
];

function skipReason(candidate: ParityCase): string | undefined {
  if (candidate.provider === "pi" && !piSmoke.ok) {
    return `Pi provider E2E is not configured (${piSmoke.ok ? "" : "KATACODE_E2E_ENABLE_PI"})`;
  }
  if (candidate.provider === "claude" && claudeModel === undefined) {
    return "Claude provider E2E is not configured (KATACODE_E2E_CLAUDE_MODEL)";
  }
  return undefined;
}

/**
 * Issue #96 AC9: equivalent authenticated desktop flows for Codex, Claude,
 * and Pi. Codex is proven by slice-4.spec.ts; this spec proves the same
 * deterministic approved Plan, CLI check run, clean commit, and completed
 * Implement for Pi and Claude. Claude authenticates through the staged host
 * OAuth state (`~/.claude.json`, see harness isolatedRun staging); Pi through
 * its staged agent directory.
 */
test.describe(`Task workspaces provider parity ${E2E_TAGS.taskWorkspaces} ${E2E_TAGS.agent}`, () => {
  // Full guided flow through Implement completion: the agent implements a
  // small deterministic deliverable, runs the approved check through the Task
  // CLI, commits, and proposes completion. Budget generously for real agents;
  // Claude's staged-OAuth turns are an order of magnitude slower than Codex.
  test.describe.configure({ timeout: 45 * 60_000 });

  for (const candidate of parityCases) {
    test(`reaches completed Implement with ${candidate.name}`, async ({
      authenticatedAppWindow,
      runContext,
    }) => {
      const reason = skipReason(candidate);
      test.skip(reason !== undefined, reason ?? "");

      const appWindow = authenticatedAppWindow;

      if (candidate.provider === "pi") {
        // Pi's default instance needs the staged agent directory and the
        // registered custom model before the task form offers the provider.
        const primary = candidate.models[0]!;
        const agentDir = await stagePiAgentDirectory(
          runContext,
          piSmoke.ok ? piSmoke.config.agentDir : "",
          primary,
        );
        await configureDefaultPiProvider(appWindow, { agentDir, model: primary });
      }

      const workspaceRoot = await seedGuidedWorkspace(
        runContext,
        `task-workspace-parity-${candidate.name.toLowerCase()}`,
      );
      await createOrOpenProject(appWindow, workspaceRoot);

      await appWindow.getByRole("link", { name: "New task" }).click();
      await expect(appWindow.getByTestId("task-create-submit")).toBeVisible();

      const taskId = `task-e2e-parity-${candidate.name.toLowerCase()}`;
      await appWindow.getByTestId("task-title-input").fill(`Guided ${candidate.name} parity E2E`);
      await appWindow.getByTestId("task-slug-input").fill(taskId);
      await appWindow.getByTestId("task-brief-input").fill(GUIDED_PARITY_BRIEF);
      await appWindow.getByTestId("task-base-ref-input").fill("main");
      await appWindow.getByTestId("task-worktree-option-later").click();
      // Provider parity is non-interactive; Build must be able to run the
      // Task CLI context/check commands without stopping for approval.
      await appWindow.getByTestId("task-permissions-option-full-access").click();
      await selectTaskProvider(
        appWindow,
        candidate.provider,
        candidate.provider === "pi" ? candidate.models : candidate.model,
      );
      await appWindow.getByTestId("task-create-submit").click();

      await expect(appWindow).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
      await expect(appWindow.getByTestId("guided-task-panel")).toBeVisible();
      await expect(appWindow.getByTestId("guided-stage-questions")).toBeVisible();
      await expect(appWindow.getByTestId("composer-editor")).toBeVisible({
        timeout: E2E_TIMEOUTS.agentReplyMs,
      });
      await expectNoTaskThreadsInChatSidebar(appWindow);

      await answerGuidedClarifyQuestions(appWindow, {
        deadlineMs: candidate.provider === "claude" ? 5 * 60_000 : undefined,
      });
      // Keep provider parity fail-fast: a stalled provider should expose its
      // error instead of holding the acceptance run for the suite timeout.
      const stageDeadlineMs = candidate.provider === "claude" ? 5 * 60_000 : 180_000;
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

      // AC9: the provider must run the approved check through the Task CLI,
      // commit cleanly, and reach completed Implement with the exact
      // resulting commit recorded by the server. The deterministic Plan uses
      // `Checkpoint: always`, so the provider pauses at the checkpoint gate
      // and the operator continues it — exactly like the human desktop flow.
      const resultingCommit = appWindow.getByTestId("guided-resulting-commit");
      const checkpointContinue = appWindow.locator('[data-testid^="guided-checkpoint-continue-"]');
      const taskError = appWindow.getByTestId("guided-task-error");
      const commitDeadline = Date.now() + 5 * 60_000;
      while (Date.now() < commitDeadline) {
        if (await taskError.isVisible().catch(() => false)) {
          throw new Error(
            `Guided task failed during Implement: ${(await taskError.innerText()).trim()}`,
          );
        }
        if (await resultingCommit.isVisible().catch(() => false)) break;
        // Checkpoint rows keep rendering their Continue buttons after
        // continuation (disabled), so skip to the first enabled one.
        const count = await checkpointContinue.count();
        for (let index = 0; index < count; index += 1) {
          const candidate = checkpointContinue.nth(index);
          if (await candidate.isEnabled().catch(() => false)) {
            await candidate.click();
            break;
          }
        }
        await appWindow.waitForTimeout(500);
      }
      await expect(resultingCommit).toBeVisible({ timeout: E2E_TIMEOUTS.assertionMs });
      const resultingCommitSha = (await resultingCommit.innerText()).trim();
      expect(resultingCommitSha).toMatch(/^[0-9a-f]{40}$/);
      // The server-side bind between the worktree HEAD and the recorded
      // resulting commit is asserted in the task-workspace unit suites; the
      // desktop surface here proves the completed Implement panel and the
      // exact recorded commit sha.
      await expect(appWindow.getByTestId("guided-implementation-complete")).toBeVisible();
    });
  }
});
