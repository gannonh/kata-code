import "../../index.css";

import { page } from "vite-plus/test/browser";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { SidebarProvider } from "../ui/sidebar";
import { TaskWorkspaceNewView } from "./TaskWorkspaceNewView";

const mocks = vi.hoisted(() => ({
  dispatchCommand: vi.fn<(command: unknown) => Promise<void>>(async () => undefined),
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
  // TW-S3-AC01: all three presets, each with a description and its resolved
  // definition version.
  it("offers Standard, Guided, and Freeform with descriptions and versions", async () => {
    await renderNewView();

    await expect.element(page.getByTestId("task-workflow-picker")).toBeVisible();

    for (const [preset, label, version] of [
      ["standard", "Standard", "standard@0.1.0"],
      ["guided", "Guided", "guided@0.1.0"],
      ["freeform", "Freeform", "freeform@0.1.0"],
    ] as const) {
      const option = page.getByTestId(`task-workflow-option-${preset}`);
      await expect.element(option).toBeVisible();
      await expect.element(option).toHaveTextContent(label);
      await expect.element(option).toHaveTextContent(version);
    }

    // Descriptions distinguish the presets rather than just naming them.
    await expect
      .element(page.getByTestId("task-workflow-option-guided"))
      .toHaveTextContent(/Research and Design/);
    await expect
      .element(page.getByTestId("task-workflow-option-freeform"))
      .toHaveTextContent(/No automatic rail/);

    // Standard is the default, and its resolved version is displayed.
    await expect
      .element(page.getByTestId("task-resolved-definition"))
      .toHaveTextContent("Standard · standard@0.1.0");
  });

  it("shows the resolved definition for the selected preset", async () => {
    await renderNewView();

    await page.getByTestId("task-workflow-option-guided").click();
    await expect
      .element(page.getByTestId("task-resolved-definition"))
      .toHaveTextContent("Guided · guided@0.1.0");

    await page.getByTestId("task-workflow-option-freeform").click();
    await expect
      .element(page.getByTestId("task-resolved-definition"))
      .toHaveTextContent("Freeform · freeform@0.1.0");
  });

  it("creates the task with the chosen preset rather than a hardcoded Standard", async () => {
    await renderNewView();

    await page.getByTestId("task-workflow-option-guided").click();
    await page.getByTestId("task-create-submit").click();

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.create",
      preset: "guided",
      projectId: "project-1",
      workspaceRoot: "/repo/kata-code",
      approvalPolicy: "before-build",
    });
    expect(mocks.navigate).toHaveBeenCalledTimes(1);
  });

  it("still creates a Standard task when the default is left alone", async () => {
    await renderNewView();

    await page.getByTestId("task-create-submit").click();

    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.create",
      preset: "standard",
    });
  });
});
