import { describe, expect, it } from "vite-plus/test";
import type { ServerProviderModel } from "@kata-sh/code-contracts";

import {
  buildEnvironmentDraftRows,
  deriveProviderModelsForDisplay,
  publishEnvironmentDraftRows,
} from "./ProviderInstanceCard";

describe("buildEnvironmentDraftRows", () => {
  it("appends blank rows for prefill names missing from the environment", () => {
    const rows = buildEnvironmentDraftRows(
      [{ name: "VERCEL_TOKEN", value: "tok", sensitive: true }],
      ["VERCEL_TOKEN", "VERCEL_TEAM_ID", "VERCEL_PROJECT_ID"],
    );
    expect(rows.map((row) => row.name)).toEqual([
      "VERCEL_TOKEN",
      "VERCEL_TEAM_ID",
      "VERCEL_PROJECT_ID",
    ]);
    // Existing value is preserved; prefilled rows are blank placeholders.
    expect(rows[0]?.value).toBe("tok");
    expect(rows[1]?.value).toBe("");
    expect(rows[1]?.prefill).toBe(true);
    expect(rows[2]?.sensitive).toBe(true);
  });
});

describe("publishEnvironmentDraftRows", () => {
  it("drops blank prefilled placeholders but keeps user-added empty rows and redacted rows", () => {
    const published = publishEnvironmentDraftRows([
      { id: "0", name: "VERCEL_TOKEN", value: "tok", sensitive: true },
      {
        id: "prefill:VERCEL_TEAM_ID",
        name: "VERCEL_TEAM_ID",
        value: "",
        sensitive: true,
        prefill: true,
      },
      { id: "2", name: "MY_API_KEY", value: "", sensitive: true },
      { id: "3", name: "STORED", value: "", sensitive: true, valueRedacted: true },
    ]);
    expect(published).toEqual([
      { name: "VERCEL_TOKEN", value: "tok", sensitive: true },
      { name: "MY_API_KEY", value: "", sensitive: true },
      { name: "STORED", value: "", sensitive: true, valueRedacted: true },
    ]);
  });
});

describe("deriveProviderModelsForDisplay", () => {
  it("uses current config custom models instead of stale live custom rows", () => {
    const liveModels: ReadonlyArray<ServerProviderModel> = [
      {
        slug: "server-model",
        name: "Server Model",
        isCustom: false,
        capabilities: null,
      },
      {
        slug: "removed-custom",
        name: "Removed Custom",
        isCustom: true,
        capabilities: null,
      },
      {
        slug: "kept-custom",
        name: "Kept Custom",
        isCustom: true,
        capabilities: null,
      },
    ];

    expect(
      deriveProviderModelsForDisplay({
        liveModels,
        customModels: ["kept-custom"],
      }).map((model) => model.slug),
    ).toEqual(["server-model", "kept-custom"]);
  });
});
