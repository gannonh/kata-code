import "../../index.css";

import { EnvironmentId, ProjectId, type TaskWorkspace } from "@kata-sh/code-contracts";
import { page } from "vite-plus/test/browser";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { useTaskWorkspaceStore } from "../../taskWorkspace/taskWorkspaceStore";
import { SidebarProvider } from "../ui/sidebar";
import { TaskWorkspaceView } from "./TaskWorkspaceView";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn<(command: unknown) => Promise<void>>(async () => undefined),
}));

vi.mock("../../environments/primary", () => ({
  usePrimaryEnvironmentId: () => EnvironmentId.make("environment-local"),
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
