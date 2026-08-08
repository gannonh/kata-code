import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Fail with a diagnosis when Task mode is switched off.
 *
 * Task mode is in development and gated behind `FF_TASK_MODE=1`. With the flag
 * off the whole Task surface is absent, and every task spec fails on a missing
 * sidebar link, which reads like a broken app rather than a missing flag.
 */
export async function expectTaskModeEnabled(page: Page): Promise<void> {
  const tasksSection = page.getByRole("link", { name: "New task" });
  await expect(
    tasksSection,
    "Task navigation is not rendered. These specs require FF_TASK_MODE=1; the web build was made with it off.",
  ).toBeAttached();
}

/**
 * Navigate to a task by its id via its sidebar link.
 *
 * The link is resolved rather than constructed so the test follows the same
 * environment-scoped route the product produces.
 */
export async function openTask(page: Page, id: string): Promise<void> {
  await expectTaskModeEnabled(page);
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
  await expect(page.getByTestId("task-artifacts-panel")).toBeVisible();
}
