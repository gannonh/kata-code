import { execFile as execFileCallback } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  CommandId,
  ProjectId,
  TaskWorkspaceId,
  ThreadId,
  type TaskWorkspace,
  type TaskWorkspaceCommand,
  type TaskWorkspaceEvent,
} from "../../../packages/contracts/src/index.ts";
import type { Page } from "@playwright/test";

import { E2E_TAGS } from "../../src/config/tags.ts";
import { createSeededGitWorkspace } from "../../src/flows/workspace.ts";
import { registerFileSessionSeed } from "../../src/harness/fileSession.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

const execFile = promisify(execFileCallback);
const taskId = TaskWorkspaceId.make("task-e2e-slice-2");
const createdAt = "2026-07-29T20:00:00.000Z";

const seededTask: TaskWorkspace = {
  id: taskId,
  title: "Task workspaces Slice 2 E2E",
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
        projectId: ProjectId.make("project-e2e"),
        workspaceRoot: "/tmp/task-workspace-e2e",
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
      currentStage: "plan",
      approvalPolicy: "before-build",
      createdAt,
      updatedAt: createdAt,
    },
  ],
  sessions: [
    {
      id: "session-alternative",
      stage: "plan",
      threadId: ThreadId.make("thread-alternative"),
      role: "alternative",
      provider: "codex",
      status: "active",
      parentSessionId: null,
      forkPoint: null,
      contextManifestId: "manifest-1",
      createdAt,
    },
    {
      id: "session-primary",
      stage: "plan",
      threadId: ThreadId.make("thread-primary"),
      role: "primary",
      provider: "codex",
      status: "active",
      parentSessionId: null,
      forkPoint: null,
      contextManifestId: null,
      createdAt,
    },
    {
      id: "session-ad-hoc",
      stage: null,
      threadId: ThreadId.make("thread-ad-hoc"),
      role: "ad-hoc",
      provider: null,
      status: "active",
      parentSessionId: null,
      forkPoint: null,
      contextManifestId: null,
      createdAt,
    },
    {
      id: "session-review-fork",
      stage: "plan",
      threadId: ThreadId.make("thread-review-fork"),
      role: "reviewer",
      provider: "claude",
      status: "active",
      parentSessionId: "session-primary",
      forkPoint: "turn-3",
      contextManifestId: "manifest-1",
      createdAt,
    },
  ],
  artifacts: [
    {
      id: "plan-artifact",
      kind: "plan",
      currentRevision: 2,
      revisions: [
        {
          id: "plan-revision-1",
          kind: "plan",
          title: "Plan",
          markdown:
            "<!-- kata:block:intro -->\n# Intro\nOriginal body.\n<!-- kata:block:removed -->\n# Removed\nOld body.",
          revision: 1,
          sourceSessionId: "session-primary",
          supersedesRevisionId: null,
          blockIndex: [
            { id: "intro", headingPath: ["Intro"], contentHash: "hash-intro-r1" },
            { id: "removed", headingPath: ["Removed"], contentHash: "hash-removed-r1" },
          ],
          createdAt,
        },
        {
          id: "plan-revision-2",
          kind: "plan",
          title: "Plan",
          markdown: "<!-- kata:block:intro -->\n# Introduction\nRevised body.",
          revision: 2,
          sourceSessionId: "session-alternative",
          supersedesRevisionId: "plan-revision-1",
          blockIndex: [
            { id: "intro", headingPath: ["Introduction"], contentHash: "hash-intro-r2" },
          ],
          createdAt: "2026-07-29T20:01:00.000Z",
        },
      ],
    },
    {
      id: "questions-artifact",
      kind: "questions",
      currentRevision: 1,
      revisions: [
        {
          id: "questions-revision-1",
          kind: "questions",
          title: "Questions",
          markdown: "# Questions\n\nNo blockers.",
          revision: 1,
          sourceSessionId: null,
          supersedesRevisionId: null,
          blockIndex: [],
          createdAt,
        },
      ],
    },
    {
      id: "verification-artifact",
      kind: "verification",
      currentRevision: 1,
      revisions: [
        {
          id: "verification-revision-1",
          kind: "verification",
          title: "Verification",
          markdown: "# Verification\n\nPending.",
          revision: 1,
          sourceSessionId: "session-review-fork",
          supersedesRevisionId: null,
          blockIndex: [],
          createdAt,
        },
      ],
    },
  ],
  comments: [
    {
      id: "comment-outdated",
      taskId,
      artifactId: "plan-artifact",
      anchorBlockId: "intro",
      baseRevisionId: "plan-revision-1",
      status: "outdated",
      messages: [
        {
          id: "message-outdated-1",
          author: { kind: "user", id: "user-e2e", displayName: "E2E User" },
          body: "Needs update",
          createdAt,
        },
      ],
      createdAt,
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: "comment-orphaned",
      taskId,
      artifactId: "plan-artifact",
      anchorBlockId: "removed",
      baseRevisionId: "plan-revision-1",
      status: "orphaned",
      messages: [
        {
          id: "message-orphaned-1",
          author: { kind: "user", id: "user-e2e", displayName: "E2E User" },
          body: "Marker was removed",
          createdAt,
        },
      ],
      createdAt,
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: "comment-resolved",
      taskId,
      artifactId: "plan-artifact",
      anchorBlockId: "intro",
      baseRevisionId: "plan-revision-1",
      status: "resolved",
      messages: [
        {
          id: "message-resolved-1",
          author: { kind: "agent", id: "reviewer-e2e", displayName: "Reviewer" },
          body: "Reviewed finding",
          createdAt,
        },
      ],
      createdAt,
      resolvedAt: "2026-07-29T20:02:00.000Z",
      resolvedBy: { kind: "user", id: "user-e2e", displayName: "E2E User" },
    },
  ],
  contextManifests: [
    {
      id: "manifest-1",
      taskId,
      sessionId: "session-alternative",
      artifactRefs: [{ kind: "plan", revision: 1, blockIds: ["intro"] }],
      notes: "Alternative and reviewer context",
      createdAt,
    },
  ],
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
  createdAt,
  updatedAt: createdAt,
};

registerFileSessionSeed(fileURLToPath(import.meta.url), async (context) => {
  const event: TaskWorkspaceEvent = {
    sequence: 1,
    eventId: "event-e2e-slice-2",
    commandId: CommandId.make("command-e2e-slice-2"),
    taskId,
    type: "task.create",
    occurredAt: createdAt,
    task: seededTask,
  };
  for (const stateDirectory of ["dev", "userdata"]) {
    const directory = join(context.katacodeHome, stateDirectory);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "task-workspace-events.ndjson"),
      `${JSON.stringify(event)}\n`,
      "utf8",
    );
  }
});

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
  try {
    await expect(page.getByTestId("task-artifacts-panel")).toBeVisible();
  } catch (error) {
    const body = await page.locator("body").innerText();
    console.error(`[task-workspaces] route diagnostics\n${page.url()}\n${body.slice(0, 4_000)}`);
    throw error;
  }
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

test.describe(`Task workspaces Slice 2 ${E2E_TAGS.taskWorkspaces}`, () => {
  test("covers artifacts, comments, manifests, sessions, replay, and invalid commands", async ({
    appWindow,
  }) => {
    await openTask(appWindow, taskId);

    const artifacts = appWindow.getByTestId("task-artifacts-panel");
    await expect(artifacts.getByRole("button", { name: /Questions/ })).toBeVisible();
    await expect(artifacts.getByRole("button", { name: /Plan/ })).toBeVisible();
    await expect(artifacts.getByRole("button", { name: /Verification/ })).toBeVisible();
    await expect(artifacts.getByTestId("task-artifact-revision-1")).toBeVisible();
    await expect(artifacts.getByTestId("task-artifact-revision-2")).toBeVisible();
    await expect(artifacts.getByText("Original body.")).toBeVisible();
    await expect(artifacts.getByText("Revised body.")).toBeVisible();

    const sessions = appWindow.getByTestId("task-sessions-panel");
    await expect(
      sessions
        .getByTestId("task-session-session-alternative")
        .getByText("alternative", { exact: true }),
    ).toBeVisible();
    await expect(
      sessions.getByTestId("task-session-session-ad-hoc").getByText("ad-hoc", { exact: true }),
    ).toBeVisible();
    await expect(
      sessions
        .getByTestId("task-session-session-review-fork")
        .getByText("reviewer", { exact: true }),
    ).toBeVisible();
    await expect(
      sessions
        .getByTestId("task-session-session-review-fork")
        .getByText(/parent session-prim.*fork turn-3/),
    ).toBeVisible();
    await expect(sessions.getByText(/provider claude/)).toBeVisible();
    await sessions
      .getByTestId("task-session-session-alternative")
      .getByRole("button", { name: "Inspect" })
      .click();
    const inspector = appWindow.getByTestId("task-manifest-inspector");
    await expect(inspector.getByText("manifest-1")).toBeVisible();
    await expect(inspector.getByText(/plan r1.*blocks intro/)).toBeVisible();

    await expect(appWindow.getByText("Plan session")).toBeVisible();
    await expect(appWindow.getByText("outdated", { exact: true })).toBeVisible();
    await expect(appWindow.getByText("orphaned", { exact: true })).toBeVisible();
    await expect(appWindow.getByText("Reviewed finding")).toBeVisible();

    const outdatedThread = appWindow.getByTestId("task-comment-comment-outdated");
    await outdatedThread.getByRole("button", { name: "Reply" }).click();
    await outdatedThread.getByLabel("Reply body").fill("Reply survives the real command path");
    await outdatedThread.getByRole("button", { name: "Send reply" }).click();
    await expect(
      outdatedThread.locator("li span.text-muted-foreground").filter({
        hasText: "Reply survives the real command path",
      }),
    ).toBeVisible();
    await outdatedThread.getByRole("button", { name: "Resolve" }).click();
    await expect(outdatedThread.getByText("resolved", { exact: true })).toBeVisible();

    await appWindow.getByLabel("Manifest target session").selectOption("session-primary");
    await appWindow.getByLabel("Manifest block ids").fill("intro");
    await appWindow.getByRole("button", { name: "Create manifest" }).click();
    await expect(sessions.getByText(/manifest-2.*1 ref/)).toBeVisible();

    await artifacts.getByTestId("task-artifact-revision-1").click();
    await artifacts.getByTestId("task-select-revision").click();
    await expect(appWindow.getByTestId("task-plan-editor")).toHaveValue(
      seededTask.artifacts[0]!.revisions[0]!.markdown,
    );
    await expect(artifacts.getByTestId("task-artifact-revision-2")).toBeVisible();

    const duplicateComment: TaskWorkspaceCommand = {
      type: "task.comment.create",
      commandId: CommandId.make("command-e2e-duplicate-comment"),
      taskId,
      createdAt: "2026-07-29T20:03:00.000Z",
      artifactId: "plan-artifact",
      anchorBlockId: "intro",
      baseRevisionId: "plan-revision-1",
      author: { kind: "agent", id: "reviewer-e2e", displayName: "Reviewer" },
      body: "Duplicate-safe reviewer finding",
    };
    await dispatchTaskCommand(appWindow, duplicateComment);
    await dispatchTaskCommand(appWindow, duplicateComment);
    await expect(appWindow.getByText("Duplicate-safe reviewer finding")).toHaveCount(1);

    await dispatchTaskCommand(appWindow, {
      type: "task.artifact.upsert",
      commandId: CommandId.make("command-e2e-frontmatter"),
      taskId,
      createdAt: "2026-07-29T20:04:00.000Z",
      kind: "plan",
      title: "Plan",
      markdown: "---\nstatus: verified\n---\n<!-- kata:block:intro -->\n# Intro\nThird body.",
      sourceSessionId: "session-primary",
    });
    await expect(appWindow.getByText("Plan", { exact: true }).first()).toBeVisible();
    await expect(artifacts.getByRole("button", { name: /Plan.*r3/ })).toBeVisible();

    await expect(
      dispatchTaskCommand(appWindow, {
        type: "task.artifact.select-revision",
        commandId: CommandId.make("command-e2e-invalid-revision"),
        taskId,
        createdAt: "2026-07-29T20:05:00.000Z",
        kind: "plan",
        revision: 999,
      }),
    ).rejects.toThrow();
    await expect(artifacts.getByRole("button", { name: /Plan.*r3/ })).toBeVisible();
  });

  test("keeps the Slice 1 Standard path green", async ({ appWindow, runContext }) => {
    const workspaceRoot = await createSeededGitWorkspace(runContext, {
      name: "task-workspace-slice-1-regression",
      remoteUrl: "https://example.test/gannonh/task-workspace-e2e.git",
      files: { "README.md": "# Task workspace E2E\n" },
    });
    await execFile("git", ["config", "user.name", "Kata E2E"], { cwd: workspaceRoot });
    await execFile("git", ["config", "user.email", "kata-e2e@example.test"], {
      cwd: workspaceRoot,
    });
    await execFile("git", ["add", "."], { cwd: workspaceRoot });
    await execFile("git", ["commit", "-m", "test: seed task workspace"], { cwd: workspaceRoot });
    await execFile("git", ["branch", "-M", "main"], { cwd: workspaceRoot });

    const slice1TaskId = TaskWorkspaceId.make("task-e2e-slice-1-regression");
    await dispatchTaskCommand(appWindow, {
      type: "task.create",
      commandId: CommandId.make("command-e2e-slice-1-create"),
      taskId: slice1TaskId,
      createdAt: "2026-07-29T21:00:00.000Z",
      title: "Slice 1 regression",
      projectId: ProjectId.make("project-e2e-regression"),
      workspaceRoot,
      baseRef: "main",
      preset: "standard",
      approvalPolicy: "before-build",
    });
    await openTask(appWindow, slice1TaskId);

    await appWindow.getByTestId("task-questions-editor").fill("# Questions\n\nNo blockers.");
    await appWindow.getByTestId("task-save-questions").click();
    await appWindow.getByTestId("task-complete-questions").click();
    await appWindow.getByTestId("task-save-plan").click();
    await appWindow.getByTestId("task-approve-plan").click();
    // The fixture adapter no longer bypasses phase completion: complete the
    // default phase tree first.
    await appWindow.getByTestId("task-build-phase-start-phase-1").click();
    await appWindow.getByTestId("task-build-work-start-work-item-1").click();
    await appWindow.getByTestId("task-build-work-complete-work-item-1").click();
    await appWindow.getByTestId("task-apply-fixture").click();
    await appWindow.getByTestId("task-run-verification").click();
    await appWindow.getByTestId("task-signoff").click();

    await expect(appWindow.getByTestId("task-verified-state")).toBeVisible();
  });
});
