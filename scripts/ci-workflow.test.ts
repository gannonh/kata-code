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

const stepScalarOf = (block: string, stepName: string, key: string): string => {
  const lines = block.split("\n");
  const step = lines.findIndex((line) => line.includes(`- name: ${stepName}`));
  expect(step).toBeGreaterThan(-1);
  const keyLine = new RegExp(`^\\s*${key}:\\s*\\|\\s*$`);
  const start = lines.findIndex((line, index) => index > step && keyLine.test(line));
  expect(start).toBeGreaterThan(-1);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && indentOf(line) <= indentOf(lines[start] as string)) break;
    body.push(line);
  }
  while (body.at(-1)?.trim() === "") body.pop();
  const indent = indentOf(body.find((line) => line.trim() !== "") as string);
  return body.map((line) => line.slice(indent)).join("\n");
};

const gateScriptOf = (gateBlock: string): string =>
  stepScalarOf(gateBlock, "Require every job to pass", "run");

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

const preservationStep = "Check upstream preservation contract";
const waivedFailures = stepScalarOf(jobBlock("lint"), preservationStep, "WAIVED_FAILURES").split(
  "\n",
);

const outputOf = (...lines: ReadonlyArray<string>): string =>
  lines.map((line) => `${line}\n`).join("");

const runWaiver = (
  exitCode: number,
  stdoutLines: ReadonlyArray<string>,
  stderrLines: ReadonlyArray<string> = [],
): { readonly status: number | null; readonly stdout: string } => {
  const run = NodeChildProcess.spawnSync(
    "bash",
    [
      NodePath.join(repositoryRoot, "scripts/waive-upstream-preservation-failures.sh"),
      "bash",
      "-c",
      'printf "%s" "$FAKE_STDOUT"; printf "%s" "$FAKE_STDERR" >&2; exit "$FAKE_EXIT"',
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        WAIVED_FAILURES: outputOf(...waivedFailures),
        FAKE_STDOUT: outputOf(...stdoutLines),
        FAKE_STDERR: outputOf(...stderrLines),
        FAKE_EXIT: String(exitCode),
      },
    },
  );
  return { status: run.status, stdout: run.stdout };
};

const reportHeader =
  "UPSTREAM_PRESERVATION mode=ci candidate=1111111111111111111111111111111111111111 base=2222222222222222222222222222222222222222 upstream=250e052f44dd313b658abebc707242a7b25be340 upstream-base=6a687ee43bf222672ab8d3f4c0bab3d8d174f79f";
const reportFooter = [
  "CHANGED_RETAINED_OUTCOMES status=PASS ids=none",
  "INTEGRATION_RECORD status=NOT RUN",
  "HUMAN_REVIEW_ACCEPTANCE status=NOT RUN",
];
const ciReport = (checkLines: ReadonlyArray<string>): ReadonlyArray<string> => [
  reportHeader,
  "INVENTORY status=PASS",
  "CHECK id=product-identity-release-ownership status=PASS",
  ...checkLines,
  "CHECK id=icon-composer-live-evidence status=NOT RUN detail=requires macOS Icon Composer evidence",
  "CHECK id=human-device-provider-evidence status=NOT RUN detail=requires device/provider evidence",
  ...reportFooter,
];

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

describe("CI upstream preservation waiver", () => {
  const missingOwnerPath =
    "INVENTORY status=FAIL detail=Inventory owner path does not exist: scripts/check-connect-wire-identity.ts";
  const unlistedCheck =
    "CHECK id=connect-wire-identity status=FAIL detail=trusted assertion changed scripts/check-connect-wire-identity.test.ts";

  it("runs the trusted base checker through the waiver script", () => {
    expect(stepScalarOf(jobBlock("lint"), preservationStep, "run")).toContain(
      [
        '  bash scripts/waive-upstream-preservation-failures.sh node "$trusted_root/scripts/check-upstream-preservation.ts" \\',
        "    --mode ci \\",
        '    --candidate "$CANDIDATE_SHA" \\',
        '    --base "$BASE_SHA" \\',
        '    --upstream "$UPSTREAM_SHA" \\',
        '    --upstream-base "$UPSTREAM_BASE_SHA"',
        "else",
      ].join("\n"),
    );
    expect(jobBlock("lint")).not.toContain("continue-on-error");
  });

  it("fails when no checker command is given", () => {
    const run = NodeChildProcess.spawnSync(
      "bash",
      [NodePath.join(repositoryRoot, "scripts/waive-upstream-preservation-failures.sh")],
      { encoding: "utf8" },
    );
    expect({ status: run.status, stdout: run.stdout }).toEqual({ status: 2, stdout: "" });
  });

  it("passes when the checker passes", () => {
    const report = ciReport([]);
    expect(runWaiver(0, report)).toEqual({ status: 0, stdout: outputOf(...report) });
  });

  it("passes when only waived failures and manual checks that were not run remain", () => {
    const report = ciReport(waivedFailures);
    expect(runWaiver(1, report)).toEqual({
      status: 0,
      stdout: outputOf(
        ...report,
        "Only waived trusted-assertion failures remain; see docs/upstream/kat-3411-intake.md.",
      ),
    });
  });

  it("fails when a preservation-owned path is deleted", () => {
    const report = [reportHeader, missingOwnerPath, "HUMAN_REVIEW_ACCEPTANCE status=NOT RUN"];
    expect(runWaiver(1, report)).toEqual({
      status: 1,
      stdout: outputOf(...report, "Unwaived preservation failures:", missingOwnerPath),
    });
  });

  it("fails when the checker throws a failure line on stderr only", () => {
    const thrown = "UPSTREAM_PRESERVATION status=FAIL detail=Unknown ref: not-a-commit";
    expect(runWaiver(1, [], [thrown])).toEqual({
      status: 1,
      stdout: outputOf(thrown, "Unwaived preservation failures:", thrown),
    });
  });

  it("fails when the checker exits non-zero without any status=FAIL line", () => {
    const report = ciReport([]);
    expect(runWaiver(1, report)).toEqual({
      status: 1,
      stdout: outputOf(...report, "Preservation checker exited 1 without a status=FAIL line."),
    });
    expect(runWaiver(2, [])).toEqual({
      status: 1,
      stdout: outputOf("Preservation checker exited 2 without a status=FAIL line."),
    });
  });

  it("fails when the checker crashes before printing its report", () => {
    const crash = [
      "node:internal/modules/esm/resolve:275",
      "    throw new ERR_MODULE_NOT_FOUND(",
      "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/trusted/scripts/lib/upstream-preservation/index.ts' imported from /tmp/trusted/scripts/check-upstream-preservation.ts",
    ];
    expect(runWaiver(1, [], crash)).toEqual({
      status: 1,
      stdout: outputOf(...crash, "Preservation checker exited 1 without a status=FAIL line."),
    });
  });

  it.each([
    ["CHECK", unlistedCheck],
    ["INVENTORY", missingOwnerPath],
    ["other", "INTEGRATION_RECORD status=FAIL detail=Integration record is missing."],
    ["near-miss", `${waivedFailures[0]} (renamed)`],
    [
      "automated NOT RUN",
      "CHECK id=connect-wire-identity status=NOT RUN detail=command node scripts/check-connect-wire-identity.ts",
    ],
  ])("fails an unlisted %s failure line next to waived ones", (_kind, failure) => {
    const report = ciReport([...waivedFailures, failure]);
    expect(runWaiver(1, report)).toEqual({
      status: 1,
      stdout: outputOf(...report, "Unwaived preservation failures:", failure),
    });
  });

  it("fails an unlisted failure line that is not valid UTF-8", () => {
    const run = NodeChildProcess.spawnSync(
      "bash",
      [
        NodePath.join(repositoryRoot, "scripts/waive-upstream-preservation-failures.sh"),
        "bash",
        "-c",
        `printf "%s" "$FAKE_STDOUT"; printf 'INVENTORY status=FAIL detail=Inventory owner path does not exist: scripts/\\377.ts\\n'; exit 1`,
      ],
      {
        encoding: "latin1",
        env: {
          ...process.env,
          WAIVED_FAILURES: outputOf(...waivedFailures),
          FAKE_STDOUT: outputOf(...waivedFailures),
        },
      },
    );
    const failure =
      "INVENTORY status=FAIL detail=Inventory owner path does not exist: scripts/\u00ff.ts";
    expect({ status: run.status, stdout: run.stdout }).toEqual({
      status: 1,
      stdout: outputOf(...waivedFailures, failure, "Unwaived preservation failures:", failure),
    });
  });

  it("reads the waived trusted-assertion lines from the workflow", () => {
    expect(waivedFailures.length).toBeGreaterThan(0);
    for (const line of waivedFailures) {
      expect(line).toMatch(/^CHECK id=[a-z-]+ status=FAIL detail=trusted assertion changed \S+$/);
    }
  });
});
