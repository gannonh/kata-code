import { describe, expect, it } from "vite-plus/test";

import {
  compileLegacyTaskWorkspacePlan,
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

  it("projects an older unstructured Plan only through the explicit compatibility API", () => {
    const compiled = compileLegacyTaskWorkspacePlan({
      markdown: "## Phase Legacy\n\n- Check: typecheck",
      planRevisionId: "legacy",
    });
    expect(compiled.phases).toHaveLength(1);
    expect(compiled.phases[0]?.workItems[0]?.title).toBe("Implement approved Plan");
    expect(compiled.checks).toEqual([]);
    expect(() =>
      compileTaskWorkspacePlan({ markdown: "## Phase Legacy", planRevisionId: "legacy" }),
    ).toThrow("Invalid implementation Plan");
  });

  it.each([
    "## Phase foundation Foundation",
    "## Phase [phase:foundation] Foundation\n\n### Work item broken",
    "## Phase [phase:foundation] Foundation\n\nCheckpoint: always\n\n### Work item [work:one] One\n\n### Work item Notes\n\n- Automated check [check:typecheck]: Typecheck | vp run typecheck",
  ])("rejects malformed headings and ambiguous checks", (invalid) => {
    expect(() => compileTaskWorkspacePlan(invalid)).toThrow("Invalid implementation Plan");
  });

  it("rejects an oversized reviewed Plan before parsing", () => {
    const oversized = `${"x".repeat(100_001)}\n${plan}`;
    expect(() => compileTaskWorkspacePlan(oversized)).toThrow("Plan Markdown is too large (");
  });

  it("requires Checkpoint in the phase preamble", () => {
    expect(() =>
      compileTaskWorkspacePlan(
        plan
          .replace("Checkpoint: always\n\n", "")
          .replace(
            "\n\n### Work item [work:service]",
            "\n\nCheckpoint: always\n\n### Work item [work:service]",
          ),
      ),
    ).toThrow("Invalid implementation Plan");
  });

  it.each([
    ["duplicate ids", plan.replace("work:service", "work:contract")],
    ["forward dependency", plan.replace("work:contract\n\n- Manual", "work:service\n\n- Manual")],
    ["invalid policy", plan.replace("Checkpoint: always", "Checkpoint: sometimes")],
    ["empty command", plan.replace("| vp run typecheck", "|")],
  ])("rejects %s before approval", (_name, invalid) => {
    expect(() => compileTaskWorkspacePlan(invalid)).toThrow("Invalid implementation Plan");
  });

  it("includes dependent checks in the reverse invalidation closure", () => {
    const next = compileTaskWorkspacePlan(plan.replace("Add the contract", "Change the contract"));
    const previous = compileTaskWorkspacePlan(plan);
    const invalidation = reverseDependencyInvalidation(previous, next);
    expect(invalidation.workItemIds).toEqual(["work:contract", "work:service"]);
    expect(invalidation.checkIds).toEqual(["check:review", "check:typecheck"]);
  });

  it("invalidates work and checks when phases move", () => {
    const first = `## Phase [phase:one] One

Checkpoint: always

### Work item [work:one] One

- Automated check [check:one]: One | one

## Phase [phase:two] Two

Checkpoint: always

### Work item [work:two] Two

- Automated check [check:two]: Two | two
`;
    const second = `## Phase [phase:two] Two

Checkpoint: always

### Work item [work:two] Two

- Automated check [check:two]: Two | two

## Phase [phase:one] One

Checkpoint: always

### Work item [work:one] One

- Automated check [check:one]: One | one
`;
    const previous = compileTaskWorkspacePlan(first);
    const next = compileTaskWorkspacePlan(second);
    const diff = structuralDiff(previous, next);
    expect(diff.changedPhaseIds).toEqual(["phase:one", "phase:two"]);
    expect(diff.changedWorkItemIds).toEqual(["work:one", "work:two"]);
    expect(reverseDependencyInvalidation(previous, next, diff).checkIds).toEqual([
      "check:one",
      "check:two",
    ]);
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
