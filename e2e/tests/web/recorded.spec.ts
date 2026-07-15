/**
 * Starter template for recording web app tests with Playwright codegen.
 *
 * Workflow:
 *   1. Start the full dev stack: pnpm run dev
 *   2. Record a new test: npx playwright codegen --config e2e/playwright.codegen.config.ts
 *   3. Interact with the app in the browser to record actions.
 *   4. Copy the generated code into a file under e2e/tests/web/.
 *   5. Run: npx playwright test --config e2e/playwright.config.ts --project web-dev
 *
 * The standard fixture starts an isolated server, authenticates the page, and
 * exposes the ready app shell through `authenticatedAppWindow`.
 */
import { E2E_TAGS } from "../../src/config/tags.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

test.describe(`Web app - recorded tests ${E2E_TAGS.auth}`, () => {
  test(
    "app loads and shows the authenticated shell",
    { tag: [E2E_TAGS.auth] },
    async ({ authenticatedAppWindow }) => {
      await expect(authenticatedAppWindow.getByTestId("command-palette-trigger")).toBeVisible();
    },
  );

  // Paste codegen-recorded tests below and use `authenticatedAppWindow`.
});
