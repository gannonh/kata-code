// @effect-diagnostics nodeBuiltinImport:off - the gate step is exercised as the real shell script.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

const repositoryRoot = NodePath.resolve(new URL("..", import.meta.url).pathname);
const workflow = NodeFS.readFileSync(
  NodePath.join(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);

const jobsSection = workflow.slice(workflow.indexOf("\njobs:\n"));

const jobIds = [...jobsSection.matchAll(/^ {2}([a-z_]+):\s*$/gm)].map(
  (match) => match[1] as string,
);

const jobBlock = (id: string): string => {
  const start = jobsSection.indexOf(`\n  ${id}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = jobsSection.slice(start + 1);
  const next = rest.slice(1).search(/^ {2}[a-z_]+:\s*$/m);
  return next === -1 ? rest : rest.slice(0, next + 1);
};

const gateBlock = jobBlock("check");

const gateNeeds = (): ReadonlyArray<string> => {
  const list = /needs:\s*\[([^\]]*)\]/.exec(gateBlock)?.[1] ?? "";
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
};

const gateScript = (): string => {
  const step = gateBlock.slice(gateBlock.indexOf("- name: Require every job to pass"));
  const run = step.slice(step.indexOf("run: |\n") + "run: |\n".length);
  return run
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
};

const runGate = (
  results: Record<string, string>,
  nativeChanged: string,
): { readonly status: number | null; readonly stdout: string } => {
  const needs = Object.fromEntries(
    Object.entries(results).map(([id, result]) => [id, { result, outputs: {} }]),
  );
  const run = NodeChildProcess.spawnSync("bash", ["-c", gateScript()], {
    encoding: "utf8",
    env: { ...process.env, RESULTS: JSON.stringify(needs), NATIVE_CHANGED: nativeChanged },
  });
  return { status: run.status, stdout: run.stdout };
};

const allSuccess = (): Record<string, string> =>
  Object.fromEntries(gateNeeds().map((id) => [id, "success"]));

describe("CI workflow", () => {
  it("makes the Check gate need every other job", () => {
    expect(jobIds.filter((id) => id !== "check").toSorted()).toEqual(gateNeeds().toSorted());
  });

  it("keeps the Check job name that branch protection requires", () => {
    expect(gateBlock).toContain("\n    name: Check\n");
    expect(gateBlock).toContain("if: ${{ always() }}");
  });

  it("passes the gate when every job succeeds", () => {
    expect(runGate(allSuccess(), "true").status).toBe(0);
  });

  it("passes the gate when only the macOS lint is skipped because no native code changed", () => {
    const results = { ...allSuccess(), mobile_native_static_analysis: "skipped" };
    expect(runGate(results, "false").status).toBe(0);
  });

  it("fails the gate when the macOS lint is skipped although native code changed", () => {
    const results = { ...allSuccess(), mobile_native_static_analysis: "skipped" };
    expect(runGate(results, "true").status).toBe(1);
    expect(runGate(results, "").status).toBe(1);
  });

  it.each(["failure", "cancelled", "skipped"])("fails the gate when a job is %s", (result) => {
    for (const id of gateNeeds()) {
      const gate = runGate({ ...allSuccess(), [id]: result }, "true");
      expect(gate.status, `${id} ${result}`).toBe(1);
      expect(gate.stdout).toContain(`${id}: ${result}`);
    }
  });

  it("keeps every former Check-job step in a parallel job", () => {
    const steps: Record<string, ReadonlyArray<string>> = {
      lint: [
        "Reject repository-owned PR assets",
        "Fetch and verify frozen upstream tip",
        "Check product branding",
        "Check workflow references",
        "Check upstream preservation contract",
        "Check unused code",
        "run: vp check",
      ],
      typecheck: ["run: vpr typecheck"],
      build: ["run: vp run build:desktop", "verify-preload-bundle.mjs"],
    };
    for (const [id, names] of Object.entries(steps)) {
      for (const name of names) {
        expect(jobBlock(id), `${id}: ${name}`).toContain(name);
      }
    }
  });

  it("keeps both frozen upstream-tip literals and the trusted checker in the Lint job", () => {
    const lint = jobBlock("lint");
    expect(lint).toMatch(/UPSTREAM_TIP: [0-9a-f]{40}/);
    expect(lint).toMatch(/UPSTREAM_SHA: [0-9a-f]{40}/);
    expect(lint).toContain('git archive --format=tar "$BASE_SHA"');
    expect(lint).toContain('node "$trusted_root/scripts/check-upstream-preservation.ts"');
    for (const id of jobIds.filter((job) => job !== "lint")) {
      expect(jobBlock(id), id).not.toMatch(/UPSTREAM_(TIP|SHA)/);
    }
  });
});
