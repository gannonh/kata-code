import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  CommandId,
  ProjectId,
  TaskWorkspaceId,
  type TaskWorkspaceCommand,
} from "../../../packages/contracts/src/index.ts";
import type { Page } from "@playwright/test";

import { E2E_TAGS } from "../../src/config/tags.ts";
import { createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

const execFile = promisify(execFileCallback);

async function seedWorkspace(
  runContext: Parameters<typeof createSeededGitWorkspace>[0],
  name: string,
) {
  const workspaceRoot = await createSeededGitWorkspace(runContext, {
    name,
    remoteUrl: "https://example.test/gannonh/task-workspace-e2e.git",
    files: { "README.md": "# Task workspace Slice 4\n" },
  });
  await execFile("git", ["config", "user.name", "Kata E2E"], { cwd: workspaceRoot });
  await execFile("git", ["config", "user.email", "kata-e2e@example.test"], {
    cwd: workspaceRoot,
  });
  await execFile("git", ["add", "."], { cwd: workspaceRoot });
  await execFile("git", ["commit", "-m", "test: seed task workspace"], { cwd: workspaceRoot });
  await execFile("git", ["branch", "-M", "main"], { cwd: workspaceRoot });
  return workspaceRoot;
}

async function dispatchTaskCommand(page: Page, command: TaskWorkspaceCommand): Promise<void> {
  await page.evaluate(
    async ({ modulePath, input }) => {
      const runtime = (await import(/* @vite-ignore */ modulePath)) as {
        getPrimaryEnvironmentConnection: () => {
          client: {
            taskWorkspaces: {
              dispatchCommand: (command: unknown) => Promise<unknown>;
            };
          };
        };
      };
      await runtime.getPrimaryEnvironmentConnection().client.taskWorkspaces.dispatchCommand(input);
    },
    { modulePath: "/src/environments/runtime/index.ts", input: command },
  );
}

async function openTask(page: Page, id: string): Promise<void> {
  const taskLink = page.locator(`a[href$="/tasks/${id}"]`).first();
  await expect(taskLink).toBeVisible();
  const href = await taskLink.getAttribute("href");
  expect(href).not.toBeNull();
  await page.evaluate((routeHref) => {
    const hashIndex = routeHref.indexOf("#/");
    if (hashIndex >= 0) {
      window.location.hash = routeHref.slice(hashIndex + 1);
      return;
    }
    window.history.pushState({}, "", routeHref);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, href!);
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
  await expect(page.getByTestId("task-artifacts-panel")).toBeVisible();
}

test.describe(`Task workspaces Slice 4 ${E2E_TAGS.taskWorkspaces}`, () => {
  test("runs the two-phase checkpoint, mismatch, amendment, resume, and restart flow", async ({
    appWindow,
    runContext,
  }) => {
    const workspaceRoot = await seedWorkspace(runContext, "task-workspace-slice-4-build");
    const taskId = TaskWorkspaceId.make("task-e2e-slice-4-build");

    await dispatchTaskCommand(appWindow, {
      type: "task.create",
      commandId: CommandId.make("command-e2e-s4-create"),
      taskId,
      createdAt: "2026-07-30T22:00:00.000Z",
      title: "Slice 4 Build E2E",
      projectId: ProjectId.make("project-e2e-slice-4"),
      workspaceRoot,
      baseRef: "main",
      preset: "standard",
      approvalPolicy: "before-build",
    });
    await openTask(appWindow, taskId);

    await appWindow.getByTestId("task-questions-editor").fill("# Questions\n\nNo blockers.");
    await appWindow.getByTestId("task-save-questions").click();
    await appWindow.getByTestId("task-complete-questions").click();
    await appWindow
      .getByTestId("task-plan-editor")
      .fill(
        [
          "# Plan",
          "",
          "## Phase Prepare",
          "Checkpoint policy: always",
          "",
          "### Work item Prepare fixture",
          "- Check: fixture.pass",
          "",
          "### Work item Prepare review",
          "Depends on: Prepare fixture",
          "- Manual check: operator review",
          "",
          "## Phase Implement",
          "Checkpoint policy: on-failure",
          "",
          "### Work item Implement fixture",
          "- Check: fixture.mismatch",
        ].join("\n"),
      );
    await appWindow.getByTestId("task-save-plan").click();
    await appWindow.getByTestId("task-approve-plan").click();
    await expect(appWindow.getByTestId("task-build-panel")).toBeVisible();
    await expect(appWindow.getByTestId("task-build-phase-phase-1")).toBeVisible();
    await expect(appWindow.getByTestId("task-build-phase-phase-2")).toBeVisible();

    await appWindow.getByTestId("task-build-phase-start-phase-1").click();
    await appWindow.getByTestId("task-build-work-start-work-item-1").click();
    await appWindow.getByTestId("task-build-check-run-phase-1-check-1").click();
    await appWindow.getByTestId("task-build-work-complete-work-item-1").click();
    await appWindow.getByTestId("task-build-work-start-work-item-2").click();
    const manualNote = appWindow.getByLabel("Note for operator review");
    await manualNote.fill("Reviewed by the operator.");
    const recordPass = appWindow.getByTestId("task-build-check-record-phase-1-check-2");
    await expect(recordPass).toBeEnabled();
    await recordPass.click();
    await expect(appWindow.getByTestId("task-build-check-phase-1-check-2")).toContainText("pass");
    await appWindow.getByTestId("task-build-work-complete-work-item-2").click();
    await expect(appWindow.getByTestId("task-build-checkpoint-checkpoint-1")).toBeVisible();

    await appWindow.getByTestId("task-build-context-create-checkpoint-1").click();
    await appWindow.getByTestId("task-build-checkpoint-continue-checkpoint-1").click();
    await expect(appWindow.getByTestId("task-build-phase-phase-2")).toContainText("current");
    await appWindow.getByTestId("task-build-work-start-phase-2-work-item-1").click();
    await appWindow.getByTestId("task-build-check-run-phase-2-check-1").click();
    await expect(appWindow.getByTestId("task-build-work-item-phase-2-work-item-1")).toContainText(
      "blocked",
    );
    await expect(appWindow.getByTestId("task-build-check-run-phase-2-check-1")).toBeVisible();

    await appWindow.getByTestId("task-build-amendment-request-phase-2-check-1").click();
    await expect(appWindow.getByTestId("task-build-amendment-gate")).toBeVisible();
    await appWindow.getByTestId("task-build-amendment-approve-amendment-1").click();
    await expect(
      appWindow.getByTestId("task-build-invalidation-phase-2-work-item-1"),
    ).toBeVisible();

    await appWindow.getByTestId("task-build-context-create-checkpoint-2").click();
    await appWindow.getByTestId("task-build-checkpoint-resume-checkpoint-2").click();
    await appWindow.getByTestId("task-build-work-start-phase-2-work-item-1").click();
    await appWindow.getByTestId("task-build-check-run-phase-2-check-1").click();
    await appWindow.getByTestId("task-build-work-complete-phase-2-work-item-1").click();
    await expect(appWindow.getByTestId("task-build-phase-phase-2")).toContainText("completed");

    await appWindow.reload();
    await expect(appWindow.getByTestId("task-build-phase-phase-1")).toContainText("completed");
    await expect(appWindow.getByTestId("task-build-phase-phase-2")).toContainText("completed");
  });
});
