import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CommandId,
  ProjectId,
  TaskWorkspaceId,
  type TaskWorkspace,
  type TaskWorkspaceEvent,
} from "../../../packages/contracts/src/index.ts";
import type { ElectronApplication, Page } from "@playwright/test";
import { E2E_TAGS } from "../../src/config/tags.ts";
import { assertAgentProviderConfigured } from "../../src/flows/agentChat.ts";
import { createOrOpenProject, createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import { registerFileSessionSeed } from "../../src/harness/fileSession.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MANAGED_FRAMES = [
  "01-guided-create.png",
  "02-guided-plan-review.png",
  "03-guided-plan-approved.png",
  "04-build-checkpoint.png",
  "05-build-amendment.png",
] as const;
const SAFE_WORKSPACE = "/workspace/marketing-demo";
const CREATED_AT = "2026-08-02T20:00:00.000Z";
const MARKETING_WINDOW_SIZE = { width: 1600, height: 1200 } as const;
const PROJECT_ID = ProjectId.make("marketing-task-project");

function revision(id: string, revisionNumber: number, markdown: string) {
  return {
    id,
    kind: "plan" as const,
    title: "Implementation Plan",
    markdown,
    revision: revisionNumber,
    sourceSessionId: null,
    supersedesRevisionId: null,
    blockIndex: [{ id: "overview", headingPath: ["Overview"], contentHash: `${id}-hash` }],
    createdAt: CREATED_AT,
  };
}

function baseTask(
  id: string,
  title: string,
  contract: "task-workspace@0.2.0" | "task-workspace@0.3.0",
  stage: "plan" | "build",
  workflowDefinition: "guided@0.2.0" | "standard@0.1.0",
): TaskWorkspace {
  const taskId = TaskWorkspaceId.make(id);
  const plan = revision(`${id}-plan-r1`, 1, "# Overview\n\nDeliver the approved workflow.");
  return {
    id: taskId,
    environmentId: null,
    title,
    versions: {
      taskContract: contract,
      artifactContract:
        contract === "task-workspace@0.3.0" ? "task-artifact@0.3.0" : "task-artifact@0.2.0",
      workflowDefinition,
      prompt:
        workflowDefinition === "guided@0.2.0"
          ? "task-workspace-guided@0.2.0"
          : "task-workspace@0.1.0",
    },
    intake: {
      brief: "Create a durable onboarding workflow with a readable Plan.",
      source: {
        kind: "inline",
        body: "Create a durable onboarding workflow with a readable Plan.",
      },
    },
    preferences: {
      worktreePolicy: "later",
      modelSelection: null,
      executionProfile: "planning",
    },
    bootstrap: null,
    occurrences: [
      {
        id: `${id}-${stage}-occurrence`,
        stage,
        ordinal: 0,
        status: stage === "plan" ? "awaiting-approval" : "running",
        sessionId: null,
        threadId: null,
        contextManifestId: null,
        artifactRevisionId: plan.id,
        completionProposalId: null,
        gateOutcome: null,
        feedback: null,
        supersedesOccurrenceId: null,
        createdAt: CREATED_AT,
        completedAt: null,
      },
    ],
    planGate: null,
    gateHistory: [],
    taskRevision: 1,
    workspace: {
      repositories: [
        {
          id: "primary",
          projectId: PROJECT_ID,
          workspaceRoot: SAFE_WORKSPACE,
          baseRef: "main",
          branch: null,
          worktreePath: null,
          provisioningStatus: "pending",
          baseCommitSha: null,
          planningRootFingerprint: null,
        },
      ],
    },
    workflowRuns: [
      {
        id: `${id}-run`,
        preset: workflowDefinition.startsWith("guided") ? "guided" : "standard",
        definitionVersion: workflowDefinition,
        ...(workflowDefinition.startsWith("guided")
          ? { promptBundleVersion: "task-workspace-guided@0.2.0" }
          : {}),
        currentStage: stage,
        approvalPolicy: "before-build",
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    sessions: [],
    artifacts: [{ id: `${id}-plan`, kind: "plan", currentRevision: 1, revisions: [plan] }],
    comments: [],
    contextManifests: [],
    build: {
      phases: [],
      resultingCommitSha: null,
      activePhaseId: null,
      activeWorkItemId: null,
      checks: [],
      checkpoints: [],
      amendments: [],
      currentPlanRevisionId: plan.id,
      amendmentGateId: null,
      continuationSessionIds: [],
    },
    verification: { criteria: [], results: [], signedOffAt: null },
    sourceLinks: [],
    delivery: { state: "unavailable" },
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function guidedReviewTask(): TaskWorkspace {
  const task = baseTask(
    "marketing-guided-plan-review",
    "Guided onboarding workflow",
    "task-workspace@0.3.0",
    "plan",
    "guided@0.2.0",
  );
  task.planGate = {
    occurrence: 0,
    revision: 1,
    status: "open",
    feedback: null,
    openedAt: CREATED_AT,
    resolvedAt: null,
  };
  task.artifacts[0]!.revisions[0]!.markdown =
    "# Onboarding Plan\n\n1. Clarify the brief.\n2. Research the existing flow.\n3. Design the implementation.\n4. Build the ordered phases.";
  return task;
}

function guidedApprovedTask(): TaskWorkspace {
  const task = baseTask(
    "marketing-guided-plan-approved",
    "Approved onboarding workflow",
    "task-workspace@0.3.0",
    "plan",
    "guided@0.2.0",
  );
  task.occurrences[0]!.status = "completed";
  task.occurrences[0]!.gateOutcome = "approved";
  task.occurrences[0]!.completedAt = "2026-08-02T20:01:00.000Z";
  task.planGate = {
    occurrence: 0,
    revision: 1,
    status: "approved",
    feedback: null,
    openedAt: CREATED_AT,
    resolvedAt: "2026-08-02T20:01:00.000Z",
  };
  return task;
}

function buildCheckpointTask(): TaskWorkspace {
  const task = baseTask(
    "marketing-build-checkpoint",
    "Build checkpoint workflow",
    "task-workspace@0.2.0",
    "build",
    "standard@0.1.0",
  );
  task.build.phases = [
    {
      id: "phase-discovery",
      title: "Discovery and foundation",
      status: "completed",
      workItems: [
        {
          id: "work-requirements",
          title: "Record onboarding requirements",
          status: "completed",
          summary: "Brief and acceptance criteria captured.",
          dependsOn: [],
          checkIds: ["check-requirements"],
          invalidationReason: null,
        },
      ],
      checkpointPolicy: "always",
      checkIds: ["check-requirements"],
      checkpointId: "checkpoint-foundation",
      phaseCommitSha: null,
      startedAt: CREATED_AT,
      completedAt: "2026-08-02T20:02:00.000Z",
    },
    {
      id: "phase-interface",
      title: "Interface implementation",
      status: "pending",
      workItems: [
        {
          id: "work-interface",
          title: "Implement the onboarding steps",
          status: "pending",
          summary: "Build the ordered experience.",
          dependsOn: ["work-requirements"],
          checkIds: ["check-interface"],
          invalidationReason: null,
        },
      ],
      checkpointPolicy: "manual-only",
      checkIds: ["check-interface"],
      checkpointId: null,
      phaseCommitSha: null,
      startedAt: null,
      completedAt: null,
    },
  ];
  task.build.activePhaseId = "phase-interface";
  task.build.checks = [
    {
      id: "check-requirements",
      phaseId: "phase-discovery",
      workItemId: "work-requirements",
      kind: "automated",
      status: "pass",
      label: "Requirements are captured",
      command: "task validate requirements",
      output: "PASS",
      note: null,
      exitCode: 0,
      commitSha: null,
      startedAt: CREATED_AT,
      completedAt: "2026-08-02T20:02:00.000Z",
    },
    {
      id: "check-interface",
      phaseId: "phase-interface",
      workItemId: "work-interface",
      kind: "manual",
      status: "pending",
      label: "Review interface behavior",
      command: null,
      output: null,
      note: null,
      exitCode: null,
      commitSha: null,
      startedAt: null,
      completedAt: null,
    },
  ];
  task.build.checkpoints = [
    {
      id: "checkpoint-foundation",
      phaseId: "phase-discovery",
      reason: "Foundation checks completed; review before continuing.",
      status: "waiting",
      checkIds: ["check-requirements"],
      continuationSessionId: null,
      contextManifestId: null,
      createdAt: "2026-08-02T20:02:00.000Z",
      continuedAt: null,
    },
  ];
  return task;
}

function buildAmendmentTask(): TaskWorkspace {
  const task = baseTask(
    "marketing-build-amendment",
    "Build amendment workflow",
    "task-workspace@0.2.0",
    "build",
    "standard@0.1.0",
  );
  const plan = revision(
    "marketing-build-amendment-plan-r1",
    1,
    "# Overview\n\nUse the approved fixture.",
  );
  const proposed = revision(
    "marketing-build-amendment-plan-r2",
    2,
    "# Overview\n\nUse the revised fixture.",
  );
  task.artifacts = [
    {
      id: "marketing-amendment-plan",
      kind: "plan",
      currentRevision: 1,
      revisions: [plan, proposed],
    },
  ];
  task.build.currentPlanRevisionId = plan.id;
  task.build.phases = [
    {
      id: "phase-implementation",
      title: "Implementation",
      status: "blocked",
      workItems: [
        {
          id: "work-fixture",
          title: "Apply the onboarding fixture",
          status: "blocked",
          summary: "Blocked by the failed automated check.",
          dependsOn: [],
          checkIds: ["check-fixture"],
          invalidationReason: "Implementation differs from the approved Plan.",
        },
      ],
      checkpointPolicy: "on-failure",
      checkIds: ["check-fixture"],
      checkpointId: null,
      phaseCommitSha: null,
      startedAt: CREATED_AT,
      completedAt: null,
    },
  ];
  task.build.activePhaseId = "phase-implementation";
  task.build.activeWorkItemId = "work-fixture";
  task.build.checks = [
    {
      id: "check-fixture",
      phaseId: "phase-implementation",
      workItemId: "work-fixture",
      kind: "automated",
      status: "fail",
      label: "Fixture matches approved Plan",
      command: "task verify fixture",
      output: "Expected 3 steps; found 2 steps.",
      note: null,
      exitCode: 1,
      commitSha: null,
      startedAt: CREATED_AT,
      completedAt: "2026-08-02T20:03:00.000Z",
    },
  ];
  task.build.amendments = [
    {
      id: "amendment-fixture",
      basePlanRevisionId: plan.id,
      triggeringPhaseId: "phase-implementation",
      triggeringWorkItemId: "work-fixture",
      triggeringCheckId: "check-fixture",
      expected: "The approved Plan requires 3 onboarding steps.",
      found: "The implementation contains 2 onboarding steps.",
      impact: "The work item cannot complete against the approved Plan.",
      proposedChanges: "Revise the Plan fixture to document the two-step flow.",
      affectedPhaseIds: ["phase-implementation"],
      affectedWorkItemIds: ["work-fixture"],
      dependentCheckIds: ["check-fixture"],
      status: "requested",
      artifactRevisionId: proposed.id,
      planDiff: {
        baseRevisionId: plan.id,
        proposedRevisionId: proposed.id,
        summary: "Update the onboarding step count and acceptance wording.",
        changedBlockIds: ["overview"],
      },
      requestedAt: "2026-08-02T20:03:00.000Z",
      approvedAt: null,
      approvedBy: null,
    },
  ];
  task.build.amendmentGateId = "amendment-fixture";
  return task;
}

const seededTasks = [
  guidedReviewTask(),
  guidedApprovedTask(),
  buildCheckpointTask(),
  buildAmendmentTask(),
];

registerFileSessionSeed(fileURLToPath(import.meta.url), async (context) => {
  const directory = path.join(context.katacodeHome, "dev");
  await mkdir(directory, { recursive: true });
  const events: TaskWorkspaceEvent[] = seededTasks.map((task, index) => ({
    sequence: index + 1,
    eventId: `marketing-task-workflow-${index + 1}`,
    commandId: CommandId.make(`marketing-task-workflow-command-${index + 1}`),
    taskId: task.id,
    type: "task.create",
    occurredAt: CREATED_AT,
    task,
  }));
  const contents = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  for (const stateDirectory of ["dev", "userdata"]) {
    const targetDirectory = path.join(context.katacodeHome, stateDirectory);
    await mkdir(targetDirectory, { recursive: true });
    await writeFile(path.join(targetDirectory, "task-workspace-events.ndjson"), contents, "utf8");
  }
});

function outputDirectory(): string {
  const configured = process.env.KATACODE_E2E_MARKETING_OUTPUT?.trim();
  return configured
    ? path.resolve(REPO_ROOT, configured)
    : path.join(REPO_ROOT, "e2e/test-results/marketing-screenshots");
}

async function prepareOutput(): Promise<string> {
  const directory = outputDirectory();
  await mkdir(directory, { recursive: true });
  await Promise.all(
    MANAGED_FRAMES.map((name) => unlink(path.join(directory, name)).catch(() => undefined)),
  );
  return directory;
}

async function capture(page: Page, output: string, name: string): Promise<void> {
  const renderedText = await page.locator("body").innerText();
  for (const forbidden of ["katacode-e2e-home", "katacode-e2e-workspace", "/var/folders"]) {
    expect(renderedText).not.toContain(forbidden);
  }
  await page.screenshot({ path: path.join(output, name), animations: "disabled" });
}

async function openSeededTask(page: Page, taskId: string): Promise<void> {
  const taskLink = page.locator(`a[href$="/${taskId}"]`).first();
  await expect(taskLink).toBeVisible();
  await taskLink.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/[^/]+/${taskId}$`));
}

async function resizeMarketingWindow(electronApp: ElectronApplication): Promise<void> {
  const bounds = await electronApp.evaluate(({ BrowserWindow }, size) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) throw new Error("Marketing screenshot window was not created.");
    window.setSize(size.width, size.height);
    window.center();
    return window.getBounds();
  }, MARKETING_WINDOW_SIZE);
  expect(bounds.width).toBe(MARKETING_WINDOW_SIZE.width);
  expect(bounds.height).toBe(MARKETING_WINDOW_SIZE.height);
}

test.describe(`Marketing task workflow screenshots ${E2E_TAGS.marketing}`, () => {
  test("captures the five approved workflow frames", async ({
    authenticatedAppWindow,
    electronApp,
    runContext,
  }) => {
    test.skip(runContext.launchTarget !== "dev", "Marketing screenshots require desktop-dev.");
    const output = await prepareOutput();
    const appWindow = authenticatedAppWindow;
    await resizeMarketingWindow(electronApp);
    await appWindow.setViewportSize(MARKETING_WINDOW_SIZE);
    await appWindow.addStyleTag({
      content:
        "*, *::before, *::after { animation: none !important; transition: none !important; }",
    });

    const turn = assertAgentProviderConfigured("Marketing task workflow screenshot creation form");
    const workspaceRoot = await createSeededGitWorkspace(runContext, {
      name: "marketing-task-workflow",
      remoteUrl: "https://example.test/kata/marketing-task-workflow.git",
      files: { "README.md": "# Marketing task workflow\n" },
    });
    await createOrOpenProject(appWindow, workspaceRoot);
    await appWindow.getByRole("link", { name: "New task" }).click();
    await expect(appWindow.getByTestId("task-create-submit")).toBeVisible();
    await expect(appWindow.getByTestId("task-workflow-option-guided")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(appWindow.getByTestId("task-resolved-definition")).toContainText("guided@0.2.0");
    await expect(
      appWindow
        .locator("main")
        .getByText("Available through approved Plan", { exact: true })
        .first(),
    ).toBeVisible();
    await appWindow.getByTestId("task-title-input").fill("Build a guided onboarding flow");
    await appWindow.getByTestId("task-slug-input").fill("guided-onboarding-marketing");
    await appWindow
      .getByTestId("task-brief-input")
      .fill("Create a three-step onboarding flow with durable progress and a readable Plan.");
    await appWindow.getByTestId("task-base-ref-input").fill("main");
    await expect(appWindow.getByTestId("task-agent-select")).toBeEnabled();
    const agentOption = appWindow.getByTestId("task-agent-select").locator("option");
    const matchingAgent = agentOption.filter({ hasText: turn.provider }).first();
    await expect(matchingAgent).toHaveCount(1);
    await appWindow
      .getByTestId("task-agent-select")
      .selectOption((await matchingAgent.getAttribute("value")) as string);
    await expect(appWindow.getByTestId("task-model-select")).toBeEnabled();
    const matchingModel = appWindow
      .getByTestId("task-model-select")
      .locator("option")
      .filter({ hasText: turn.model })
      .first();
    await expect(matchingModel).toHaveCount(1);
    await appWindow
      .getByTestId("task-model-select")
      .selectOption((await matchingModel.getAttribute("value")) as string);
    await expect(appWindow.getByTestId("task-create-submit")).toBeEnabled();
    await capture(appWindow, output, MANAGED_FRAMES[0]);

    await openSeededTask(appWindow, "marketing-guided-plan-review");
    const guidedReview = appWindow.getByTestId("guided-task-panel");
    await expect(guidedReview).toBeVisible();
    await expect(guidedReview.getByTestId("guided-stage-questions")).toBeVisible();
    await expect(guidedReview.getByTestId("guided-stage-research")).toBeVisible();
    await expect(guidedReview.getByTestId("guided-stage-design")).toBeVisible();
    await expect(guidedReview.getByTestId("guided-stage-plan")).toHaveAttribute(
      "data-active",
      "true",
    );
    await expect(guidedReview.getByTestId("guided-plan-gate")).toBeVisible();
    await expect(guidedReview.getByTestId("guided-plan-approve")).toBeEnabled();
    await expect(guidedReview.getByTestId("guided-task-artifact")).toContainText(
      "Clarify the brief",
    );
    await capture(appWindow, output, MANAGED_FRAMES[1]);

    await openSeededTask(appWindow, "marketing-guided-plan-approved");
    const approved = appWindow.getByTestId("task-approved-plan-readonly");
    await expect(approved).toBeVisible();
    await expect(appWindow.getByText("Plan approved", { exact: true })).toBeVisible();
    await expect(appWindow.getByTestId("guided-stage-build")).toHaveCount(0);
    await expect(appWindow.getByTestId("task-apply-fixture")).toHaveCount(0);
    await capture(appWindow, output, MANAGED_FRAMES[2]);

    await openSeededTask(appWindow, "marketing-build-checkpoint");
    const checkpointPanel = appWindow.getByTestId("task-build-panel");
    await expect(checkpointPanel).toBeVisible();
    await expect(checkpointPanel.getByTestId("task-build-phase-phase-discovery")).toBeVisible();
    await expect(checkpointPanel.getByTestId("task-build-phase-phase-interface")).toBeVisible();
    await expect(
      checkpointPanel.getByTestId("task-build-checkpoint-checkpoint-foundation"),
    ).toContainText("Checkpoint waiting");
    await expect(checkpointPanel.getByTestId("task-build-check-check-requirements")).toContainText(
      "pass",
    );
    await capture(appWindow, output, MANAGED_FRAMES[3]);

    await openSeededTask(appWindow, "marketing-build-amendment");
    const amendmentPanel = appWindow.getByTestId("task-build-panel");
    await expect(amendmentPanel).toBeVisible();
    await expect(amendmentPanel.getByTestId("task-build-check-check-fixture")).toContainText(
      "fail",
    );
    await expect(amendmentPanel.getByTestId("task-build-work-item-work-fixture")).toContainText(
      "blocked",
    );
    await expect(amendmentPanel.getByTestId("task-build-amendment-gate")).toBeVisible();
    await expect(amendmentPanel.getByTestId("task-build-amendment-expected")).toContainText(
      "3 onboarding steps",
    );
    await expect(amendmentPanel.getByTestId("task-build-amendment-found")).toContainText(
      "2 onboarding steps",
    );
    await expect(amendmentPanel.getByTestId("task-build-plan-diff")).toContainText(
      "Plan revision diff",
    );
    await capture(appWindow, output, MANAGED_FRAMES[4]);

    const files = (await readdir(output)).filter((file) => file.endsWith(".png"));
    expect(files.filter((file) => (MANAGED_FRAMES as readonly string[]).includes(file))).toEqual([
      ...MANAGED_FRAMES,
    ]);
  });
});
