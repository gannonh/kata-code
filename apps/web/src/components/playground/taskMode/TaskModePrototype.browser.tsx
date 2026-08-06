import "../../../index.css";

import type { ComponentProps } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { page } from "vite-plus/test/browser";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { TaskModePlaygroundPage } from "./TaskModePlaygroundPage";
import { TaskModePrototype } from "./TaskModePrototype";
import {
  getTaskModePrototypeScenario,
  listTaskModePrototypeScenarios,
} from "./taskModePlaygroundFixtures";

async function renderPrototype(
  scenarioId: Parameters<typeof getTaskModePrototypeScenario>[0],
  layout: ComponentProps<typeof TaskModePrototype>["layout"],
) {
  return render(
    <div className="flex h-dvh min-h-0" data-testid="task-mode-test-host">
      <TaskModePrototype scenario={getTaskModePrototypeScenario(scenarioId)} layout={layout} />
    </div>,
  );
}

async function renderPlaygroundPage() {
  const rootRoute = createRootRoute();
  const playgroundIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/playground",
    component: () => null,
  });
  const taskModeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/playground/task-mode",
    component: TaskModePlaygroundPage,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/playground/task-mode"] }),
    routeTree: rootRoute.addChildren([playgroundIndexRoute, taskModeRoute]),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

async function waitForLayout(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

describe("Task mode UX Playground prototypes", () => {
  beforeEach(async () => {
    await page.viewport(1_280, 900);
  });

  it("exports the complete shared fixture catalog", () => {
    expect(listTaskModePrototypeScenarios().map((scenario) => scenario.id)).toEqual([
      "design-running",
      "inspect-research",
      "plan-review",
      "implement-checkpoint",
      "branch-history",
      "failed-stage",
    ]);
  });

  it("keeps the current conversation-plus-panel layout available for refinement", async () => {
    await renderPrototype("design-running", "current-refined");

    await expect.element(page.getByTestId("task-mode-layout-current-refined")).toBeInTheDocument();
    await expect.element(page.getByTestId("task-mode-current-layout-panel")).toBeInTheDocument();
    await expect.element(page.getByTestId("task-mode-vertical-stage-rail")).toBeInTheDocument();
    await expect
      .element(page.getByTestId("task-mode-horizontal-stage-rail"))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByTestId("task-mode-stage-design"))
      .toHaveAttribute("aria-current", "step");
    await expect
      .element(page.getByTestId("task-mode-view-conversation"))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("renders horizontal stage navigation with a collapsible details inspector", async () => {
    await renderPrototype("design-running", "horizontal-stages");

    await expect.element(page.getByTestId("task-mode-horizontal-stage-rail")).toBeInTheDocument();
    await expect.element(page.getByTestId("task-mode-horizontal-inspector")).toBeInTheDocument();
    await expect
      .element(page.getByTestId("task-mode-inspector-toggle"))
      .toHaveAttribute("aria-expanded", "true");

    await page.getByTestId("task-mode-inspector-toggle").click();

    await expect
      .element(page.getByTestId("task-mode-horizontal-inspector"))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByTestId("task-mode-inspector-toggle"))
      .toHaveAttribute("aria-expanded", "false");
  });

  it("distinguishes viewed history from active work and returns to the current stage", async () => {
    await renderPrototype("inspect-research", "horizontal-stages");

    await expect
      .element(page.getByTestId("task-mode-historical-banner"))
      .toHaveTextContent("Viewing Research v1");
    await expect
      .element(page.getByTestId("task-mode-historical-banner"))
      .toHaveTextContent("Design is working");
    await expect.element(page.getByTestId("task-mode-outcome-view")).toBeInTheDocument();

    await page.getByRole("button", { name: "Return to current" }).click();

    await expect.element(page.getByTestId("task-mode-historical-banner")).not.toBeInTheDocument();
    await expect.element(page.getByTestId("task-mode-conversation-view")).toBeInTheDocument();
    await expect
      .element(page.getByTestId("task-mode-stage-design"))
      .toHaveAttribute("data-selected", "true");
  });

  it("switches between outcomes for a stage with history", async () => {
    await renderPrototype("branch-history", "horizontal-stages");

    const occurrenceSelect = page.getByTestId("task-mode-occurrence-select");
    await expect.element(occurrenceSelect).toHaveValue("design-v2");

    await occurrenceSelect.selectOptions("design-v1");

    await expect
      .element(page.getByText("Design v1 · historical stage", { exact: true }))
      .toBeVisible();
    await expect
      .element(
        page
          .getByTestId("task-mode-outcome-view")
          .getByText("Persistent right panel with clearer hierarchy.", { exact: true }),
      )
      .toBeVisible();
  });

  it("keeps old occurrences read-only and downstream outcomes available after branching", async () => {
    await renderPrototype("branch-history", "horizontal-stages");

    await page.getByTestId("task-mode-open-branch").click();
    await expect.element(page.getByTestId("task-mode-branch-dialog")).toHaveTextContent("Plan v1");
    await page.getByTestId("task-mode-confirm-branch").click();

    await expect
      .element(page.getByTestId("task-mode-stage-design"))
      .toHaveAttribute("aria-current", "step");
    await expect
      .element(page.getByText("Design v3 · current workflow stage", { exact: true }))
      .toBeVisible();

    await page.getByTestId("task-mode-occurrence-select").selectOptions("design-v2");

    await expect.element(page.getByTestId("task-mode-historical-banner")).toBeInTheDocument();
    await expect
      .element(page.getByText("Design v2 · historical stage", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByTestId("task-mode-outcome-view")).toBeInTheDocument();
    await page.getByTestId("task-mode-view-conversation").click();
    await expect.element(page.getByLabelText("Message Design")).toBeDisabled();

    const historicalPlan = page.getByTestId("task-mode-stage-plan");
    await expect.element(historicalPlan).toBeEnabled();
    await historicalPlan.click();

    await expect
      .element(page.getByText("Plan v1 · historical stage", { exact: true }))
      .toBeVisible();
    await expect.element(page.getByTestId("task-mode-outcome-view")).toBeInTheDocument();
  });

  it("keeps the full Playground route usable at desktop and narrow viewport heights", async () => {
    await page.viewport(1_280, 720);
    const desktop = await renderPlaygroundPage();
    await waitForLayout();

    const composer = page.getByLabelText("Message Design").element();
    expect(composer.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    await desktop.unmount();

    await page.viewport(390, 844);
    await renderPlaygroundPage();
    await waitForLayout();

    const content = page.getByTestId("task-mode-layout-content").element();
    expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
    content.scrollTop = content.scrollHeight;
    await waitForLayout();

    const panelBottom = page
      .getByTestId("task-mode-current-layout-panel")
      .element()
      .getBoundingClientRect().bottom;
    expect(panelBottom).toBeLessThanOrEqual(content.getBoundingClientRect().bottom + 1);
  });

  it("opens Task-first navigation from the narrow layout", async () => {
    await page.viewport(390, 844);
    await renderPrototype("design-running", "horizontal-stages");

    await page.getByTestId("task-mode-mobile-navigation-trigger").click();

    await expect.element(page.getByTestId("task-mode-mobile-navigation")).toBeVisible();
    await expect
      .element(page.getByText("Refine Task mode UX", { exact: true }).last())
      .toBeVisible();
  });

  it("covers approval, checkpoint, and honest failure action states", async () => {
    const plan = await renderPrototype("plan-review", "current-refined");
    await page.getByRole("button", { name: "Approve plan" }).click();
    await expect.element(page.getByText("Plan approved in the prototype.")).toBeVisible();
    await plan.unmount();

    const checkpoint = await renderPrototype("implement-checkpoint", "current-refined");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect.element(page.getByText("Checkpoint continued in the prototype.")).toBeVisible();
    await checkpoint.unmount();

    await renderPrototype("failed-stage", "current-refined");
    await expect.element(page.getByTestId("task-mode-failure-card")).toBeInTheDocument();
    await page.getByTestId("task-mode-view-outcome").click();
    await expect.element(page.getByText("No Design outcome", { exact: true })).toBeVisible();
  });
});
