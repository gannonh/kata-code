import { E2E_TAGS } from "../../src/config/tags.ts";
import { openProviderSettings } from "../../src/flows/settings.ts";
import { expect, test } from "../../src/harness/testFixtures.ts";

test.describe(`Settings Pi provider ${E2E_TAGS.settings}`, () => {
  test("adds Pi as an enabled first-party provider instance", async ({
    authenticatedAppWindow,
  }) => {
    const page = authenticatedAppWindow;
    await openProviderSettings(page);

    await page.getByLabel("Add provider instance").click();
    const dialog = page.getByRole("dialog", { name: "Add provider instance" });
    await expect(dialog).toBeVisible();

    const piDriver = dialog.getByRole("radio", { name: "Pi", exact: true });
    await expect(piDriver).toBeEnabled();
    await piDriver.click();

    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByLabel("Label").fill("E2E Pi");
    await expect(dialog.getByLabel("Instance ID")).toHaveValue("pi_e2e_pi");

    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Add instance" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("E2E Pi")).toBeVisible();
    await expect(page.locator("code", { hasText: "pi_e2e_pi" })).toBeVisible();
  });
});
