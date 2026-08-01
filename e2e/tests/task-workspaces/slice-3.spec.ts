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
    files: { "README.md": "# Task workspace E2E\n" },
  });
  await execFile("git", ["config", "user.name", "Kata E2E"], { cwd: workspaceRoot });
  await execFile("git", ["config", "user.email", "kata-e2e@example.test"], { cwd: workspaceRoot });
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
  const taskLink = page.locator(`a[href$="/${id}"]`).first();
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
  await expect(page).toHaveURL(new RegExp(`/tasks/(?:[^/]+/)?${id}$`));
  await expect(page.getByTestId("task-artifacts-panel")).toBeVisible();
}

test.describe(`Task workspaces Slice 3 ${E2E_TAGS.taskWorkspaces}`, () => {
  // TW-S3-AC02 / TW-S3-AC08: Guided runs Questions -> Research -> Design -> Plan,
  // producing an artifact per reasoning stage, with no worktree before Build.
  test("runs a Guided task through Research and Design to a verified fixture", async ({
    appWindow,
    runContext,
  }) => {
    const workspaceRoot = await seedWorkspace(runContext, "task-workspace-slice-3-guided");
    const taskId = TaskWorkspaceId.make("task-e2e-slice-3-guided");

    await dispatchTaskCommand(appWindow, {
      type: "task.create",
      commandId: CommandId.make("command-e2e-guided-create"),
      taskId,
      createdAt: "2026-07-30T21:00:00.000Z",
      title: "Guided E2E",
      projectId: ProjectId.make("project-e2e-guided"),
      workspaceRoot,
      baseRef: "main",
      preset: "guided",
      approvalPolicy: "before-build",
    });
    await openTask(appWindow, taskId);

    // The rail is the pinned Guided definition's, not the Standard ladder.
    await expect(appWindow.getByTestId("task-workflow-summary")).toContainText("guided@0.1.0");
    await expect(appWindow.getByTestId("task-workflow-rail-research")).toBeVisible();
    await expect(appWindow.getByTestId("task-workflow-rail-design")).toBeVisible();
    // Lazy provisioning holds for Guided too.
    await expect(appWindow.getByTestId("task-worktree-path")).toContainText(
      "Provisioned after Plan approval",
    );

    await appWindow.getByTestId("task-questions-editor").fill("# Questions\n\nNo blockers.");
    await appWindow.getByTestId("task-save-questions").click();
    await appWindow.getByTestId("task-complete-questions").click();

    // Questions leads to Research under Guided, where Standard would go to Plan.
    await appWindow.getByTestId("task-research-editor").fill("# Research\n\nPrior art reviewed.");
    await appWindow.getByTestId("task-save-research").click();
    await appWindow.getByTestId("task-complete-research").click();

    await appWindow.getByTestId("task-design-editor").fill("# Design\n\nThe shape.");
    await appWindow.getByTestId("task-save-design").click();
    await appWindow.getByTestId("task-complete-design").click();

    // One artifact per reasoning stage, each browsable in its own lineage.
    const artifacts = appWindow.getByTestId("task-artifacts-panel");
    await expect(artifacts.getByRole("button", { name: /Research/ })).toBeVisible();
    await expect(artifacts.getByRole("button", { name: /Design/ })).toBeVisible();

    await appWindow.getByTestId("task-save-plan").click();
    await appWindow.getByTestId("task-approve-plan").click();
    await appWindow.getByTestId("task-apply-fixture").click();
    await appWindow.getByTestId("task-run-verification").click();
    await appWindow.getByTestId("task-signoff").click();
    await expect(appWindow.getByTestId("task-verified-state")).toBeVisible();
  });

  // TW-S3-AC05: Freeform accumulates with no automatic advancement and enters
  // stages only when asked, then converges on the usual delivery path.
  test("accumulates a Freeform task and advances only on explicit stage entry", async ({
    appWindow,
    runContext,
  }) => {
    const workspaceRoot = await seedWorkspace(runContext, "task-workspace-slice-3-freeform");
    const taskId = TaskWorkspaceId.make("task-e2e-slice-3-freeform");

    await dispatchTaskCommand(appWindow, {
      type: "task.create",
      commandId: CommandId.make("command-e2e-freeform-create"),
      taskId,
      createdAt: "2026-07-30T21:10:00.000Z",
      title: "Freeform E2E",
      projectId: ProjectId.make("project-e2e-freeform"),
      workspaceRoot,
      baseRef: "main",
      preset: "freeform",
      approvalPolicy: "before-build",
    });
    await openTask(appWindow, taskId);

    const timeline = appWindow.getByTestId("task-workflow-timeline");
    await expect(timeline).toBeVisible();
    await expect(appWindow.getByTestId("task-workflow-rail")).toHaveCount(0);
    await expect(appWindow.getByTestId("task-complete-questions")).toHaveCount(0);
    // Build is reached by approving a plan, never by explicit entry.
    await expect(appWindow.getByTestId("task-start-stage-build")).toHaveCount(0);

    // Saving a questions artifact does not move the stage: there is no rail.
    await appWindow.getByTestId("task-questions-editor").fill("# Notes\n\nThinking out loud.");
    await appWindow.getByTestId("task-save-questions").click();
    await expect(appWindow.getByTestId("task-timeline-stage-questions")).toHaveAttribute(
      "data-active",
      "true",
    );

    await appWindow.getByTestId("task-start-stage-research").click();
    await expect(appWindow.getByTestId("task-timeline-stage-research")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(appWindow.getByTestId("task-complete-research")).toHaveCount(0);

    await appWindow.getByTestId("task-start-stage-plan").click();
    await appWindow.getByTestId("task-save-plan").click();
    await appWindow.getByTestId("task-approve-plan").click();
    await appWindow.getByTestId("task-apply-fixture").click();
    await appWindow.getByTestId("task-run-verification").click();
    await appWindow.getByTestId("task-signoff").click();
    await expect(appWindow.getByTestId("task-verified-state")).toBeVisible();
  });

  // TW-S3-AC03 / TW-S3-AC04: the inspector shows the carried blocks and budget,
  // and an over-budget selection is flagged rather than quietly shrunk.
  test("surfaces context manifest provenance and flags a compressed selection", async ({
    appWindow,
    runContext,
  }) => {
    const workspaceRoot = await seedWorkspace(runContext, "task-workspace-slice-3-budget");
    const taskId = TaskWorkspaceId.make("task-e2e-slice-3-budget");

    await dispatchTaskCommand(appWindow, {
      type: "task.create",
      commandId: CommandId.make("command-e2e-budget-create"),
      taskId,
      createdAt: "2026-07-30T21:20:00.000Z",
      title: "Context budget E2E",
      projectId: ProjectId.make("project-e2e-budget"),
      workspaceRoot,
      baseRef: "main",
      preset: "guided",
      approvalPolicy: "before-build",
    });
    await dispatchTaskCommand(appWindow, {
      type: "task.artifact.upsert",
      commandId: CommandId.make("command-e2e-budget-questions"),
      taskId,
      createdAt: "2026-07-30T21:21:00.000Z",
      kind: "questions",
      title: "Questions",
      markdown: [
        "<!-- kata:block:alpha -->",
        "# Alpha",
        "alpha detail. ".repeat(20),
        "",
        "<!-- kata:block:beta -->",
        "# Beta",
        "beta detail. ".repeat(20),
        "",
      ].join("\n"),
      sourceSessionId: null,
    });

    // Comfortably within budget: raw blocks are carried, nothing is flagged.
    await dispatchTaskCommand(appWindow, {
      type: "task.context-manifest.create",
      commandId: CommandId.make("command-e2e-budget-roomy"),
      taskId,
      createdAt: "2026-07-30T21:22:00.000Z",
      artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["alpha"] }],
      budget: 100_000,
    });
    // Deliberately tiny budget: the selection must be summarized and flagged.
    await dispatchTaskCommand(appWindow, {
      type: "task.context-manifest.create",
      commandId: CommandId.make("command-e2e-budget-tight"),
      taskId,
      createdAt: "2026-07-30T21:23:00.000Z",
      artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["alpha", "beta"] }],
      budget: 20,
    });

    await openTask(appWindow, taskId);

    const manifests = appWindow.getByTestId("task-context-manifests-panel");
    await expect(manifests).toBeVisible();
    await expect(manifests.getByTestId("task-context-manifest-manifest-1-budget")).toContainText(
      "/ 100000 tokens",
    );
    // The in-budget manifest carries no compression marker.
    await expect(manifests.getByTestId("task-context-manifest-manifest-1-compressed")).toHaveCount(
      0,
    );

    // The over-budget one says so, in the panel, without being opened.
    await expect(
      manifests.getByTestId("task-context-manifest-manifest-2-compressed"),
    ).toContainText("2 blocks compressed");
    await expect(manifests.getByTestId("task-context-compressed-summary")).toContainText(
      "1 compressed",
    );

    // The generated summary is a real artifact with its own lineage.
    await expect(
      appWindow
        .getByTestId("task-artifacts-panel")
        .getByRole("button", { name: /Context summary/ }),
    ).toBeVisible();
  });
});
