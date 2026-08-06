import type { Page } from "@playwright/test";

import type { AppTarget } from "../harness/project.ts";

const TASK_MODE_PLAYGROUND_PATH = "/playground/task-mode";

export async function openTaskModePlayground(page: Page, appTarget: AppTarget): Promise<void> {
  if (appTarget === "desktop") {
    await page.evaluate((path) => {
      window.location.hash = path;
    }, TASK_MODE_PLAYGROUND_PATH);
    await page.waitForURL(/#\/playground\/task-mode$/u);
  } else {
    const target = new URL(TASK_MODE_PLAYGROUND_PATH, page.url());
    await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
  }

  await page.getByTestId("task-mode-playground-controls").waitFor({ state: "visible" });
}
