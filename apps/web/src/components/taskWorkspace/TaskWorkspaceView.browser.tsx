import "../../index.css";

import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  type TaskWorkspace,
  ThreadId,
} from "@kata-sh/code-contracts";
import { page } from "vite-plus/test/browser";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { useTaskWorkspaceStore } from "../../taskWorkspace/taskWorkspaceStore";
import { SidebarProvider } from "../ui/sidebar";
import { TaskWorkspaceView } from "./TaskWorkspaceView";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn<(command: unknown) => Promise<void>>(async () => undefined),
  primaryEnvironmentId: "environment-local" as string | null,
  useClerk: vi.fn(() => ({ user: null })),
}));

vi.mock("../../environments/primary", () => ({
  usePrimaryEnvironmentId: () => mocks.primaryEnvironmentId,
}));

vi.mock("@clerk/react", () => ({
  useClerk: mocks.useClerk,
}));

vi.mock("../../cloud/publicConfig", () => ({
  hasCloudPublicConfig: () => false,
}));

vi.mock("../../environments/runtime", () => ({
  readEnvironmentConnection: () => null,
  getPrimaryEnvironmentConnection: () => ({
    client: {
      taskWorkspaces: {
        dispatchCommand: mocks.dispatchCommand,
      },
    },
  }),
  requireEnvironmentConnection: () => ({
    client: {
      taskWorkspaces: {
        dispatchCommand: mocks.dispatchCommand,
      },
    },
  }),
}));

vi.mock("../../store", () => ({
  selectEnvironmentState: () => ({ threadShellById: {} }),
  selectSidebarThreadsAcrossEnvironments: () => [],
  useStore: () => [],
}));

const baseTask: TaskWorkspace = {
  id: "task-browser",
  environmentId: EnvironmentId.make("environment-local"),
  title: "Browser task workspace",
  versions: {
    taskContract: "task-workspace@0.1.0",
    artifactContract: "task-artifact@0.1.0",
    workflowDefinition: "standard@0.1.0",
    prompt: "task-workspace-slice-1@0.1.0",
  },
  intake: { brief: "", source: { kind: "inline", body: "" } },
  preferences: { worktreePolicy: "later", modelSelection: null, executionProfile: "planning" },
  bootstrap: null,
  occurrences: [],
  planGate: null,
  gateHistory: [],
  taskRevision: 0,
  workspace: {
    repositories: [
      {
        id: "primary",
        projectId: ProjectId.make("project-1"),
        workspaceRoot: "/repo/project",
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
      id: "standard-run-1",
      preset: "standard",
      definitionVersion: "standard@0.1.0",
      currentStage: "questions",
      approvalPolicy: "before-build",
      createdAt: "2026-07-28T17:00:00.000Z",
      updatedAt: "2026-07-28T17:00:00.000Z",
    },
  ],
  sessions: [],
  artifacts: [],
  comments: [],
  contextManifests: [],
  build: {
    phases: [
      {
        id: "phase-1",
        title: "Implement deterministic fixture",
        status: "pending",
        workItems: [
          {
            id: "work-item-1",
            title: "Create and commit task-workspace-slice-1.txt",
            status: "pending",
            summary: null,
            dependsOn: [],
            checkIds: [],
            invalidationReason: null,
          },
        ],
        checkpointPolicy: "never",
        checkIds: [],
        checkpointId: null,
        phaseCommitSha: null,
        startedAt: null,
        completedAt: null,
      },
    ],
    resultingCommitSha: null,
    activePhaseId: null,
    activeWorkItemId: null,
    checks: [],
    checkpoints: [],
    amendments: [],
    checkAttempts: [],
    currentPlanRevisionId: null,
    amendmentGateId: null,
    continuationSessionIds: [],
  },
  verification: {
    criteria: [
      {
        id: "criterion-1",
        description: "The fixture exists at the resulting commit.",
      },
    ],
    results: [],
    signedOffAt: null,
  },
  sourceLinks: [],
  delivery: { state: "unavailable" },
  createdAt: "2026-07-28T17:00:00.000Z",
  updatedAt: "2026-07-28T17:00:00.000Z",
};

async function renderTask(task: TaskWorkspace) {
  useTaskWorkspaceStore.getState().applyStreamItem(EnvironmentId.make("environment-local"), {
    kind: "snapshot",
    snapshot: { sequence: 1, tasks: [task] },
  });
  return render(
    <SidebarProvider>
      <TaskWorkspaceView taskId={task.id} />
    </SidebarProvider>,
  );
}

beforeEach(() => {
  mocks.dispatchCommand.mockClear();
  mocks.useClerk.mockClear();
  mocks.primaryEnvironmentId = "environment-local";
  useTaskWorkspaceStore.getState().reset();
});

describe("TaskWorkspaceView", () => {
  it("renders the hierarchical Build panel and amendment gate states", async () => {
    const firstPhase = baseTask.build.phases[0]!;
    await renderTask({
      ...baseTask,
      workflowRuns: [{ ...baseTask.workflowRuns[0]!, currentStage: "build" }],
      build: {
        ...baseTask.build,
        activePhaseId: "phase-2",
        activeWorkItemId: "phase-2-work-item-1",
        phases: [
          {
            ...firstPhase,
            title: "Prepare",
            status: "completed",
            completedAt: "2026-07-30T17:00:00.000Z",
            workItems: [
              {
                ...firstPhase.workItems[0]!,
                status: "completed",
                summary: "Prepare completed.",
              },
            ],
          },
          {
            ...firstPhase,
            id: "phase-2",
            title: "Implement",
            status: "blocked",
            checkpointPolicy: "on-failure",
            checkIds: ["phase-2-check-1"],
            workItems: [
              {
                ...firstPhase.workItems[0]!,
                id: "phase-2-work-item-1",
                title: "Implement fixture",
                status: "blocked",
                checkIds: ["phase-2-check-1"],
                invalidationReason: "The approved fixture does not match the codebase.",
              },
            ],
          },
        ],
        checks: [
          {
            id: "phase-2-check-1",
            phaseId: "phase-2",
            workItemId: "phase-2-work-item-1",
            kind: "automated",
            status: "fail",
            label: "fixture.mismatch",
            command: "fixture.mismatch",
            output: "Expected the approved fixture, found a mismatch.",
            note: null,
            exitCode: 1,
            commitSha: null,
            startedAt: "2026-07-30T17:01:00.000Z",
            completedAt: "2026-07-30T17:01:01.000Z",
            attemptIds: [],
          },
        ],
        amendments: [
          {
            id: "amendment-1",
            basePlanRevisionId: "plan-revision-1",
            triggeringPhaseId: "phase-2",
            triggeringWorkItemId: "phase-2-work-item-1",
            triggeringCheckId: "phase-2-check-1",
            expected: "approved fixture",
            found: "mismatched fixture",
            impact: "The work item cannot complete.",
            proposedChanges: "Update the approved fixture.",
            affectedPhaseIds: ["phase-2"],
            affectedWorkItemIds: ["phase-2-work-item-1"],
            dependentCheckIds: ["phase-2-check-1"],
            status: "requested",
            artifactRevisionId: "amendment-revision-1",
            planDiff: null,
            requestedAt: "2026-07-30T17:02:00.000Z",
            approvedAt: null,
            approvedBy: null,
          },
        ],
        amendmentGateId: "amendment-1",
      },
    });

    await expect.element(page.getByTestId("task-build-panel")).toBeVisible();
    await expect.element(page.getByTestId("task-build-phase-phase-2")).toBeVisible();
    await expect.element(page.getByTestId("task-build-amendment-gate")).toBeVisible();
    await expect
      .element(page.getByTestId("task-build-amendment-expected"))
      .toHaveTextContent("approved fixture");
    await expect
      .element(page.getByText("Expected the approved fixture, found a mismatch."))
      .toBeVisible();
    await page.getByTestId("task-build-amendment-approve-amendment-1").click();

    expect(mocks.dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.amendment.approve",
        amendmentId: "amendment-1",
      }),
    );
  });

  it("renders the Questions stage and dispatches a versioned artifact command", async () => {
    await renderTask(baseTask);

    expect(mocks.useClerk).not.toHaveBeenCalled();
    await expect.element(page.getByText("Questions session")).toBeVisible();
    await page.getByTestId("task-questions-editor").fill("# Questions\n\nNo blockers.");
    await page.getByTestId("task-save-questions").click();

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.artifact.upsert",
      taskId: "task-browser",
      kind: "questions",
      markdown: "# Questions\n\nNo blockers.",
    });
  });

  it("renders the artifacts panel with revision lineage and the sessions navigator", async () => {
    // Router-linked "Open" buttons need a RouterProvider; render without a
    // primary environment so the navigator lists sessions without those links.
    mocks.primaryEnvironmentId = null;
    await renderTask({
      ...baseTask,
      workflowRuns: [
        {
          ...baseTask.workflowRuns[0]!,
          currentStage: "plan",
        },
      ],
      sessions: [
        {
          id: "session-1",
          stage: "plan",
          threadId: ThreadId.make("thread-plan-primary"),
          role: "primary",
          provider: "codex",
          status: "active",
          parentSessionId: null,
          forkPoint: null,
          contextManifestId: null,
          createdAt: "2026-07-28T17:05:00.000Z",
        },
      ],
      artifacts: [
        {
          id: "artifact-plan",
          kind: "plan",
          currentRevision: 2,
          revisions: [
            {
              id: "artifact-plan-r1",
              kind: "plan",
              title: "Implementation plan",
              markdown: "# Plan v1",
              revision: 1,
              sourceSessionId: "session-1",
              supersedesRevisionId: null,
              blockIndex: [],
              createdAt: "2026-07-28T17:06:00.000Z",
            },
            {
              id: "artifact-plan-r2",
              kind: "plan",
              title: "Implementation plan",
              markdown: "# Plan v2",
              revision: 2,
              sourceSessionId: "session-1",
              supersedesRevisionId: "artifact-plan-r1",
              blockIndex: [],
              createdAt: "2026-07-28T17:07:00.000Z",
            },
          ],
        },
      ],
    });

    await expect.element(page.getByTestId("task-artifacts-panel")).toBeVisible();
    await expect.element(page.getByTestId("task-artifact-revision-1")).toBeVisible();
    await expect.element(page.getByTestId("task-artifact-revision-2")).toBeVisible();

    const sessionsPanel = page.getByTestId("task-sessions-panel");
    await expect.element(sessionsPanel).toBeVisible();
    await expect
      .element(sessionsPanel.getByText(/provider codex .* thread thread-pla/))
      .toBeVisible();

    await page.getByTestId("task-artifact-revision-1").click();
    await page.getByTestId("task-select-revision").click();
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.artifact.select-revision",
      kind: "plan",
      revision: 1,
    });

    await expect.element(page.getByLabelText("Manifest revision")).toHaveValue("2");
    await page.getByRole("button", { name: "Inspect" }).click();
    await expect.element(page.getByLabelText("Manifest target session")).toHaveValue("");
  });

  it("uses the primary stage session even when an alternative was linked first", async () => {
    mocks.primaryEnvironmentId = null;
    await renderTask({
      ...baseTask,
      workflowRuns: [{ ...baseTask.workflowRuns[0]!, currentStage: "plan" }],
      sessions: [
        {
          id: "session-alternative",
          stage: "plan",
          threadId: ThreadId.make("thread-alternative"),
          role: "alternative",
          provider: null,
          status: "active",
          parentSessionId: null,
          forkPoint: null,
          contextManifestId: "manifest-1",
          createdAt: "2026-07-28T17:05:00.000Z",
        },
        {
          id: "session-primary",
          stage: "plan",
          threadId: ThreadId.make("thread-primary"),
          role: "primary",
          provider: null,
          status: "active",
          parentSessionId: null,
          forkPoint: null,
          contextManifestId: null,
          createdAt: "2026-07-28T17:06:00.000Z",
        },
      ],
      artifacts: [
        {
          id: "plan-artifact",
          kind: "plan",
          currentRevision: 1,
          revisions: [
            {
              id: "plan-revision-1",
              kind: "plan",
              title: "Plan",
              markdown: "# Plan",
              revision: 1,
              sourceSessionId: "session-primary",
              supersedesRevisionId: null,
              blockIndex: [],
              createdAt: "2026-07-28T17:07:00.000Z",
            },
          ],
        },
      ],
      contextManifests: [
        {
          id: "manifest-1",
          taskId: baseTask.id,
          sessionId: null,
          artifactRefs: [{ kind: "plan", revision: 1, blockIds: [] }],
          notes: null,
          tokenEstimate: 0,
          budget: null,
          summaryArtifactRef: null,
          compressedBlockCount: 0,
          createdAt: "2026-07-28T17:04:00.000Z",
        },
      ],
    });

    await page.getByTestId("task-plan-editor").fill("# Updated plan");
    await page.getByTestId("task-save-plan").click();
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.artifact.upsert",
      sourceSessionId: "session-primary",
    });
  });

  it("preserves comment input when command dispatch fails", async () => {
    mocks.dispatchCommand.mockRejectedValueOnce(new Error("Rejected comment"));
    await renderTask({
      ...baseTask,
      workflowRuns: [{ ...baseTask.workflowRuns[0]!, currentStage: "plan" }],
      artifacts: [
        {
          id: "plan-artifact",
          kind: "plan",
          currentRevision: 1,
          revisions: [
            {
              id: "plan-revision-1",
              kind: "plan",
              title: "Plan",
              markdown: "<!-- kata:block:intro -->\n# Intro\nBody.",
              revision: 1,
              sourceSessionId: null,
              supersedesRevisionId: null,
              blockIndex: [
                {
                  id: "intro",
                  headingPath: ["Intro"],
                  contentHash: "abc123",
                },
              ],
              createdAt: "2026-07-28T17:07:00.000Z",
            },
          ],
        },
      ],
    });

    await page.getByLabelText("Comment block").selectOptions("intro");
    await page.getByLabelText("Comment body").fill("Keep this text");
    await page.getByTestId("task-comment-create").click();

    await expect.element(page.getByLabelText("Comment block")).toHaveValue("intro");
    await expect.element(page.getByLabelText("Comment body")).toHaveValue("Keep this text");
    await expect
      .element(page.getByTestId("task-command-error"))
      .toHaveTextContent("Rejected comment");
  });

  it("renders exact-SHA Verified signoff and keeps Deliver unavailable", async () => {
    const commitSha = "0123456789abcdef0123456789abcdef01234567";
    await renderTask({
      ...baseTask,
      workspace: {
        repositories: [
          {
            ...baseTask.workspace.repositories[0]!,
            branch: "katacode/task-task-browser",
            worktreePath: "/repo/worktrees/task-browser",
            provisioningStatus: "provisioned",
          },
        ],
      },
      workflowRuns: [
        {
          ...baseTask.workflowRuns[0]!,
          currentStage: "verified",
          updatedAt: "2026-07-28T17:00:11.000Z",
        },
      ],
      build: {
        ...baseTask.build,
        phases: [
          {
            ...baseTask.build.phases[0]!,
            status: "completed",
            workItems: [
              {
                ...baseTask.build.phases[0]!.workItems[0]!,
                status: "completed",
                summary: `Committed at ${commitSha.slice(0, 12)}.`,
              },
            ],
          },
        ],
        resultingCommitSha: commitSha,
      },
      verification: {
        ...baseTask.verification,
        results: [
          {
            id: "verification-1",
            criterionId: "criterion-1",
            status: "pass",
            commitSha,
            summary: "Fixture matched at the exact commit.",
            verifiedAt: "2026-07-28T17:00:10.000Z",
          },
        ],
        signedOffAt: "2026-07-28T17:00:11.000Z",
      },
      updatedAt: "2026-07-28T17:00:11.000Z",
    });

    await expect.element(page.getByTestId("task-verified-state")).toBeVisible();
    await expect.element(page.getByText(/All criteria passed at 0123456789ab/)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Deliver unavailable" })).toBeDisabled();
  });

  // TW-S3-AC02: the rail comes from the task's pinned definition, so a Guided
  // task shows Research and Design where Standard shows neither.
  it("renders the Guided rail from the pinned definition and completes a reasoning stage", async () => {
    await renderTask({
      ...baseTask,
      versions: { ...baseTask.versions, workflowDefinition: "guided@0.1.0" },
      workflowRuns: [
        {
          ...baseTask.workflowRuns[0]!,
          id: "guided-run-1",
          preset: "guided",
          definitionVersion: "guided@0.1.0",
          currentStage: "research",
        },
      ],
    });

    await expect
      .element(page.getByTestId("task-workflow-summary"))
      .toHaveTextContent(/Guided · guided@0\.1\.0/);
    await expect.element(page.getByTestId("task-workflow-rail-research")).toBeVisible();
    await expect.element(page.getByTestId("task-workflow-rail-design")).toBeVisible();

    await page.getByTestId("task-research-editor").fill("# Research\n\nPrior art.");
    await page.getByTestId("task-save-research").click();
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.artifact.upsert",
      kind: "research",
      markdown: "# Research\n\nPrior art.",
    });
  });

  it("does not show reasoning stages on a Standard task", async () => {
    await renderTask(baseTask);

    await expect.element(page.getByTestId("task-workflow-rail-questions")).toBeVisible();
    expect(page.getByTestId("task-workflow-rail-research").query()).toBeNull();
    expect(page.getByTestId("task-research-editor").query()).toBeNull();
    expect(page.getByTestId("task-workflow-timeline").query()).toBeNull();
  });

  // TW-S3-AC05: Freeform shows a timeline with explicit entry, not a rail that
  // advances on its own.
  it("renders the Freeform timeline and dispatches an explicit stage start", async () => {
    await renderTask({
      ...baseTask,
      versions: { ...baseTask.versions, workflowDefinition: "freeform@0.1.0" },
      workflowRuns: [
        {
          ...baseTask.workflowRuns[0]!,
          id: "freeform-run-1",
          preset: "freeform",
          definitionVersion: "freeform@0.1.0",
          currentStage: "questions",
        },
      ],
    });

    await expect.element(page.getByTestId("task-workflow-timeline")).toBeVisible();
    expect(page.getByTestId("task-workflow-rail").query()).toBeNull();
    expect(page.getByTestId("task-complete-questions").query()).toBeNull();
    // Build is never an explicit entry: it is reached by approving a plan.
    expect(page.getByTestId("task-start-stage-build").query()).toBeNull();
    // Nor is the stage the task is already in.
    expect(page.getByTestId("task-start-stage-questions").query()).toBeNull();

    await page.getByTestId("task-start-stage-plan").click();
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.stage.start",
      taskId: "task-browser",
      stage: "plan",
    });
  });

  // TW-S3-AC03 / TW-S3-AC04: the inspector shows provenance, and compression is
  // stated outright rather than left for someone to infer from a short manifest.
  it("shows carried blocks, the budget, and a prominent compression marker", async () => {
    await renderTask({
      ...baseTask,
      contextManifests: [
        {
          id: "manifest-1",
          taskId: "task-browser",
          sessionId: null,
          artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["intro"] }],
          notes: null,
          tokenEstimate: 120,
          budget: 32_000,
          summaryArtifactRef: null,
          compressedBlockCount: 0,
          createdAt: "2026-07-28T17:10:00.000Z",
        },
        {
          id: "manifest-2",
          taskId: "task-browser",
          sessionId: null,
          artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["alpha", "beta", "gamma"] }],
          notes: null,
          tokenEstimate: 90_000,
          budget: 32_000,
          summaryArtifactRef: { kind: "summary", revision: 1, blockIds: [] },
          compressedBlockCount: 3,
          createdAt: "2026-07-28T17:11:00.000Z",
        },
      ],
    });

    await expect.element(page.getByTestId("task-context-manifests-panel")).toBeVisible();
    await expect
      .element(page.getByTestId("task-context-manifest-manifest-1-budget"))
      .toHaveTextContent("120 / 32000 tokens");

    // The uncompressed manifest carries no marker...
    expect(page.getByTestId("task-context-manifest-manifest-1-compressed").query()).toBeNull();
    // ...and the compressed one says so, naming the count and the summary.
    await expect
      .element(page.getByTestId("task-context-manifest-manifest-2-compressed"))
      .toHaveTextContent(/3 blocks compressed/);
    await expect
      .element(page.getByTestId("task-context-manifest-manifest-2-compressed"))
      .toHaveTextContent(/summary r1/);
    await expect
      .element(page.getByTestId("task-context-compressed-summary"))
      .toHaveTextContent("1 compressed");

    // Provenance is inspectable: the blocks the summary replaced are still listed.
    await page.getByTestId("task-context-manifest-manifest-2").getByRole("button").click();
    await expect
      .element(page.getByTestId("task-context-manifest-manifest-2"))
      .toHaveTextContent(/alpha, beta, gamma/);
  });

  it("renders an unbudgeted Slice 2 manifest without inventing a budget", async () => {
    await renderTask({
      ...baseTask,
      contextManifests: [
        {
          id: "manifest-1",
          taskId: "task-browser",
          sessionId: null,
          artifactRefs: [{ kind: "questions", revision: 1, blockIds: ["intro"] }],
          notes: null,
          tokenEstimate: 0,
          budget: null,
          summaryArtifactRef: null,
          compressedBlockCount: 0,
          createdAt: "2026-07-28T17:10:00.000Z",
        },
      ],
    });

    await expect
      .element(page.getByTestId("task-context-manifest-manifest-1-budget"))
      .toHaveTextContent("unbudgeted");
  });

  it("uses the conversation-first Guided surface without manual stage controls", async () => {
    const threadId = ThreadId.make("guided-thread-1");
    await renderTask({
      ...baseTask,
      title: "Guided browser task",
      versions: {
        taskContract: "task-workspace@0.3.0",
        artifactContract: "task-artifact@0.3.0",
        workflowDefinition: "guided@0.2.0",
        prompt: "task-workspace-guided@0.2.0",
      },
      intake: {
        brief: "Clarify the browser task.",
        source: { kind: "inline", body: "Clarify the browser task." },
      },
      preferences: {
        worktreePolicy: "later",
        modelSelection: {
          instanceId: ProviderInstanceId.make("instance-1"),
          model: "claude-sonnet-4",
          options: [],
        },
        executionProfile: "planning",
      },
      bootstrap: {
        operationKey: "task-browser:bootstrap:questions:0:primary",
        executionProfile: "planning",
        presentation: "stage",
        status: "ready",
        currentStep: null,
        reservedSessionId: "task-browser-session-questions-0",
        reservedThreadId: threadId,
        threadCreateCommandId: CommandId.make("thread-create-1"),
        turnStartCommandId: CommandId.make("turn-start-1"),
        kickoffMessageId: MessageId.make("kickoff-1"),
        conversationTarget: { environmentId: EnvironmentId.make("environment-local"), threadId },
        attemptCount: 1,
        failure: null,
        updatedAt: "2026-07-28T17:00:00.000Z",
      },
      occurrences: [
        {
          id: "occurrence-questions-0",
          stage: "questions",
          ordinal: 0,
          status: "running",
          sessionId: "task-browser-session-questions-0",
          threadId,
          contextManifestId: null,
          artifactRevisionId: null,
          completionProposalId: null,
          gateOutcome: null,
          feedback: null,
          supersedesOccurrenceId: null,
          createdAt: "2026-07-28T17:00:00.000Z",
          completedAt: null,
        },
      ],
      sessions: [
        {
          id: "task-browser-session-questions-0",
          stage: "questions",
          threadId,
          role: "primary",
          provider: "claudeAgent",
          status: "active",
          parentSessionId: null,
          forkPoint: null,
          contextManifestId: null,
          createdAt: "2026-07-28T17:00:00.000Z",
        },
      ],
      workflowRuns: [
        {
          ...baseTask.workflowRuns[0]!,
          id: "guided-run-1",
          preset: "guided",
          definitionVersion: "guided@0.2.0",
          promptBundleVersion: "task-workspace-guided@0.2.0",
          currentStage: "questions",
        },
      ],
    });

    await expect.element(page.getByTestId("guided-task-panel")).toBeVisible();
    await expect.element(page.getByTestId("guided-stage-questions")).toBeVisible();
    await expect.element(page.getByTestId("guided-stage-research")).toBeVisible();
    await expect.element(page.getByTestId("guided-stage-design")).toBeVisible();
    await expect.element(page.getByTestId("guided-stage-plan")).toBeVisible();
    await expect.element(page.getByTestId("task-conversation-starting")).toBeVisible();
    expect(page.getByTestId("task-questions-editor").query()).toBeNull();
    expect(page.getByText(/Link an existing repository thread/).query()).toBeNull();
    expect(page.getByTestId("task-context-manifests-panel").query()).toBeNull();
  });
});
