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
  providers: [
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
      supportsTaskWorktreeWrite: true,
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
    {
      instanceId: "instance-2",
      driver: "claude",
      displayName: "Claude",
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      availability: "available",
      supportsTaskStage: true,
      // Planning no longer requires worktree-write; Implement still does.
      supportsTaskWorktreeWrite: false,
      auth: { status: "authenticated" },
      checkedAt: "2026-08-01T00:00:00.000Z",
      models: [
        {
          slug: "claude-opus-4-6",
          name: "Claude Opus 4.6",
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
    {
      instanceId: "instance-3",
      driver: "pi",
      displayName: "Pi",
      enabled: true,
      installed: true,
      version: null,
      status: "ready",
      availability: "available",
      supportsTaskStage: false,
      supportsTaskWorktreeWrite: false,
      auth: { status: "authenticated" },
      checkedAt: "2026-08-01T00:00:00.000Z",
      models: [
        {
          slug: "openrouter/free",
          name: "OpenRouter Free",
          isCustom: false,
          capabilities: { optionDescriptors: [] },
        },
      ],
    },
  ],
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
  useServerProviders: () => mocks.providers,
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
      ["guided", "Guided", "guided@0.3.0"],
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
      .toHaveTextContent("Guided · guided@0.3.0");
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

  it("includes enabled planning providers in Guided creation without task-stage or worktree-write", async () => {
    await renderNewView();

    const agentSelect = page.getByTestId("task-agent-select");
    await expect.element(agentSelect).toBeVisible();
    await expect.element(agentSelect).toHaveValue("instance-1");
    const guidedOptions = Array.from(agentSelect.element().querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(guidedOptions).toEqual(["instance-1", "instance-2", "instance-3"]);

    await page.getByTestId("task-workflow-option-standard").click();
    const standardOptions = Array.from(agentSelect.element().querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(standardOptions).toEqual(["instance-1", "instance-2", "instance-3"]);
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

  it("offers Permissions with the three modes and defaults to Full access", async () => {
    await renderNewView();

    await expect.element(page.getByTestId("task-permissions-picker")).toBeVisible();
    for (const mode of ["approval-required", "auto-accept-edits", "full-access"] as const) {
      const option = page.getByTestId(`task-permissions-option-${mode}`);
      await expect.element(option).toBeVisible();
    }
    // Shared presentation vocabulary: same labels as the composer and panel.
    await expect
      .element(page.getByTestId("task-permissions-option-approval-required"))
      .toHaveTextContent("Supervised");
    await expect
      .element(page.getByTestId("task-permissions-option-auto-accept-edits"))
      .toHaveTextContent("Auto-accept edits");
    await expect
      .element(page.getByTestId("task-permissions-option-full-access"))
      .toHaveTextContent("Full access");
    await expect
      .element(page.getByTestId("task-permissions-option-full-access"))
      .toHaveAttribute("data-active", "true");
  });

  it("warns about the working checkout when planning is Later, and not when Now", async () => {
    await renderNewView();

    // Later (the default) names the working checkout.
    const laterWarning = page.getByTestId("task-permissions-checkout-warning");
    await expect.element(laterWarning).toBeVisible();
    await expect.element(laterWarning).toHaveTextContent(/working checkout/i);
    await expect.element(laterWarning).toHaveTextContent("/repo/kata-code");

    // Now removes the warning entirely; no mode is disabled either way.
    await page.getByTestId("task-worktree-option-now").click();
    expect(page.getByTestId("task-permissions-checkout-warning").query()).toBeNull();
    for (const mode of ["approval-required", "auto-accept-edits", "full-access"] as const) {
      await expect.element(page.getByTestId(`task-permissions-option-${mode}`)).toBeEnabled();
    }

    // Never plans in the checkout too, so the warning returns.
    await page.getByTestId("task-worktree-option-never").click();
    await expect.element(page.getByTestId("task-permissions-checkout-warning")).toBeVisible();
  });

  it("sends the chosen permission on task.create", async () => {
    await renderNewView();

    await page.getByTestId("task-brief-input").fill("Add a guided onboarding flow.");
    await page.getByTestId("task-permissions-option-approval-required").click();
    await page.getByTestId("task-create-submit").click();

    expect(mocks.dispatchCommand).toHaveBeenCalledTimes(1);
    expect(mocks.dispatchCommand.mock.calls[0]?.[0]).toMatchObject({
      type: "task.create",
      runtimeMode: "approval-required",
    });
  });
});
