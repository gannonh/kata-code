import "../../index.css";

import { ProjectId, type TaskWorkspace, ThreadId } from "@kata-sh/code-contracts";
import { page } from "vite-plus/test/browser";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { useTaskWorkspaceStore } from "../../taskWorkspace/taskWorkspaceStore";
import { SidebarProvider } from "../ui/sidebar";
import { TaskWorkspaceView } from "./TaskWorkspaceView";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn<(command: unknown) => Promise<void>>(async () => undefined),
  primaryEnvironmentId: "environment-local" as string | null,
}));

vi.mock("../../environments/primary", () => ({
  usePrimaryEnvironmentId: () => mocks.primaryEnvironmentId,
}));

vi.mock("@clerk/react", () => ({
  useClerk: () => ({ user: null }),
}));

vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: {
      taskWorkspaces: {
        dispatchCommand: mocks.dispatchCommand,
      },
    },
  }),
}));

vi.mock("../../store", () => ({
  selectSidebarThreadsAcrossEnvironments: () => [],
  useStore: () => [],
}));

const baseTask: TaskWorkspace = {
  id: "task-browser",
  title: "Browser task workspace",
  versions: {
    taskContract: "task-workspace@0.1.0",
    artifactContract: "task-artifact@0.1.0",
    workflowDefinition: "standard@0.1.0",
    prompt: "task-workspace-slice-1@0.1.0",
  },
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
          },
        ],
      },
    ],
    resultingCommitSha: null,
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
  useTaskWorkspaceStore.getState().applyStreamItem({
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
  mocks.primaryEnvironmentId = "environment-local";
  useTaskWorkspaceStore.getState().reset();
});

describe("TaskWorkspaceView", () => {
  it("renders the Questions stage and dispatches a versioned artifact command", async () => {
    await renderTask(baseTask);

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
});
