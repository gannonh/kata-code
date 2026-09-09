import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({ isElectron: true }));

vi.mock("../../hooks/useSettings", () => ({
  PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE: "Connect to an environment",
  usePrimarySettingsAvailable: () => true,
}));

import { SettingsRow } from "./settingsLayout";
import { searchableSetting, searchSettings } from "./settingsSearch";

describe("Connect settings branding", () => {
  it("renders the environment row with the Kata Code Connect title", () => {
    const html = renderToStaticMarkup(<SettingsRow {...searchableSetting("t3-connect")} />);
    expect(html).toContain(">Kata Code Connect</h3>");
    expect(html).not.toContain("T3 Connect");
  });

  it("finds the Connect row by its displayed product name", () => {
    expect(searchSettings("Kata Code Connect")[0]).toMatchObject({
      id: "t3-connect",
      title: "Kata Code Connect",
      to: "/settings/connections",
      targetId: "connections-environment",
    });
  });
});
