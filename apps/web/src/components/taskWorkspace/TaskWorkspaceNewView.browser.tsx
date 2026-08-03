import "../../index.css";

import { page } from "vite-plus/test/browser";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { SidebarProvider } from "../ui/sidebar";
import { TaskWorkspaceNewView } from "./TaskWorkspaceNewView";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn<(command: unknown) => Promise<{ taskRoute: unknown }>>(async () => ({
    taskRoute: { environmentId: "environment-local", taskId: "guided-onboarding" },
  })),
  navigate: vi.fn(async () => undefined),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../environments/primary", () => ({
  usePrimaryEnvironmentId: () => "environment-local",
}));

vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: { taskWorkspaces: { dispatchCommand: mocks.dispatchCommand } },
  }),
}));

vi.mock("../../store", () => ({
  selectProjectsAcrossEnvironments: () => [],
  useStore: () => [
    {
      id: "project-1",
      name: "kata-code",
      cwd: "/repo/kata-code",
      environmentId: "environment-local",
    },
  ],
}));

vi.mock("../../rpc/serverState", () => ({
  useServerProviders: () => [
    {
      instanceId: "instance-1",
      driver: "codex",
      displayName: "Codex",
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      availability: "available",
      supportsTaskStage: true,
      auth: { status: "authenticated" },
      checkedAt: "2026-08-01T00:00:00.000Z",
      models: [
        {
          slug: "gpt-5.4",
          name: "GPT-5.4",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "reasoningEffort",
                type: "select",
                label: "Reasoning effort",
                options: [
                  { id: "low", label: "Low" },
                  { id: "high", label: "High" },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
}));

beforeEach(() => {
  mocks.dispatchCommand.mockClear();
  mocks.navigate.mockClear();
});

async function renderNewView() {
  return render(
    <SidebarProvider>
      <TaskWorkspaceNewView />
    </SidebarProvider>,
  );
}

describe("TaskWorkspaceNewView", () => {
  it("offers Standard, Guided, and Freeform with capability labels", async () => {
    await renderNewView();

    await expect.element(page.getByTestId("task-workflow-picker")).toBeVisible();

    for (const [preset, label, version] of [
      ["standard", "Standard", "standard@0.2.0"],
      ["guided", "Guided", "guided@0.2.0"],
      ["freeform", "Freeform", "freeform@0.2.0"],
    ] as const) {
      const option = page.getByTestId(`task-workflow-option-${preset}`);
      await expect.element(option).toBeVisible();
      await expect.element(option).toHaveTextContent(label);
      await expect.element(option).toHaveTextContent(version);
    }

    // Guided is the creation default and labeled available through approved Plan.
    await expect
      .element(page.getByTestId("task-workflow-option-guided"))
      .toHaveTextContent("Available through approved Plan");
    // Standard and Freeform are labeled preview shells.
    await expect
      .element(page.getByTestId("task-workflow-option-standard"))
      .toHaveTextContent("Preview shell");
    await expect
      .element(page.getByTestId("task-workflow-option-freeform"))
      .toHaveTextContent("Preview shell");

    await expect
      .element(page.getByTestId("task-resolved-definition"))
      .toHaveTextContent("Guided · guided@0.2.0");
  });

  it("shows the resolved definition and capability for the selected preset", async () => {
    await renderNewView();

    await page.getByTestId("task-workflow-option-standard").click();
    await expect
      .element(page.getByTestId("task-resolved-definition"))
      .toHaveTextContent("Standard · standard@0.2.0");

    await page.getByTestId("task-workflow-option-freeform").click();
    await expect
      .element(page.getByTestId("task-resolved-definition"))
      .toHaveTextContent("Freeform · freeform@0.2.0");
  });

  it("preserves a selected model option while creating a task", async () => {
    await renderNewView();

    const reasoningSelect = page.getByTestId("task-model-option-reasoningEffort");
    await reasoningSelect.selectOptions("high");
    await expect.element(reasoningSelect).toHaveValue("high");

    await page.getByTestId("task-brief-input").fill("Add a guided onboarding flow.");
    await page.getByTestId("task-create-submit").click();

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      modelSelection: {
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    });
  });

  it("creates a first-slice task and navigates to the canonical route", async () => {
    await renderNewView();

    await page.getByTestId("task-brief-input").fill("Add a guided onboarding flow.");
    await page.getByTestId("task-create-submit").click();

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.create",
      taskId: "guided-onboarding",
      preset: "guided",
      worktreePolicy: "later",
      projectId: "project-1",
      brief: "Add a guided onboarding flow.",
      source: { kind: "inline", body: "Add a guided onboarding flow." },
      modelSelection: {
        instanceId: "instance-1",
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "low" }],
      },
    });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/tasks/$environmentId/$taskId",
      params: { environmentId: "environment-local", taskId: "guided-onboarding" },
    });
  });

  it("blocks creation while the brief is empty or the slug is invalid", async () => {
    await renderNewView();

    // Empty brief keeps the button disabled.
    await expect.element(page.getByTestId("task-create-submit")).toBeDisabled();

    // An invalid slug keeps it disabled even with a brief present.
    await page.getByTestId("task-brief-input").fill("A brief.");
    await page.getByTestId("task-slug-input").fill("Invalid Slug!");
    await expect.element(page.getByTestId("task-create-submit")).toBeDisabled();
    expect(mocks.dispatchCommand).not.toHaveBeenCalled();

    // A valid slug enables creation.
    await page.getByTestId("task-slug-input").fill("valid-slug");
    await page.getByTestId("task-create-submit").click();
    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
  });

  it("offers worktree timing options with planning-only description for Never", async () => {
    await renderNewView();

    for (const policy of ["now", "later", "never"] as const) {
      await expect.element(page.getByTestId(`task-worktree-option-${policy}`)).toBeVisible();
    }
    await expect
      .element(page.getByTestId("task-worktree-option-never"))
      .toHaveTextContent(/planning-only/i);
  });
});
