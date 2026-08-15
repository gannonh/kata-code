import { describe, expect, it } from "@effect/vitest";

import {
  trustedImplementationInstructions,
  trustedInstructionsForStage,
  trustedStageInstructions,
} from "./taskStageInstructions.ts";

describe("trusted planning instructions", () => {
  it.each(["questions", "research", "design", "plan"] as const)(
    "directs %s to begin with context and finish with complete",
    (stage) => {
      const instructions = trustedInstructionsForStage(stage);
      expect(instructions).toContain("katacode task context");
      expect(instructions).toContain(
        "katacode task complete --summary <text> --artifact-file <file|->",
      );
      expect(instructions).toContain("Prefer `--artifact-file -` and stdin");
      expect(instructions).toBe(trustedStageInstructions(stage));
      expect(instructions).not.toContain("task_stage_");
      expect(instructions).not.toContain("task_implementation_");
    },
  );

  it("keeps Implement on task_implementation tools", () => {
    const instructions = trustedInstructionsForStage("build");
    expect(instructions).toBe(trustedImplementationInstructions());
    expect(instructions).toContain("task_implementation_complete");
    expect(instructions).toContain("Do not call `katacode task complete` for the Implement stage.");
  });
});
