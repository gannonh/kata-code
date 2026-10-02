// @effect-diagnostics nodeBuiltinImport:off - the gate step is exercised as the real shell script.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "@effect/vitest";

const repositoryRoot = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "..",
);
const workflow = NodeFS.readFileSync(
  NodePath.join(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);

// The job-id pattern of scripts/check-workflow-references.mjs.
const jobIdLine = "^ {2}([A-Za-z_][A-Za-z0-9_-]*):\\s*$";

const jobsSectionOf = (text: string): string => text.slice(text.indexOf("\njobs:\n"));

const jobIdsOf = (text: string): ReadonlyArray<string> =>
  [...jobsSectionOf(text).matchAll(new RegExp(jobIdLine, "gm"))].map((match) => match[1] as string);

const jobBlockOf = (text: string, id: string): string => {
  const jobs = jobsSectionOf(text);
  const start = jobs.indexOf(`\n  ${id}:\n`);
  expect(start).toBeGreaterThan(-1);
  const rest = jobs.slice(start + 1);
  const next = rest.slice(1).search(new RegExp(jobIdLine, "m"));
  return next === -1 ? rest : rest.slice(0, next + 1);
};

const gateNeedsOf = (text: string): ReadonlyArray<string> => {
  const list = /needs:\s*\[([^\]]*)\]/.exec(jobBlockOf(text, "check"))?.[1] ?? "";
  return list
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
};

const jobsMissingFromGate = (text: string): ReadonlyArray<string> => {
  const needs = gateNeedsOf(text);
  return jobIdsOf(text).filter((id) => id !== "check" && !needs.includes(id));
};

const indentOf = (line: string): number => line.length - line.trimStart().length;

const gateScriptOf = (gateBlock: string): string => {
  const lines = gateBlock.split("\n");
  const step = lines.findIndex((line) => line.includes("- name: Require every job to pass"));
  const run = lines.findIndex((line, index) => index > step && /^\s*run:\s*\|\s*$/.test(line));
  const body: string[] = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() !== "" && indentOf(line) <= indentOf(lines[run] as string)) break;
    body.push(line);
  }
  while (body.at(-1)?.trim() === "") body.pop();
  const indent = indentOf(body.find((line) => line.trim() !== "") as string);
  return body.map((line) => line.slice(indent)).join("\n");
};

const jobBlock = (id: string): string => jobBlockOf(workflow, id);
const jobIds = jobIdsOf(workflow);
const gateBlock = jobBlock("check");
const gateNeeds = (): ReadonlyArray<string> => gateNeedsOf(workflow);

const runGate = (
  results: Record<string, string>,
  nativeChanged: string,
): { readonly status: number | null; readonly stdout: string } => {
  const needs = Object.fromEntries(
    Object.entries(results).map(([id, result]) => [id, { result, outputs: {} }]),
  );
  const run = NodeChildProcess.spawnSync("bash", ["-c", gateScriptOf(gateBlock)], {
    encoding: "utf8",
    env: { ...process.env, RESULTS: JSON.stringify(needs), NATIVE_CHANGED: nativeChanged },
  });
  return { status: run.status, stdout: run.stdout };
};

const allSuccess = (): Record<string, string> =>
  Object.fromEntries(gateNeeds().map((id) => [id, "success"]));

describe("CI workflow", () => {
  it("makes the Check gate need every other job", () => {
    expect(jobsMissingFromGate(workflow)).toEqual([]);
    expect(gateNeeds().toSorted()).toEqual(jobIds.filter((id) => id !== "check").toSorted());
  });

  it("finds a hyphenated job the gate does not need", () => {
    const text = [
      "name: CI",
      "jobs:",
      "  lint:",
      "    name: Lint",
      "  test-e2e:",
      "    name: E2E",
      "  check:",
      "    name: Check",
      "    needs: [lint]",
      "",
    ].join("\n");
    expect(jobIdsOf(text)).toEqual(["lint", "test-e2e", "check"]);
    expect(jobsMissingFromGate(text)).toEqual(["test-e2e"]);
  });

  it("reads the gate script only up to the end of its run block", () => {
    const block = [
      "  check:",
      "    steps:",
      "      - name: Require every job to pass",
      "        env:",
      "          RESULTS: x",
      "        run: |",
      "          echo gate",
      "",
      "          echo end",
      "",
      "      - name: Later step",
      "        run: exit 7",
    ].join("\n");
    expect(gateScriptOf(block)).toBe("echo gate\n\necho end");
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
