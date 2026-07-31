import { describe, expect, it } from "@effect/vitest";

import {
  TASK_WORKSPACE_PRESET_CATALOG,
  TASK_WORKSPACE_STAGE_LABELS,
  taskWorkspaceCatalogEntryForVersion,
  taskWorkspacePresetCatalogEntry,
} from "./taskWorkspacePresets.ts";

describe("taskWorkspacePresets", () => {
  it("keeps the client catalog internally consistent", () => {
    expect(TASK_WORKSPACE_PRESET_CATALOG.map((entry) => entry.preset)).toEqual([
      "standard",
      "guided",
      "freeform",
    ]);
    for (const entry of TASK_WORKSPACE_PRESET_CATALOG) {
      expect(taskWorkspacePresetCatalogEntry(entry.preset)).toBe(entry);
      expect(taskWorkspaceCatalogEntryForVersion(entry.currentVersion)).toBe(entry);
      expect(entry.stages[0]).toBe("questions");
      expect(entry.stages.at(-1)).toBe("verified");
      for (const stage of [...entry.explicitEntryStages, ...entry.automaticCompletionStages]) {
        expect(entry.stages).toContain(stage);
      }
      for (const stage of entry.explicitEntryStages) {
        expect(stage).not.toBe("build");
        expect(stage).not.toBe("verified");
      }
      for (const stage of entry.stages) {
        expect(TASK_WORKSPACE_STAGE_LABELS[stage].length).toBeGreaterThan(0);
      }
    }
    expect(taskWorkspaceCatalogEntryForVersion("guided@9.9.9")).toBeNull();
  });
});
