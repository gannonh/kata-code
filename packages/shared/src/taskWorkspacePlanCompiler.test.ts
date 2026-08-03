import { describe, expect, it } from "vite-plus/test";

import {
  compileTaskWorkspacePlan,
  reverseDependencyInvalidation,
  structuralDiff,
} from "./taskWorkspacePlanCompiler.ts";

const plan = `## Phase [phase:foundation] Foundation

Checkpoint: always

### Work item [work:contract] Add the contract

- Automated check [check:typecheck]: Typecheck | vp run typecheck

### Work item [work:service] Add the service

Dependencies: work:contract

- Manual check [check:review]: Review the service
`;

describe("task workspace Plan compiler", () => {
  it("compiles the reviewed Markdown shape into a deterministic graph", () => {
    const compiled = compileTaskWorkspacePlan({ markdown: plan, planRevisionId: "plan-1" });
    expect(compiled.planRevisionId).toBe("plan-1");
    expect(compiled.phases[0]?.id).toBe("phase:foundation");
    expect(compiled.phases[0]?.workItems[1]?.dependsOn).toEqual(["work:contract"]);
    expect(compiled.checks.map((check) => [check.id, check.command])).toEqual([
      ["check:typecheck", "vp run typecheck"],
      ["check:review", null],
    ]);
  });

  it("projects an older unstructured Plan without inventing executable checks", () => {
    const compiled = compileTaskWorkspacePlan({
      markdown: "## Phase Legacy\n\n- Check: typecheck",
      planRevisionId: "legacy",
    });
    expect(compiled.phases).toHaveLength(1);
    expect(compiled.phases[0]?.workItems[0]?.title).toBe("Implement approved Plan");
    expect(compiled.checks).toEqual([]);
  });

  it.each([
    ["duplicate ids", plan.replace("work:service", "work:contract")],
    ["forward dependency", plan.replace("work:contract\n\n- Manual", "work:service\n\n- Manual")],
    ["invalid policy", plan.replace("Checkpoint: always", "Checkpoint: sometimes")],
    ["empty command", plan.replace("| vp run typecheck", "|")],
  ])("rejects %s before approval", (_name, invalid) => {
    expect(() => compileTaskWorkspacePlan(invalid)).toThrow("Invalid implementation Plan");
  });

  it("derives stable structural changes and reverse invalidation", () => {
    const next = compileTaskWorkspacePlan({
      markdown: plan.replace("Add the service", "Change the service"),
      planRevisionId: "plan-2",
    });
    const previous = compileTaskWorkspacePlan({ markdown: plan, planRevisionId: "plan-1" });
    const diff = structuralDiff(previous, next);
    expect(diff.changedWorkItemIds).toEqual(["work:service"]);
    expect(reverseDependencyInvalidation(previous, next, diff).workItemIds).toEqual([
      "work:service",
    ]);
  });
});
