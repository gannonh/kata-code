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
  orchestrationDispatchCommand: vi.fn<(command: unknown) => Promise<void>>(async () => undefined),
  primaryEnvironmentId: "environment-local" as string | null,
  threadShellById: {} as Record<string, unknown>,
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

vi.mock("../../environmentApi", () => ({
  readEnvironmentApi: () => ({
    orchestration: { dispatchCommand: mocks.orchestrationDispatchCommand },
  }),
}));

vi.mock("../../store", () => {
  const environmentState = () => ({
    threadShellById: mocks.threadShellById,
    threadSessionById: {},
    threadTurnStateById: {},
    messageIdsByThreadId: {},
    messageByThreadId: {},
    activityIdsByThreadId: {},
    activityByThreadId: {},
    proposedPlanIdsByThreadId: {},
    proposedPlanByThreadId: {},
    turnDiffIdsByThreadId: {},
    turnDiffSummaryByThreadId: {},
  });
  const appState = () => ({
    environmentStateById: { "environment-local": environmentState() },
  });
  return {
    selectEnvironmentState: () => environmentState(),
    selectSidebarThreadsAcrossEnvironments: () => [],
    useStore: (selector?: unknown) => (typeof selector === "function" ? selector(appState()) : []),
  };
});

vi.mock("../ChatView", () => ({
  default: ({ threadId, readOnly }: { readonly threadId: string; readonly readOnly?: boolean }) => (
    <div data-testid="mock-task-chat" data-read-only={readOnly ? "true" : "false"}>
      {threadId}
    </div>
  ),
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
  preferences: {
    worktreePolicy: "later",
    modelSelection: null,
    executionProfile: "planning",
    runtimeMode: "full-access",
  },
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

/** Desktop width: the Task panel is docked beside the conversation. */
const DESKTOP_VIEWPORT = { width: 1280, height: 900 } as const;
/** Below `lg`: the panel moves behind the header trigger as a sheet. */
const NARROW_VIEWPORT = { width: 820, height: 900 } as const;

async function renderTask(
  task: TaskWorkspace,
  viewport: { readonly width: number; readonly height: number } = DESKTOP_VIEWPORT,
) {
  await page.viewport(viewport.width, viewport.height);
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

function guidedTask(overrides: Partial<TaskWorkspace> = {}): TaskWorkspace {
  return {
    ...baseTask,
    title: "Guided browser task",
    versions: {
      taskContract: "task-workspace@0.3.0",
      artifactContract: "task-artifact@0.3.0",
      workflowDefinition: "guided@0.3.0",
      prompt: "task-workspace-guided@0.3.0",
    },
    intake: {
      brief: "Implement the browser task.",
      source: { kind: "inline", body: "Implement the browser task." },
    },
    preferences: {
      worktreePolicy: "later",
      modelSelection: {
        instanceId: ProviderInstanceId.make("instance-1"),
        model: "claude-sonnet-4",
        options: [],
      },
      executionProfile: "task-worktree-write",
      runtimeMode: "full-access",
    },
    workspace: {
      repositories: [
        {
          ...baseTask.workspace.repositories[0]!,
          branch: "katacode/task-task-browser",
          worktreePath: "/repo/worktrees/task-browser",
          provisioningStatus: "ready",
          baseCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    },
    workflowRuns: [
      {
        ...baseTask.workflowRuns[0]!,
        id: "guided-run-1",
        preset: "guided",
        definitionVersion: "guided@0.3.0",
        promptBundleVersion: "task-workspace-guided@0.3.0",
        currentStage: "build",
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
            title: "Implementation plan",
            markdown:
              "## Phase [phase:foundation] Foundation\n\n### Work item [work:implement] Implement",
            revision: 1,
            sourceSessionId: null,
            supersedesRevisionId: null,
            blockIndex: [],
            createdAt: "2026-07-28T17:07:00.000Z",
          },
        ],
      },
    ],
    occurrences: [
      {
        id: "occurrence-build-0",
        stage: "build",
        ordinal: 0,
        status: "running",
        sessionId: "session-build-1",
        threadId: ThreadId.make("guided-build-thread-1"),
        contextManifestId: null,
        artifactRevisionId: null,
        completionProposalId: null,
        gateOutcome: null,
        feedback: null,
        supersedesOccurrenceId: null,
        createdAt: "2026-07-28T17:08:00.000Z",
        completedAt: null,
      },
    ],
    sessions: [
      {
        id: "session-build-1",
        stage: "build",
        threadId: ThreadId.make("guided-build-thread-1"),
        role: "primary",
        provider: "claudeAgent",
        status: "active",
        parentSessionId: null,
        forkPoint: null,
        contextManifestId: null,
        createdAt: "2026-07-28T17:08:00.000Z",
      },
    ],
    build: {
      ...baseTask.build,
      currentPlanRevisionId: "plan-revision-1",
      activePhaseId: "phase:foundation",
      activeWorkItemId: "work:implement",
      phases: [
        {
          id: "phase:foundation",
          title: "Foundation",
          status: "running",
          workItems: [
            {
              id: "work:implement",
              title: "Implement approved Plan",
              status: "running",
              summary: "Working through the approved Plan.",
              dependsOn: [],
              checkIds: ["check:typecheck", "check:review"],
              invalidationReason: null,
            },
          ],
          checkpointPolicy: "never",
          checkIds: ["check:typecheck", "check:review"],
          checkpointId: null,
          phaseCommitSha: null,
          startedAt: "2026-07-28T17:08:00.000Z",
          completedAt: null,
        },
      ],
      checks: [
        {
          id: "check:typecheck",
          phaseId: "phase:foundation",
          workItemId: "work:implement",
          kind: "automated",
          status: "fail",
          label: "Typecheck",
          command: "vp run typecheck",
          output: "Typecheck failed before rerun.",
          note: null,
          exitCode: 1,
          commitSha: null,
          startedAt: "2026-07-28T17:09:00.000Z",
          completedAt: "2026-07-28T17:09:05.000Z",
          attemptIds: ["check-attempt-1"],
        },
        {
          id: "check:review",
          phaseId: "phase:foundation",
          workItemId: "work:implement",
          kind: "manual",
          status: "pending",
          label: "Review implementation",
          command: null,
          output: null,
          note: null,
          exitCode: null,
          commitSha: null,
          startedAt: null,
          completedAt: null,
          attemptIds: [],
        },
      ],
      checkAttempts: [
        {
          id: "check-attempt-1",
          checkId: "check:typecheck",
          planRevisionId: "plan-revision-1",
          startingCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          commandDigest: "digest-1",
          operationKey: "ui-check:typecheck",
          status: "fail",
          output: "Typecheck failed before rerun.",
          exitCode: 1,
          timeoutMs: 120000,
          observedStatus: null,
          startedAt: "2026-07-28T17:09:00.000Z",
          completedAt: "2026-07-28T17:09:05.000Z",
          endingCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        },
      ],
    },
    ...overrides,
  };
}

beforeEach(() => {
  mocks.dispatchCommand.mockClear();
  mocks.orchestrationDispatchCommand.mockClear();
  mocks.useClerk.mockClear();
  mocks.primaryEnvironmentId = "environment-local";
  mocks.threadShellById = {};
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

  it("shows persisted Guided Implement progress after reload and no fixture controls", async () => {
    const commitSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const completed = guidedTask({
      occurrences: [
        {
          id: "occurrence-build-0",
          stage: "build",
          ordinal: 0,
          status: "completed",
          sessionId: "session-build-1",
          threadId: ThreadId.make("guided-build-thread-1"),
          contextManifestId: null,
          artifactRevisionId: null,
          completionProposalId: null,
          gateOutcome: null,
          feedback: null,
          supersedesOccurrenceId: null,
          createdAt: "2026-07-28T17:08:00.000Z",
          completedAt: "2026-07-28T17:12:00.000Z",
        },
      ],
      build: {
        ...guidedTask().build,
        resultingCommitSha: commitSha,
        activePhaseId: null,
        activeWorkItemId: null,
        phases: [
          {
            ...guidedTask().build.phases[0]!,
            status: "completed",
            phaseCommitSha: commitSha,
            completedAt: "2026-07-28T17:12:00.000Z",
            workItems: [
              {
                ...guidedTask().build.phases[0]!.workItems[0]!,
                status: "completed",
                summary: "Implemented at the resulting commit.",
              },
            ],
          },
        ],
        checks: [
          {
            ...guidedTask().build.checks[0]!,
            status: "pass",
            output: "Typecheck passed.",
            exitCode: 0,
            commitSha,
            attemptIds: ["check-attempt-1", "check-attempt-2"],
          },
          {
            ...guidedTask().build.checks[1]!,
            status: "pass",
            note: "Reviewed manually.",
            commitSha,
            completedAt: "2026-07-28T17:11:00.000Z",
          },
        ],
        checkAttempts: [
          guidedTask().build.checkAttempts[0]!,
          {
            ...guidedTask().build.checkAttempts[0]!,
            id: "check-attempt-2",
            status: "pass",
            output: "Typecheck passed.",
            exitCode: 0,
            endingCommitSha: commitSha,
            completedAt: "2026-07-28T17:10:00.000Z",
          },
        ],
      },
    });

    await renderTask(completed);
    await expect.element(page.getByTestId("guided-implementation-panel")).toBeVisible();
    await expect.element(page.getByTestId("guided-build-phase-phase:foundation")).toBeVisible();
    await expect
      .element(page.getByTestId("guided-build-check-check:typecheck"))
      .toHaveTextContent("Typecheck passed.");
    await expect.element(page.getByTestId("guided-check-attempt-check-attempt-2")).toBeVisible();
    await expect.element(page.getByTestId("guided-implementation-complete")).toBeVisible();
    await expect.element(page.getByTestId("guided-resulting-commit")).toHaveTextContent(commitSha);
    await expect.element(page.getByText(/Guided verification is deferred/)).toBeVisible();
    expect(page.getByTestId("task-apply-fixture").query()).toBeNull();

    useTaskWorkspaceStore.getState().reset();
    useTaskWorkspaceStore.getState().applyStreamItem(EnvironmentId.make("environment-local"), {
      kind: "snapshot",
      snapshot: { sequence: 2, tasks: [completed] },
    });
    await expect.element(page.getByTestId("guided-implementation-complete")).toBeVisible();
    await expect.element(page.getByTestId("guided-resulting-commit")).toHaveTextContent(commitSha);
  });

  it("explains disabled Guided Implement controls", async () => {
    await renderTask(
      guidedTask({
        build: {
          ...guidedTask().build,
          activePhaseId: null,
          activeWorkItemId: null,
          phases: [
            {
              ...guidedTask().build.phases[0]!,
              status: "pending",
              workItems: [
                {
                  ...guidedTask().build.phases[0]!.workItems[0]!,
                  status: "pending",
                },
              ],
            },
          ],
          checkpoints: [
            {
              id: "checkpoint-1",
              phaseId: "phase:foundation",
              reason: "Human checkpoint reached.",
              status: "waiting",
              checkIds: ["check:typecheck"],
              continuationSessionId: null,
              contextManifestId: null,
              observedCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              createdAt: "2026-07-28T17:12:00.000Z",
              continuedAt: null,
            },
          ],
        },
      }),
    );

    expect(page.getByTestId("guided-check-run-disabled-reason-check:typecheck").query()).toBeNull();
    await page.getByTestId("guided-check-run-check:typecheck").click();
    await page.getByTestId("guided-check-run-check:typecheck").click();
    const runCommands = mocks.dispatchCommand.mock.calls
      .map((call) => call[0])
      .filter(
        (command): command is { type: string; operationKey: string } =>
          typeof command === "object" &&
          command !== null &&
          "type" in command &&
          command.type === "task.implementation.check.run" &&
          "operationKey" in command,
      );
    expect(runCommands).toHaveLength(2);
    expect(runCommands[0]!.operationKey).not.toBe(runCommands[1]!.operationKey);
    await expect
      .element(page.getByTestId("guided-check-record-disabled-reason-check:review"))
      .toHaveTextContent("Implementation is paused at a waiting checkpoint.");
    await expect
      .element(page.getByTestId("guided-checkpoint-observed-checkpoint-1"))
      .toHaveTextContent("Observed aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    await expect
      .element(page.getByTestId("guided-checkpoint-disabled-reason-checkpoint-1"))
      .toHaveTextContent("Pass the checkpoint checks and complete finished phases first.");
    await expect
      .element(page.getByTestId("guided-complete-disabled-reason"))
      .toHaveTextContent("Continue the waiting checkpoint first.");
  });

  it("enables checkpoint continuation after failed-check recovery passes", async () => {
    const commitSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    await renderTask(
      guidedTask({
        build: {
          ...guidedTask().build,
          activePhaseId: "phase:foundation",
          activeWorkItemId: null,
          phases: [
            {
              ...guidedTask().build.phases[0]!,
              status: "running",
              checkpointPolicy: "on-failure",
              workItems: [
                {
                  ...guidedTask().build.phases[0]!.workItems[0]!,
                  status: "pending",
                  invalidationReason: null,
                },
              ],
            },
          ],
          checks: guidedTask().build.checks.map((check) => ({
            ...check,
            status: "pass" as const,
            commitSha,
          })),
          checkpoints: [
            {
              id: "checkpoint-1",
              phaseId: "phase:foundation",
              reason: "A required Build check failed.",
              status: "waiting",
              checkIds: ["check:typecheck"],
              continuationSessionId: null,
              contextManifestId: null,
              observedCommitSha: commitSha,
              createdAt: "2026-07-28T17:12:00.000Z",
              continuedAt: null,
            },
          ],
        },
      }),
    );

    expect(page.getByTestId("guided-checkpoint-disabled-reason-checkpoint-1").query()).toBeNull();
    await page.getByTestId("guided-checkpoint-continue-checkpoint-1").click();
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.build.checkpoint.continue",
      checkpointId: "checkpoint-1",
      expectedTaskRevision: expect.any(Number),
      operationKey: expect.any(String),
    });
  });

  it("holds the checkpoint control while continuation bootstrap starts", async () => {
    await renderTask(
      guidedTask({
        build: {
          ...guidedTask().build,
          activePhaseId: null,
          activeWorkItemId: null,
          phases: [
            {
              ...guidedTask().build.phases[0]!,
              status: "completed",
              workItems: [
                {
                  ...guidedTask().build.phases[0]!.workItems[0]!,
                  status: "completed",
                },
              ],
            },
          ],
          checkpoints: [
            {
              id: "checkpoint-1",
              phaseId: "phase:foundation",
              reason: "Human checkpoint reached.",
              status: "waiting",
              checkIds: [],
              continuationSessionId: "session-build-continuation-1",
              contextManifestId: "manifest-checkpoint-1",
              observedCommitSha: null,
              createdAt: "2026-07-28T17:12:00.000Z",
              continuedAt: null,
            },
          ],
        },
      }),
    );

    await expect
      .element(page.getByTestId("guided-checkpoint-disabled-reason-checkpoint-1"))
      .toHaveTextContent("Checkpoint continuation is starting.");
    await expect
      .element(page.getByTestId("guided-checkpoint-continue-checkpoint-1"))
      .toBeDisabled();
    expect(mocks.dispatchCommand).not.toHaveBeenCalled();
  });

  it("dispatches server-owned checkpoint continuation without raw manifest controls", async () => {
    const commitSha = "cccccccccccccccccccccccccccccccccccccccc";
    await renderTask(
      guidedTask({
        build: {
          ...guidedTask().build,
          activePhaseId: null,
          activeWorkItemId: null,
          phases: [
            {
              ...guidedTask().build.phases[0]!,
              status: "completed",
              workItems: [
                {
                  ...guidedTask().build.phases[0]!.workItems[0]!,
                  status: "completed",
                },
              ],
            },
          ],
          checks: guidedTask().build.checks.map((check) => ({
            ...check,
            status: "pass" as const,
            commitSha,
          })),
          checkpoints: [
            {
              id: "checkpoint-1",
              phaseId: "phase:foundation",
              reason: "Human checkpoint reached.",
              status: "waiting",
              checkIds: ["check:typecheck"],
              continuationSessionId: null,
              contextManifestId: null,
              observedCommitSha: commitSha,
              createdAt: "2026-07-28T17:12:00.000Z",
              continuedAt: null,
            },
          ],
        },
      }),
    );

    await expect
      .element(page.getByTestId("guided-checkpoint-observed-checkpoint-1"))
      .toHaveTextContent(`Observed ${commitSha}`);
    await page.getByTestId("guided-checkpoint-continue-checkpoint-1").click();
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.build.checkpoint.continue",
      checkpointId: "checkpoint-1",
      expectedTaskRevision: expect.any(Number),
      operationKey: expect.any(String),
    });
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).not.toHaveProperty("contextManifestId");
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).not.toHaveProperty("threadId");
  });

  it("routes Build to the latest active continuation thread", async () => {
    const originalThread = ThreadId.make("guided-build-thread-1");
    const continuationThread = ThreadId.make("guided-build-thread-2");
    mocks.threadShellById = {
      [continuationThread]: {
        id: continuationThread,
        threadId: continuationThread,
        projectId: ProjectId.make("project-1"),
        title: "Continuation",
        archivedAt: null,
        createdAt: "2026-07-28T17:12:00.000Z",
        updatedAt: "2026-07-28T17:12:00.000Z",
      },
    };
    await renderTask(
      guidedTask({
        occurrences: [
          {
            ...guidedTask().occurrences[0]!,
            sessionId: "session-build-2",
            threadId: continuationThread,
          },
        ],
        sessions: [
          {
            ...guidedTask().sessions[0]!,
            threadId: originalThread,
            status: "superseded",
          },
          {
            ...guidedTask().sessions[0]!,
            id: "session-build-2",
            threadId: continuationThread,
            status: "active",
            contextManifestId: "manifest-2",
          },
        ],
        build: {
          ...guidedTask().build,
          continuationSessionIds: ["session-build-2"],
        },
      }),
    );

    await expect.element(page.getByTestId("mock-task-chat")).toHaveTextContent(continuationThread);
  });

  it("never treats a stale inactive occurrence session as a live conversation", async () => {
    const originalThread = ThreadId.make("guided-build-thread-1");
    mocks.threadShellById = {
      [originalThread]: {
        id: originalThread,
        threadId: originalThread,
        projectId: ProjectId.make("project-1"),
        title: "Old build",
        archivedAt: null,
        createdAt: "2026-07-28T17:08:00.000Z",
        updatedAt: "2026-07-28T17:08:00.000Z",
      },
    };
    await renderTask(
      guidedTask({
        sessions: [{ ...guidedTask().sessions[0]!, status: "superseded" }],
        build: {
          ...guidedTask().build,
          continuationSessionIds: [guidedTask().sessions[0]!.id],
        },
      }),
    );

    // The stale session's transcript is still worth reading, but it is not a
    // live conversation: it is never offered as somewhere to send work.
    await expect
      .element(page.getByTestId("mock-task-chat"))
      .toHaveAttribute("data-read-only", "true");
  });

  it("dispatches Guided amendment request changes with feedback", async () => {
    await renderTask(
      guidedTask({
        build: {
          ...guidedTask().build,
          amendmentGateId: "amendment-1",
          amendments: [
            {
              id: "amendment-1",
              basePlanRevisionId: "plan-revision-1",
              triggeringPhaseId: "phase:foundation",
              triggeringWorkItemId: "work:implement",
              triggeringCheckId: "check:typecheck",
              expected: "approved behavior",
              found: "different behavior",
              impact: "Plan needs review.",
              proposedChanges: "Revise the Plan.",
              proposedPlanMarkdown: "## Phase [phase:foundation] Foundation",
              reviewFeedback: null,
              affectedPhaseIds: ["phase:foundation"],
              affectedWorkItemIds: ["work:implement"],
              dependentCheckIds: ["check:typecheck"],
              status: "requested",
              artifactRevisionId: null,
              planDiff: null,
              requestedAt: "2026-07-28T17:12:00.000Z",
              approvedAt: null,
              approvedBy: null,
            },
          ],
        },
      }),
    );

    await page.getByTestId("guided-amendment-feedback-amendment-1").fill("Keep the original API.");
    await page.getByTestId("guided-amendment-request-changes-amendment-1").click();
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.amendment.request-changes",
      amendmentId: "amendment-1",
      feedback: "Keep the original API.",
      expectedTaskRevision: expect.any(Number),
      operationKey: expect.any(String),
    });
  });

  it("surfaces invalid Plan errors when approving an amendment with a closed Plan gate", async () => {
    mocks.dispatchCommand.mockRejectedValueOnce(
      new Error("Invalid implementation Plan: amendment phase 'phase:foundation' is malformed."),
    );
    await renderTask(
      guidedTask({
        build: {
          ...guidedTask().build,
          amendmentGateId: "amendment-1",
          amendments: [
            {
              id: "amendment-1",
              basePlanRevisionId: "plan-revision-1",
              triggeringPhaseId: "phase:foundation",
              triggeringWorkItemId: "work:implement",
              triggeringCheckId: "check:typecheck",
              expected: "approved behavior",
              found: "different behavior",
              impact: "Plan needs review.",
              proposedChanges: "Revise the Plan.",
              proposedPlanMarkdown: "## Phase [phase:foundation] Foundation",
              reviewFeedback: null,
              affectedPhaseIds: ["phase:foundation"],
              affectedWorkItemIds: ["work:implement"],
              dependentCheckIds: ["check:typecheck"],
              status: "requested",
              artifactRevisionId: null,
              planDiff: null,
              requestedAt: "2026-07-28T17:12:00.000Z",
              approvedAt: null,
              approvedBy: null,
            },
          ],
        },
      }),
    );

    await page.getByTestId("guided-amendment-approve-amendment-1").click();
    await expect.element(page.getByTestId("guided-task-error")).toBeVisible();
    await expect
      .element(page.getByTestId("guided-task-error"))
      .toHaveTextContent("Invalid implementation Plan:");
    await expect.element(page.getByTestId("guided-plan-validation-error")).not.toBeInTheDocument();
  });

  it("dispatches Guided workflow upgrade before explicit Implement start for upgraded tasks", async () => {
    await renderTask({
      ...guidedTask(),
      versions: {
        taskContract: "task-workspace@0.3.0",
        artifactContract: "task-artifact@0.3.0",
        workflowDefinition: "guided@0.2.0",
        prompt: "task-workspace-guided@0.2.0",
      },
      workflowRuns: [
        {
          ...guidedTask().workflowRuns[0]!,
          definitionVersion: "guided@0.2.0",
          promptBundleVersion: "task-workspace-guided@0.2.0",
          currentStage: "plan",
        },
      ],
      occurrences: [
        {
          id: "occurrence-plan-0",
          stage: "plan",
          ordinal: 0,
          status: "completed",
          sessionId: "session-plan-1",
          threadId: ThreadId.make("guided-plan-thread-1"),
          contextManifestId: null,
          artifactRevisionId: "plan-revision-1",
          completionProposalId: null,
          gateOutcome: "approved",
          feedback: null,
          supersedesOccurrenceId: null,
          createdAt: "2026-07-28T17:08:00.000Z",
          completedAt: "2026-07-28T17:12:00.000Z",
        },
      ],
      sessions: [],
      bootstrap: null,
      build: {
        ...guidedTask().build,
        phases: [],
        checks: [],
        checkpoints: [],
        checkAttempts: [],
      },
    });

    await expect.element(page.getByTestId("guided-stage-build")).toBeVisible();
    expect(page.getByTestId("guided-stage-verify").query()).toBeNull();
    expect(page.getByTestId("guided-stage-verified").query()).toBeNull();
    await page.getByTestId("guided-start-implement-button").click();
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.workflow.upgrade",
      sourceVersion: "guided@0.2.0",
      targetVersion: "guided@0.3.0",
    });
  });

  it("keeps invalid Plan approval actionable with an inline revision path", async () => {
    mocks.dispatchCommand.mockRejectedValueOnce(
      new Error(
        "Invalid implementation Plan: manual check 'check:provider-uat' must not declare a command.",
      ),
    );
    const source = guidedTask();
    await renderTask({
      ...source,
      bootstrap: null,
      taskRevision: 7,
      workflowRuns: [
        {
          ...source.workflowRuns[0]!,
          currentStage: "plan",
        },
      ],
      occurrences: [
        {
          ...source.occurrences[0]!,
          id: "occurrence-plan-0",
          stage: "plan",
          status: "awaiting-approval",
          sessionId: "session-plan-1",
          threadId: ThreadId.make("guided-plan-thread-1"),
          artifactRevisionId: "plan-revision-1",
        },
      ],
      sessions: [
        {
          ...source.sessions[0]!,
          id: "session-plan-1",
          stage: "plan",
          threadId: ThreadId.make("guided-plan-thread-1"),
        },
      ],
      planGate: {
        occurrence: 0,
        revision: 1,
        status: "open",
        feedback: null,
        openedAt: "2026-07-28T17:10:00.000Z",
        resolvedAt: null,
      },
    });

    await page.getByTestId("guided-plan-approve").click();
    await expect.element(page.getByTestId("guided-plan-validation-error")).toBeVisible();
    await expect
      .element(page.getByTestId("guided-plan-validation-error"))
      .toHaveTextContent("This Plan cannot be approved yet.");
    // The failure names the next step, and that step is a live control rather
    // than an inert one.
    await expect
      .element(page.getByTestId("guided-plan-validation-error"))
      .toHaveTextContent("Revise from here");

    await page.getByTestId("task-stage-revise").click();
    await expect.element(page.getByTestId("task-revise-confirm")).toBeDisabled();
    await page
      .getByTestId("task-revise-feedback")
      .fill("Remove the command from the manual check.");
    await expect.element(page.getByTestId("task-revise-confirm")).toBeEnabled();
    await page.getByTestId("task-revise-confirm").click();
    expect(mocks.dispatchCommand.mock.calls.at(-1)?.[0]).toMatchObject({
      type: "task.stage.request-changes",
      feedback: "Remove the command from the manual check.",
    });
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
        runtimeMode: "full-access",
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
    await expect.element(page.getByTestId("guided-stage-build")).toBeVisible();
    expect(page.getByTestId("guided-stage-verify").query()).toBeNull();
    expect(page.getByTestId("guided-stage-verified").query()).toBeNull();
    await expect.element(page.getByTestId("task-conversation-starting")).toBeVisible();
    expect(page.getByTestId("task-questions-editor").query()).toBeNull();
    expect(page.getByText(/Link an existing repository thread/).query()).toBeNull();
    expect(page.getByTestId("task-context-manifests-panel").query()).toBeNull();
  });
});

/**
 * Shell fixture: Clarify, Research, and Design are settled history; the task is
 * waiting on the Plan gate, and Plan has already been revised once.
 */
function shellTask(overrides: Partial<TaskWorkspace> = {}): TaskWorkspace {
  const planThread = ThreadId.make("guided-plan-thread-2");
  const researchThread = ThreadId.make("guided-research-thread-1");
  return {
    ...guidedTask(),
    title: "Refine Task mode UX",
    workflowRuns: [{ ...guidedTask().workflowRuns[0]!, currentStage: "plan" }],
    planGate: {
      occurrence: 1,
      revision: 2,
      status: "open",
      feedback: null,
      openedAt: "2026-07-28T17:20:00.000Z",
      resolvedAt: null,
    },
    occurrences: [
      {
        id: "occurrence-questions-0",
        stage: "questions",
        ordinal: 0,
        status: "completed",
        sessionId: null,
        threadId: ThreadId.make("guided-questions-thread-1"),
        contextManifestId: null,
        artifactRevisionId: "questions-revision-1",
        completionProposalId: null,
        gateOutcome: null,
        feedback: null,
        supersedesOccurrenceId: null,
        createdAt: "2026-07-28T17:00:00.000Z",
        completedAt: "2026-07-28T17:02:00.000Z",
      },
      {
        id: "occurrence-research-0",
        stage: "research",
        ordinal: 0,
        status: "completed",
        sessionId: "session-research-1",
        threadId: researchThread,
        contextManifestId: null,
        artifactRevisionId: "research-revision-1",
        completionProposalId: null,
        gateOutcome: null,
        feedback: null,
        supersedesOccurrenceId: null,
        createdAt: "2026-07-28T17:03:00.000Z",
        completedAt: "2026-07-28T17:05:00.000Z",
      },
      {
        id: "occurrence-design-0",
        stage: "design",
        ordinal: 0,
        status: "completed",
        sessionId: null,
        threadId: ThreadId.make("guided-design-thread-1"),
        contextManifestId: null,
        artifactRevisionId: null,
        completionProposalId: null,
        gateOutcome: null,
        feedback: null,
        supersedesOccurrenceId: null,
        createdAt: "2026-07-28T17:06:00.000Z",
        completedAt: "2026-07-28T17:07:00.000Z",
      },
      {
        id: "occurrence-plan-0",
        stage: "plan",
        ordinal: 0,
        status: "completed",
        sessionId: null,
        threadId: ThreadId.make("guided-plan-thread-1"),
        contextManifestId: null,
        artifactRevisionId: "plan-revision-1",
        completionProposalId: null,
        gateOutcome: "changes-requested",
        feedback: "Split the migration phase.",
        supersedesOccurrenceId: null,
        createdAt: "2026-07-28T17:08:00.000Z",
        completedAt: "2026-07-28T17:10:00.000Z",
      },
      {
        id: "occurrence-plan-1",
        stage: "plan",
        ordinal: 1,
        status: "awaiting-approval",
        sessionId: "session-plan-2",
        threadId: planThread,
        contextManifestId: null,
        artifactRevisionId: "plan-revision-2",
        completionProposalId: null,
        gateOutcome: null,
        feedback: null,
        supersedesOccurrenceId: "occurrence-plan-0",
        createdAt: "2026-07-28T17:11:00.000Z",
        completedAt: null,
      },
    ],
    sessions: [
      {
        id: "session-research-1",
        stage: "research",
        threadId: researchThread,
        role: "primary",
        provider: "claudeAgent",
        status: "completed",
        parentSessionId: null,
        forkPoint: null,
        contextManifestId: null,
        createdAt: "2026-07-28T17:03:00.000Z",
      },
      {
        id: "session-plan-2",
        stage: "plan",
        threadId: planThread,
        role: "primary",
        provider: "claudeAgent",
        status: "active",
        parentSessionId: null,
        forkPoint: null,
        contextManifestId: null,
        createdAt: "2026-07-28T17:11:00.000Z",
      },
    ],
    artifacts: [
      {
        id: "questions-artifact",
        kind: "questions",
        currentRevision: 1,
        revisions: [
          {
            id: "questions-revision-1",
            kind: "questions",
            title: "Clarified scope",
            markdown: "The shell keeps stage sessions inside the Task.",
            revision: 1,
            sourceSessionId: null,
            supersedesRevisionId: null,
            blockIndex: [],
            createdAt: "2026-07-28T17:02:00.000Z",
          },
        ],
      },
      {
        id: "research-artifact",
        kind: "research",
        currentRevision: 1,
        revisions: [
          {
            id: "research-revision-1",
            kind: "research",
            title: "Research findings",
            markdown: "Peer chat rows fragmented the Task.",
            revision: 1,
            sourceSessionId: null,
            supersedesRevisionId: null,
            blockIndex: [],
            createdAt: "2026-07-28T17:05:00.000Z",
          },
        ],
      },
      {
        id: "plan-artifact",
        kind: "plan",
        currentRevision: 2,
        revisions: [
          {
            id: "plan-revision-1",
            kind: "plan",
            title: "Superseded plan",
            markdown: "One migration phase.",
            revision: 1,
            sourceSessionId: null,
            supersedesRevisionId: null,
            blockIndex: [],
            createdAt: "2026-07-28T17:08:00.000Z",
          },
          {
            id: "plan-revision-2",
            kind: "plan",
            title: "Implementation plan",
            markdown: "Two migration phases.",
            revision: 2,
            sourceSessionId: null,
            supersedesRevisionId: "plan-revision-1",
            blockIndex: [],
            createdAt: "2026-07-28T17:11:00.000Z",
          },
        ],
      },
    ],
    build: { ...baseTask.build },
    ...overrides,
  };
}

/** Registers the shell fixture's stage threads with the client thread store. */
function withShellThreads(): void {
  mocks.threadShellById = Object.fromEntries(
    [
      "guided-questions-thread-1",
      "guided-research-thread-1",
      "guided-design-thread-1",
      "guided-plan-thread-1",
      "guided-plan-thread-2",
    ].map((id) => [
      id,
      {
        id: ThreadId.make(id),
        threadId: ThreadId.make(id),
        projectId: ProjectId.make("project-1"),
        title: id,
        archivedAt: null,
        createdAt: "2026-07-28T17:00:00.000Z",
        updatedAt: "2026-07-28T17:00:00.000Z",
      },
    ]),
  );
}

describe("Task conversation-plus-panel shell", () => {
  it("keeps the active stage conversation on the canvas beside the task panel", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await expect
      .element(page.getByTestId("task-shell-title"))
      .toHaveTextContent("Refine Task mode UX");
    await expect
      .element(page.getByTestId("task-shell-subtitle"))
      .toHaveTextContent("Guided · Plan");
    await expect.element(page.getByTestId("task-stage-title")).toHaveTextContent("Plan");
    await expect
      .element(page.getByTestId("mock-task-chat"))
      .toHaveTextContent("guided-plan-thread-2");
    await expect
      .element(page.getByTestId("mock-task-chat"))
      .toHaveAttribute("data-read-only", "false");
    await expect.element(page.getByTestId("task-shell-panel")).toBeVisible();
    await expect.element(page.getByTestId("guided-task-panel")).toBeVisible();
    expect(page.getByTestId("task-stage-historical-banner").query()).toBeNull();
  });

  it("names the active stage, the viewed stage, and that history is read-only", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await page.getByTestId("guided-stage-research").click();

    await expect
      .element(page.getByTestId("guided-stage-plan"))
      .toHaveAttribute("data-active", "true");
    await expect
      .element(page.getByTestId("guided-stage-research"))
      .toHaveAttribute("data-selected", "true");
    await expect
      .element(page.getByTestId("task-stage-subtitle"))
      .toHaveTextContent("Research v1 · read-only history");
    await expect
      .element(page.getByTestId("task-stage-historical-banner"))
      .toHaveTextContent("Plan is the current stage");
  });

  it("opens a completed stage on its outcome and keeps its conversation inspectable", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await page.getByTestId("guided-stage-research").click();

    await expect
      .element(page.getByTestId("task-stage-outcome-view"))
      .toHaveTextContent("Research findings");
    expect(page.getByTestId("mock-task-chat").query()).toBeNull();

    await page.getByTestId("task-stage-view-conversation").click();

    await expect
      .element(page.getByTestId("mock-task-chat"))
      .toHaveTextContent("guided-research-thread-1");
    // A historical conversation is rendered read-only: no composer, no revert,
    // no branch controls on settled stage work.
    await expect
      .element(page.getByTestId("mock-task-chat"))
      .toHaveAttribute("data-read-only", "true");
    // Inspecting history never advances or mutates the workflow.
    expect(mocks.dispatchCommand).not.toHaveBeenCalled();
  });

  it("selects an earlier occurrence of a revised stage and preserves its outcome", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await expect
      .element(page.getByTestId("guided-stage-occurrence-count-plan"))
      .toHaveTextContent("2");
    await page.getByTestId("task-stage-occurrence-select").selectOptions("occurrence-plan-0");

    await expect
      .element(page.getByTestId("task-stage-outcome-view"))
      .toHaveTextContent("Superseded plan");
    await expect.element(page.getByTestId("task-stage-subtitle")).toHaveTextContent("Plan v1");
    await expect.element(page.getByTestId("task-stage-return-to-current")).toBeVisible();
  });

  it("returns to the live path from history", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await page.getByTestId("guided-stage-questions").click();
    await expect.element(page.getByTestId("task-stage-return-to-current")).toBeVisible();
    await page.getByTestId("task-stage-return-to-current").click();

    await expect
      .element(page.getByTestId("task-stage-subtitle"))
      .toHaveTextContent("Plan v2 · current stage");
    await expect
      .element(page.getByTestId("mock-task-chat"))
      .toHaveTextContent("guided-plan-thread-2");
  });

  it("resets a manual outcome view when the workflow advances past the stage", async () => {
    withShellThreads();
    await renderTask(shellTask());

    // The user watches the live Plan as its outcome…
    await page.getByTestId("task-stage-view-outcome").click();
    await expect.element(page.getByTestId("task-stage-outcome-view")).toBeVisible();

    // …and the approval lands: the streamed update moves the live path to
    // Implement without any selection change of the user's own.
    useTaskWorkspaceStore.getState().applyStreamItem(EnvironmentId.make("environment-local"), {
      kind: "task-upserted",
      sequence: 2,
      task: {
        ...shellTask(),
        workflowRuns: [{ ...shellTask().workflowRuns[0]!, currentStage: "build" }],
      },
    });

    // The stale outcome override must not linger as an empty Implement
    // outcome; the canvas reveals the new live conversation instead.
    await expect.element(page.getByTestId("task-stage-title")).toHaveTextContent("Implement");
    await expect.element(page.getByTestId("task-stage-outcome-view")).not.toBeInTheDocument();
    await expect
      .element(page.getByTestId("task-conversation-starting"))
      .toHaveTextContent("Preparing the Implement conversation");
  });

  it("labels a completed current stage as ended rather than read-only history", async () => {
    withShellThreads();
    const task = shellTask();
    // The current Plan's session has ended, so the stage is read-only while
    // still being the live path: history copy and a no-op return button would
    // both contradict the subtitle.
    await renderTask({
      ...task,
      sessions: task.sessions.map((session) =>
        session.id === "session-plan-2" ? { ...session, status: "completed" } : session,
      ),
    });

    await expect.element(page.getByTestId("task-stage-historical-banner")).toBeVisible();
    await expect
      .element(page.getByTestId("task-stage-historical-banner"))
      .toHaveTextContent("This conversation has ended and is read-only.");
    await expect
      .element(page.getByTestId("task-stage-subtitle"))
      .toHaveTextContent("Plan v2 · current stage");
    expect(page.getByTestId("task-stage-return-to-current").query()).toBeNull();
  });

  it("explains the impact of a revision before creating the next occurrence", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await page.getByTestId("task-stage-revise").click();

    await expect.element(page.getByTestId("task-revise-branch-point")).toHaveTextContent("Plan v2");
    await expect
      .element(page.getByTestId("task-revise-preserved"))
      .toHaveTextContent("No downstream outcomes yet");

    await page.getByTestId("task-revise-feedback").fill("Split the migration phase.");
    await page.getByTestId("task-revise-confirm").click();

    await expect.poll(() => mocks.dispatchCommand.mock.calls.length).toBeGreaterThan(0);
    expect(mocks.dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "task.stage.request-changes",
        feedback: "Split the migration phase.",
      }),
    );
  });

  it("offers no revision control on history, where no command could honor it", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await page.getByTestId("guided-stage-research").click();

    expect(page.getByTestId("task-stage-revise").query()).toBeNull();
  });

  it("reaches the task panel through a sheet at narrow widths", async () => {
    withShellThreads();
    await renderTask(shellTask(), NARROW_VIEWPORT);

    // The conversation keeps the canvas and the current stage stays named.
    await expect.element(page.getByTestId("task-stage-canvas")).toBeVisible();
    await expect
      .element(page.getByTestId("task-shell-subtitle"))
      .toHaveTextContent("Guided · Plan");
    expect(page.getByTestId("task-shell-panel").query()).toBeNull();
    expect(page.getByTestId("guided-task-panel").query()).toBeNull();

    await page.getByTestId("task-shell-panel-trigger").click();

    await expect.element(page.getByTestId("task-shell-panel-sheet")).toBeVisible();
    await expect.element(page.getByTestId("guided-stage-rail")).toBeVisible();
    await expect.element(page.getByTestId("guided-plan-approve")).toBeVisible();
  });

  it("reports a failed revision beside the action that failed", async () => {
    withShellThreads();
    mocks.dispatchCommand.mockRejectedValueOnce(
      new Error("The Plan gate is 'approved' and cannot accept changes."),
    );
    await renderTask(shellTask());

    await page.getByTestId("task-stage-revise").click();
    await page.getByTestId("task-revise-feedback").fill("Split the migration phase.");
    await page.getByTestId("task-revise-confirm").click();

    await expect
      .element(page.getByTestId("task-revise-error"))
      .toHaveTextContent("cannot accept changes");
    // The dialog stays open with the feedback intact, so the next step is obvious.
    await expect.element(page.getByTestId("task-revise-confirm")).toBeVisible();
  });

  it("keeps a return path in the panel while history is being inspected", async () => {
    withShellThreads();
    await renderTask(shellTask());

    await page.getByTestId("guided-stage-research").click();

    await expect
      .element(page.getByTestId("guided-history-notice"))
      .toHaveTextContent("These actions apply to Plan");
    await page.getByTestId("guided-panel-return-to-current").click();

    await expect
      .element(page.getByTestId("task-stage-subtitle"))
      .toHaveTextContent("Plan v2 · current stage");
  });

  it("exposes the current permission and changes it across the task and open conversation", async () => {
    await renderTask(guidedTask());

    const panel = page.getByTestId("guided-task-permissions");
    await expect.element(panel).toBeVisible();
    // Shared vocabulary: the same labels as the Create Task form and composer.
    await expect.element(panel).toHaveTextContent(/Permissions/);
    await expect.element(panel).toHaveTextContent("Full access");
    await expect
      .element(page.getByTestId("task-panel-permissions-option-full-access"))
      .toHaveAttribute("data-active", "true");
    await expect
      .element(page.getByTestId("task-panel-permissions-option-approval-required"))
      .toHaveTextContent("Supervised");

    // Changing the mode persists the task-wide preference...
    await page.getByTestId("task-panel-permissions-option-approval-required").click();
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.permissions.set",
      runtimeMode: "approval-required",
      expectedTaskRevision: 0,
    });
    // ...applies it to the open stage conversation without moving workflow
    // state: one thread.runtime-mode.set for the live thread, no occurrence.
    expect(mocks.orchestrationDispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.orchestrationDispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "thread.runtime-mode.set",
      threadId: "guided-build-thread-1",
      runtimeMode: "approval-required",
    });
  });

  it("reports a rejected permission change beside the control and keeps the previous value", async () => {
    mocks.dispatchCommand.mockRejectedValueOnce(
      new Error("Task revision 0 does not match the expected revision 9."),
    );
    await renderTask(guidedTask());

    await page.getByTestId("task-panel-permissions-option-approval-required").click();

    await expect
      .element(page.getByTestId("task-panel-permissions-error"))
      .toHaveTextContent("Task revision 0 does not match the expected revision 9.");
    // The control stays on the persisted value: no task event was written.
    await expect
      .element(page.getByTestId("task-panel-permissions-option-full-access"))
      .toHaveAttribute("data-active", "true");
    // A rejected permission change must not start an occurrence or dispatch a
    // thread command for a change the task did not accept.
    expect(mocks.orchestrationDispatchCommand).not.toHaveBeenCalled();
  });
});
