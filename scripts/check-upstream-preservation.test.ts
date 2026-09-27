// @effect-diagnostics nodeBuiltinImport:off - the public CLI is exercised as a real child process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  calculateResultArtifactDigest,
  changedInventoryOutcomeDetails,
  loadInventory,
  parseNameStatusDiff,
  matchesOwnerPath,
  resolveRefs,
  resolveCommitRef,
  resolveEvidenceArtifact,
  validateEvidenceBinding,
  runPreservation,
  PRESERVATION_CHECKS,
  PRESERVATION_CONTRACT,
  RETIREMENTS,
  applyRetirements,
  type PreservationCheck,
  type RetirementTables,
  validateIntegrationRecord,
  validateInventory,
  validateManualEvidence,
  validateExecutionTree,
  missingRequiredPaths,
  RESULT_ARTIFACT_VERSION,
  type InventoryEntry,
} from "./lib/upstream-preservation/index.ts";

const repositoryRoot = NodePath.resolve(new URL("..", import.meta.url).pathname);
const scriptPath = NodePath.join(repositoryRoot, "scripts/check-upstream-preservation.ts");
const currentSha = "251a6bcb5cfad04999a6bdd4c7dbb5bb4c983ff9";
const upstreamSha = "12391bd0d38eef6655b7a9f8945d0cb5febadc2b";
// withHistoricalBaselineWorktree checks out baselineCandidateSha and runs today's
// checker against that tree. Pass that commit's FORK.md pin (baselineUpstreamSha),
// not the live pin. currentSha stays historical because withRetainedRegressionWorktree
// copies today's checker over that checkout and needs a tree difference to commit.
const baselineCandidateSha = "00406934429021e47d3cb60e16491febb46742b4";
const baselineUpstreamSha = "c14f6015bfe479d313355cb234af1a5c16dbb15f";
const currentUpstreamSha = "ab099178a7b7f9728843e90fc95ed90bb61d710d";
const upstreamBaseSha = "6a687ee43bf222672ab8d3f4c0bab3d8d174f79f";

const relativeRepositoryPath = (absolutePath: string): string =>
  NodePath.relative(repositoryRoot, absolutePath).split(NodePath.sep).join("/");

const makeEvidenceDirectory = (): string => {
  const evidenceRoot = NodePath.join(repositoryRoot, "uat-evidence");
  NodeFS.mkdirSync(evidenceRoot, { recursive: true });
  return NodeFS.mkdtempSync(NodePath.join(evidenceRoot, ".kat-3307-evidence-"));
};

const writeEvidenceBinding = (
  directory: string,
  refs: Readonly<{ candidate: string; base: string; upstream: string; upstreamBase: string }>,
  name: string,
  fields: Readonly<Record<string, unknown>>,
): string => {
  const underlyingPath = NodePath.join(directory, `${name}.result.json`);
  const bindingPath = NodePath.join(directory, `${name}.binding.json`);
  const result = `Observed ${name} result.`;
  const resultArtifact = {
    schemaVersion: RESULT_ARTIFACT_VERSION as 1,
    ...refs,
    checkId: String(fields.checkId),
    result,
    producer: "kat-3307-test",
    provenance: `focused test artifact ${name}`,
  };
  NodeFS.writeFileSync(
    underlyingPath,
    JSON.stringify({ ...resultArtifact, digest: calculateResultArtifactDigest(resultArtifact) }),
  );
  NodeFS.writeFileSync(
    bindingPath,
    JSON.stringify({
      schemaVersion: 1,
      ...refs,
      ...fields,
      result,
      artifactPaths: [relativeRepositoryPath(underlyingPath)],
    }),
  );
  return relativeRepositoryPath(bindingPath);
};

const linkWorkspaceDependencies = (temporaryRoot: string): void => {
  const workspaceDirectories = ["scripts"];
  for (const workspaceGroup of ["apps", "packages"]) {
    for (const entry of NodeFS.readdirSync(NodePath.join(repositoryRoot, workspaceGroup), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) workspaceDirectories.push(`${workspaceGroup}/${entry.name}`);
    }
  }

  const rootNodeModules = NodePath.join(repositoryRoot, "node_modules");
  NodeFS.symlinkSync(rootNodeModules, NodePath.join(temporaryRoot, "node_modules"), "dir");
  for (const workspace of workspaceDirectories) {
    const source = NodePath.join(repositoryRoot, workspace, "node_modules");
    const destinationParent = NodePath.join(temporaryRoot, workspace);
    if (!NodeFS.existsSync(source) || !NodeFS.existsSync(destinationParent)) continue;
    NodeFS.cpSync(source, NodePath.join(destinationParent, "node_modules"), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
    });
  }
};

const withHistoricalBaselineWorktree = <A>(run: (temporaryRoot: string) => A): A => {
  const temporaryRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kat-3307-baseline-"));
  const add = NodeChildProcess.spawnSync(
    "git",
    ["worktree", "add", "--detach", temporaryRoot, baselineCandidateSha],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (add.status !== 0) {
    NodeFS.rmSync(temporaryRoot, { recursive: true, force: true });
    throw new Error(`Could not create historical baseline worktree: ${String(add.stderr)}`);
  }

  let result!: A;
  let cleanupError: Error | undefined;
  try {
    linkWorkspaceDependencies(temporaryRoot);
    result = run(temporaryRoot);
  } finally {
    const remove = NodeChildProcess.spawnSync(
      "git",
      ["worktree", "remove", "--force", temporaryRoot],
      { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (remove.status !== 0) {
      cleanupError = new Error(
        `Could not remove historical baseline worktree: ${String(remove.stderr)}`,
      );
    }
    NodeFS.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  if (cleanupError !== undefined) throw cleanupError;
  return result;
};

const withRetainedRegressionWorktree = <A>(
  run: (temporaryRoot: string, candidateSha: string, commitFixture: () => string) => A,
  mutateRetainedSource = true,
): A => {
  const temporaryRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kat-3307-regression-"));
  const add = NodeChildProcess.spawnSync(
    "git",
    ["worktree", "add", "--detach", temporaryRoot, currentSha],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (add.status !== 0) {
    NodeFS.rmSync(temporaryRoot, { recursive: true, force: true });
    throw new Error(`Could not create regression worktree: ${String(add.stderr)}`);
  }

  let result!: A;
  let cleanupError: Error | undefined;
  try {
    NodeFS.mkdirSync(NodePath.join(temporaryRoot, "scripts/lib"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(temporaryRoot, "scripts/lib/upstream-preservation"), {
      recursive: true,
    });
    NodeFS.mkdirSync(NodePath.join(temporaryRoot, "docs/upstream"), { recursive: true });
    for (const relativePath of [
      "scripts/check-upstream-preservation.ts",
      "scripts/lib/upstream-preservation/index.ts",
      "scripts/lib/upstream-preservation.ts",
      "scripts/lib/upstream-preservation/checks.ts",
      "scripts/lib/upstream-preservation/inventory.ts",
      "scripts/lib/upstream-preservation/records.ts",
      "scripts/lib/upstream-preservation-contract.ts",
      "scripts/lib/upstream-preservation-evidence.ts",
      "scripts/lib/upstream-preservation-refs.ts",
      "scripts/lib/upstream-preservation-runner.ts",
      "docs/upstream/retained-behavior.v1.json",
      "docs/upstream/kat-3307-runbook.md",
    ]) {
      NodeFS.copyFileSync(
        NodePath.join(repositoryRoot, relativePath),
        NodePath.join(temporaryRoot, relativePath),
      );
    }
    linkWorkspaceDependencies(temporaryRoot);

    if (mutateRetainedSource) {
      const statePathsPath = NodePath.join(
        temporaryRoot,
        "apps/desktop/src/app/DesktopStatePaths.ts",
      );
      const original = NodeFS.readFileSync(statePathsPath, "utf8");
      const mutated = original.replace('"Kata Code (Alpha)"', '"T3 Code (Alpha)"');
      if (mutated === original)
        throw new Error("Retained regression fixture did not mutate source.");
      NodeFS.writeFileSync(statePathsPath, mutated);
    }

    const commitFixture = (): string => {
      const staged = NodeChildProcess.spawnSync(
        "git",
        [
          "add",
          "-A",
          "--",
          "scripts/check-upstream-preservation.ts",
          "scripts/lib/upstream-preservation/index.ts",
          "scripts/lib/upstream-preservation.ts",
          "scripts/lib/upstream-preservation/checks.ts",
          "scripts/lib/upstream-preservation/inventory.ts",
          "scripts/lib/upstream-preservation/records.ts",
          "scripts/lib/upstream-preservation-contract.ts",
          "scripts/lib/upstream-preservation-evidence.ts",
          "scripts/lib/upstream-preservation-refs.ts",
          "scripts/lib/upstream-preservation-runner.ts",
          "docs/upstream/retained-behavior.v1.json",
          "docs/upstream/kat-3307-runbook.md",
          "apps/desktop/src/app/DesktopStatePaths.ts",
          "apps/desktop/src/app/DesktopStatePaths.test.ts",
          "apps/desktop/src/app/DesktopEnvironment.test.ts",
          "apps/server/src/kataSandbox",
        ],
        { cwd: temporaryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      if (staged.status !== 0)
        throw new Error(`Could not stage regression fixture: ${String(staged.stderr)}`);
      const commit = NodeChildProcess.spawnSync(
        "git",
        [
          "-c",
          "user.name=KAT-3307 test",
          "-c",
          "user.email=kat-3307-test@example.invalid",
          "commit",
          "--no-verify",
          "-m",
          "KAT-3307 regression fixture",
        ],
        { cwd: temporaryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      if (commit.status !== 0)
        throw new Error(`Could not commit regression fixture: ${String(commit.stderr)}`);
      const sha = NodeChildProcess.spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: temporaryRoot,
        encoding: "utf8",
      });
      if (sha.status !== 0)
        throw new Error(`Could not resolve regression fixture SHA: ${String(sha.stderr)}`);
      return sha.stdout.trim();
    };
    const candidateSha = commitFixture();
    result = run(temporaryRoot, candidateSha, commitFixture);
  } finally {
    const remove = NodeChildProcess.spawnSync(
      "git",
      ["worktree", "remove", "--force", temporaryRoot],
      { cwd: repositoryRoot, encoding: "utf8", stdio: "ignore" },
    );
    if (remove.status !== 0) {
      cleanupError = new Error(
        `Could not remove regression worktree: status ${String(remove.status)}`,
      );
    }
    try {
      NodeFS.rmSync(temporaryRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupError ??= error instanceof Error ? error : new Error(String(error));
    }
  }
  if (cleanupError !== undefined) throw cleanupError;
  return result;
};

describe("upstream preservation CLI", () => {
  it("rejects an invocation that omits frozen refs", () => {
    const result = NodeChildProcess.spawnSync(process.execPath, [scriptPath, "--mode", "ci"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("UPSTREAM_PRESERVATION status=FAIL");
    expect(result.stderr).toContain(
      "--candidate, --base, --upstream, and --upstream-base are required",
    );
  });

  it("makes CI use the trusted base checker with an explicit bootstrap", () => {
    const workflow = NodeFS.readFileSync(
      NodePath.join(repositoryRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(workflow).toContain('git archive --format=tar "$BASE_SHA"');
    expect(workflow.match(/fetch-depth: 0/g)).toHaveLength(2);
    expect(workflow).toContain(
      'ln -s "$PWD/scripts/node_modules" "$trusted_root/scripts/node_modules"',
    );
    expect(workflow).toContain('node "$trusted_root/scripts/check-upstream-preservation.ts"');
    expect(workflow).toContain("Preservation checker bootstrap: base predates");
    expect(workflow).toContain(
      'git cat-file -e "$BASE_SHA:scripts/check-upstream-preservation.ts"',
    );
    expect(workflow).not.toContain("KataUpstreamUpgrade.test.ts");
  });

  it("loads an isolated trusted checker through the installed workspace dependencies", () => {
    const trustedRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kat-3307-trusted-"));
    try {
      NodeFS.mkdirSync(NodePath.join(trustedRoot, "scripts"), { recursive: true });
      NodeFS.copyFileSync(
        NodePath.join(repositoryRoot, "scripts/check-upstream-preservation.ts"),
        NodePath.join(trustedRoot, "scripts/check-upstream-preservation.ts"),
      );
      NodeFS.cpSync(
        NodePath.join(repositoryRoot, "scripts/lib"),
        NodePath.join(trustedRoot, "scripts/lib"),
        { recursive: true },
      );
      NodeFS.symlinkSync(
        NodePath.join(repositoryRoot, "scripts/node_modules"),
        NodePath.join(trustedRoot, "scripts/node_modules"),
        "dir",
      );

      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [
          NodePath.join(trustedRoot, "scripts/check-upstream-preservation.ts"),
          "--mode",
          "ci",
          "--candidate",
          upstreamSha,
          "--base",
          currentSha,
          "--upstream",
          currentUpstreamSha,
          "--upstream-base",
          upstreamBaseSha,
        ],
        { cwd: repositoryRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("does not match candidate");
      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    } finally {
      NodeFS.rmSync(trustedRoot, { recursive: true, force: true });
    }
  });

  it("binds execution to the candidate commit and rejects a dirty checkout", () => {
    withRetainedRegressionWorktree((temporaryRoot, candidateSha) => {
      const refs = resolveRefs(temporaryRoot, {
        candidate: candidateSha,
        base: currentSha,
        upstream: upstreamSha,
        upstreamBase: upstreamBaseSha,
      });
      const dirtyPath = NodePath.join(temporaryRoot, "apps/server/src/dirty-retained-source.ts");
      NodeFS.writeFileSync(dirtyPath, "export const dirty = true;\n");
      expect(() => validateExecutionTree(temporaryRoot, refs)).toThrow("checkout is dirty");
      NodeFS.rmSync(dirtyPath);
      expect(() =>
        validateExecutionTree(temporaryRoot, {
          ...refs,
          candidate: upstreamSha as typeof refs.candidate,
        }),
      ).toThrow("does not match candidate");
    }, false);
  });

  it("rejects skip flags instead of weakening the mandatory contract", () => {
    const result = NodeChildProcess.spawnSync(
      process.execPath,
      [scriptPath, "--skip", "state-isolation"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--skip is not supported");
  });

  it(
    "runs the trusted current checker against a clean historical candidate with external inventory",
    { timeout: 5 * 60 * 1000 },
    () => {
      withHistoricalBaselineWorktree((temporaryRoot) => {
        const result = NodeChildProcess.spawnSync(
          process.execPath,
          [
            scriptPath,
            "--mode",
            "baseline",
            "--repository-root",
            temporaryRoot,
            "--inventory",
            NodePath.join(repositoryRoot, "docs/upstream/retained-behavior.v1.json"),
            "--candidate",
            baselineCandidateSha,
            "--base",
            baselineCandidateSha,
            "--upstream",
            baselineUpstreamSha,
            "--upstream-base",
            upstreamBaseSha,
          ],
          { cwd: repositoryRoot, encoding: "utf8" },
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          `UPSTREAM_PRESERVATION mode=baseline candidate=${baselineCandidateSha} base=${baselineCandidateSha}`,
        );
        expect(result.stdout).toContain("INVENTORY status=PASS");
        expect(result.stdout).toContain("CHECK id=icon-composer-live-evidence status=NOT RUN");
      });
    },
  );

  it("rejects repository and inventory overrides outside baseline mode", () => {
    for (const mode of ["ci", "human-review"] as const) {
      for (const override of ["--repository-root", "--inventory"] as const) {
        const result = NodeChildProcess.spawnSync(
          process.execPath,
          [
            scriptPath,
            "--mode",
            mode,
            override,
            repositoryRoot,
            "--candidate",
            currentSha,
            "--base",
            currentSha,
            "--upstream",
            upstreamSha,
            "--upstream-base",
            upstreamBaseSha,
          ],
          { cwd: repositoryRoot, encoding: "utf8" },
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain(`${override} is only supported in baseline mode`);
      }
    }
  });

  it("rejects an inventory that removes a mandatory verification", () => {
    const inventory = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(repositoryRoot, "docs/upstream/retained-behavior.v1.json"),
        "utf8",
      ),
    ) as { entries: Array<unknown> };

    expect(() =>
      validateInventory({ ...inventory, entries: inventory.entries.slice(1) }, repositoryRoot),
    ).toThrow("exactly");
  });

  it("rejects skip metadata added to the inventory", () => {
    const inventory = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(repositoryRoot, "docs/upstream/retained-behavior.v1.json"),
        "utf8",
      ),
    ) as { entries: Array<Record<string, unknown>> };
    const [firstEntry] = inventory.entries;
    if (firstEntry === undefined) throw new Error("Inventory fixture is empty.");

    expect(() =>
      validateInventory(
        { ...inventory, entries: [{ ...firstEntry, skip: true }, ...inventory.entries.slice(1)] },
        repositoryRoot,
      ),
    ).toThrow("not allowed");
  });

  it("rejects an inventory checker binding mutation", () => {
    const inventory = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(repositoryRoot, "docs/upstream/retained-behavior.v1.json"),
        "utf8",
      ),
    ) as { entries: Array<Record<string, unknown>> };
    const [firstEntry] = inventory.entries;
    if (firstEntry === undefined) throw new Error("Inventory fixture is empty.");
    const evidence = firstEntry.evidence as Record<string, unknown>;

    expect(() =>
      validateInventory(
        {
          ...inventory,
          entries: [
            { ...firstEntry, evidence: { ...evidence, verification: "different-check" } },
            ...inventory.entries.slice(1),
          ],
        },
        repositoryRoot,
      ),
    ).toThrow("checker binding");
  });

  it("rejects placeholder inventory titles and retained outcomes", () => {
    const inventory = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(repositoryRoot, "docs/upstream/retained-behavior.v1.json"),
        "utf8",
      ),
    ) as { entries: Array<Record<string, unknown>> };
    const [firstEntry] = inventory.entries;
    if (firstEntry === undefined) throw new Error("Inventory fixture is empty.");

    expect(() =>
      validateInventory(
        {
          ...inventory,
          entries: [{ ...firstEntry, title: "<retained title>" }, ...inventory.entries.slice(1)],
        },
        repositoryRoot,
      ),
    ).toThrow("title");
    expect(() =>
      validateInventory(
        {
          ...inventory,
          entries: [{ ...firstEntry, retainedOutcome: "TODO" }, ...inventory.entries.slice(1)],
        },
        repositoryRoot,
      ),
    ).toThrow("retained outcome");
  });

  it("identifies an inventory-only retained outcome change", () => {
    const inventory = JSON.parse(
      NodeFS.readFileSync(
        NodePath.join(repositoryRoot, "docs/upstream/retained-behavior.v1.json"),
        "utf8",
      ),
    ) as { entries: InventoryEntry[] };
    const [firstEntry, ...otherEntries] = inventory.entries;
    if (firstEntry === undefined) throw new Error("Inventory fixture is empty.");

    const candidateEntries: InventoryEntry[] = [
      { ...firstEntry, retainedOutcome: `${firstEntry.retainedOutcome} Updated.` },
      ...otherEntries,
    ];
    expect(changedInventoryOutcomeDetails(undefined, candidateEntries)).toEqual([]);
    expect(changedInventoryOutcomeDetails(inventory.entries, candidateEntries)).toEqual([
      { id: firstEntry.id, paths: [...firstEntry.ownerPaths].sort() },
    ]);
    const refs = resolveRefs(repositoryRoot, {
      candidate: currentSha,
      base: currentSha,
      upstream: upstreamSha,
      upstreamBase: upstreamBaseSha,
    });
    const changed = changedInventoryOutcomeDetails(inventory.entries, candidateEntries);
    const changedOutcome = changed[0];
    if (changedOutcome === undefined) throw new Error("Inventory fixture did not change.");
    expect(() =>
      validateIntegrationRecord(
        {
          schemaVersion: 1,
          candidate: refs.candidate,
          base: refs.base,
          upstream: refs.upstream,
          upstreamBase: refs.upstreamBase,
          dispositions: [],
        },
        refs,
        [changedOutcome.id],
        new Map([[changedOutcome.id, changedOutcome.paths]]),
        repositoryRoot,
      ),
    ).toThrow("Missing TAKE/SKIP disposition");
  });

  it("preflights every grouped command path as mandatory evidence", () => {
    expect(
      missingRequiredPaths(repositoryRoot, {
        requiredPaths: ["scripts/check-upstream-preservation.ts", "does-not-exist.ts"],
      }),
    ).toEqual(["does-not-exist.ts"]);
  });

  it("parses rename and copy old/new paths for retained delta review", () => {
    expect(
      parseNameStatusDiff(
        "R100\tapps/desktop/src/old.ts\tapps/desktop/src/new.ts\nC085\tapps/mobile/src/a.ts\tapps/mobile/src/b.ts\nM\tFORK.md",
      ),
    ).toEqual([
      { status: "R100", oldPath: "apps/desktop/src/old.ts", newPath: "apps/desktop/src/new.ts" },
      { status: "C085", oldPath: "apps/mobile/src/a.ts", newPath: "apps/mobile/src/b.ts" },
      { status: "M", oldPath: "FORK.md", newPath: "FORK.md" },
    ]);
    expect(matchesOwnerPath("apps/desktop/src/old.ts", "apps/desktop/src")).toBe(true);
    expect(matchesOwnerPath("apps/desktop/src/new.ts", "apps/desktop/src")).toBe(true);
  });

  it(
    "fails the public preservation gate for a retained state-path regression",
    { timeout: 5 * 60 * 1000 },
    () => {
      withRetainedRegressionWorktree((temporaryRoot, candidateSha) => {
        const result = NodeChildProcess.spawnSync(
          process.execPath,
          [
            "scripts/check-upstream-preservation.ts",
            "--mode",
            "baseline",
            "--candidate",
            candidateSha,
            "--base",
            candidateSha,
            "--upstream",
            upstreamSha,
            "--upstream-base",
            upstreamBaseSha,
          ],
          { cwd: temporaryRoot, encoding: "utf8" },
        );

        expect(result.status).toBe(1);
        expect(result.stdout).toContain(
          "CHECK id=state-isolation status=FAIL detail=command vp test run apps/desktop/src/app/DesktopStatePaths.test.ts apps/desktop/src/app/DesktopEnvironment.test.ts",
        );
      });
    },
  );

  it("fails the public preservation gate when a grouped test path is missing", () => {
    withRetainedRegressionWorktree((temporaryRoot, candidateSha, commitFixture) => {
      NodeFS.rmSync(
        NodePath.join(temporaryRoot, "apps/desktop/src/app/DesktopEnvironment.test.ts"),
      );
      candidateSha = commitFixture();
      const result = NodeChildProcess.spawnSync(
        process.execPath,
        [
          "scripts/check-upstream-preservation.ts",
          "--mode",
          "baseline",
          "--candidate",
          candidateSha,
          "--base",
          candidateSha,
          "--upstream",
          upstreamSha,
          "--upstream-base",
          upstreamBaseSha,
        ],
        { cwd: temporaryRoot, encoding: "utf8" },
      );

      expect(result.status).toBe(1);
      expect(result.stdout).toContain(
        "CHECK id=state-isolation status=FAIL detail=missing required path apps/desktop/src/app/DesktopEnvironment.test.ts",
      );
    }, false);
  });

  it("requires evidence to be an existing repository artifact", () => {
    const evidenceDirectory = makeEvidenceDirectory();
    const ignoredArtifact = NodePath.join(evidenceDirectory, "ignored-artifact.json");
    NodeFS.writeFileSync(ignoredArtifact, "{}");
    try {
      expect(resolveEvidenceArtifact(repositoryRoot, relativeRepositoryPath(ignoredArtifact))).toBe(
        ignoredArtifact,
      );
    } finally {
      NodeFS.rmSync(evidenceDirectory, { recursive: true, force: true });
    }
    expect(
      resolveEvidenceArtifact(repositoryRoot, "docs/upstream/kat-3297-decisions.tsv"),
    ).toContain("kat-3297-decisions.tsv");
    expect(() => resolveEvidenceArtifact(repositoryRoot, "../AGENTS.md")).toThrow(
      "repository-relative",
    );
    expect(() =>
      resolveEvidenceArtifact(
        repositoryRoot,
        "docs/upstream/kat-3307-integration-record.example.json",
      ),
    ).toThrow("repository-relative");
    expect(() => resolveEvidenceArtifact(repositoryRoot, "docs/upstream/<artifact>.json")).toThrow(
      "repository-relative",
    );
    expect(() => resolveEvidenceArtifact(repositoryRoot, "docs/upstream/missing.json")).toThrow(
      "does not exist",
    );
  });

  it("reports live checks as PASS only with exact-ref manual evidence", () => {
    const headSha = resolveCommitRef(repositoryRoot, "HEAD");
    const refs = {
      candidate: headSha,
      base: headSha,
      upstream: currentUpstreamSha,
      upstreamBase: upstreamBaseSha,
    };
    const evidenceDirectory = makeEvidenceDirectory();
    const iconBindingPath = writeEvidenceBinding(
      evidenceDirectory,
      refs,
      "icon-composer-live-evidence",
      {
        kind: "manual",
        checkId: "icon-composer-live-evidence",
        status: "PASS",
        observer: "maintainer",
        observedAt: "2026-09-09T00:00:00Z",
      },
    );
    const deviceBindingPath = writeEvidenceBinding(
      evidenceDirectory,
      refs,
      "human-device-provider-evidence",
      {
        kind: "manual",
        checkId: "human-device-provider-evidence",
        status: "PASS",
        observer: "maintainer",
        observedAt: "2026-09-09T00:00:00Z",
      },
    );
    const androidBindingPath = writeEvidenceBinding(
      evidenceDirectory,
      refs,
      "mobile-android-asset-live-evidence",
      {
        kind: "manual",
        checkId: "mobile-android-asset-live-evidence",
        status: "PASS",
        observer: "maintainer",
        observedAt: "2026-09-09T00:00:00Z",
      },
    );
    const relativePath = `${relativeRepositoryPath(evidenceDirectory)}/manual-evidence.json`;
    const absolutePath = NodePath.resolve(repositoryRoot, relativePath);
    NodeFS.writeFileSync(
      absolutePath,
      JSON.stringify({
        schemaVersion: 1,
        ...refs,
        checks: [
          {
            checkId: "icon-composer-live-evidence",
            status: "PASS",
            evidence: { path: iconBindingPath },
            observer: "maintainer",
            observedAt: "2026-09-09T00:00:00Z",
          },
          {
            checkId: "human-device-provider-evidence",
            status: "PASS",
            evidence: { path: deviceBindingPath },
            observer: "maintainer",
            observedAt: "2026-09-09T00:00:00Z",
          },
          {
            checkId: "mobile-android-asset-live-evidence",
            status: "PASS",
            evidence: { path: androidBindingPath },
            observer: "maintainer",
            observedAt: "2026-09-09T00:00:00Z",
          },
        ],
      }),
    );
    try {
      const report = runPreservation({
        mode: "human-review",
        repositoryRoot,
        ...refs,
        manualEvidencePath: relativePath,
        commandExecutor: () => "PASS",
        executionTreeCheck: () => undefined,
      });
      expect(report.exitCode).toBe(0);
      expect(report.lines).toContain("CHECK id=icon-composer-live-evidence status=PASS");
      expect(report.lines).toContain("CHECK id=human-device-provider-evidence status=PASS");
      expect(report.lines).toContain("CHECK id=mobile-android-asset-live-evidence status=PASS");
      expect(report.lines).toContain("HUMAN_REVIEW_ACCEPTANCE status=PASS");
    } finally {
      NodeFS.rmSync(evidenceDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a retained assertion changed in the candidate checkout", () => {
    withRetainedRegressionWorktree((temporaryRoot, candidateSha) => {
      const assertionPath = NodePath.join(
        temporaryRoot,
        "apps/desktop/src/app/DesktopStatePaths.test.ts",
      );
      NodeFS.appendFileSync(assertionPath, "\nexport const weakened = true;\n");
      const report = runPreservation({
        mode: "baseline",
        repositoryRoot: temporaryRoot,
        candidate: candidateSha,
        base: currentSha,
        upstream: upstreamSha,
        upstreamBase: upstreamBaseSha,
        commandExecutor: () => "PASS",
        executionTreeCheck: () => undefined,
      });
      expect(report.results).toContainEqual({
        id: "state-isolation",
        status: "FAIL",
        reason: "trusted assertion changed apps/desktop/src/app/DesktopStatePaths.test.ts",
      });
    });
  });

  it("does not freeze release-asset-names.test.ts as a trusted assertion", () => {
    const check = PRESERVATION_CHECKS.find(
      (candidate) => candidate.id === "release-package-ownership",
    );
    expect(check?.id).toBe("release-package-ownership");
    expect(check?.ownerPaths).toEqual([
      "package.json",
      "scripts/release-asset-names.ts",
      "scripts/release-asset-names.test.ts",
      "scripts/update-release-package-versions.ts",
      ".github/workflows/release.yml",
    ]);
    expect(
      loadInventory(repositoryRoot).entries.find(
        (entry) => entry.id === "release-package-ownership",
      )?.ownerPaths,
    ).toEqual(check?.ownerPaths);
    const command = check?.commands[0];
    if (command === undefined) throw new Error("release-package-ownership has no command");
    expect(command.trustedPaths).toEqual(["scripts/update-release-package-versions.test.ts"]);
    expect(command.requiredPaths).toEqual([
      "scripts/release-asset-names.test.ts",
      "scripts/update-release-package-versions.test.ts",
    ]);
    const emptyRoot = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "kata-release-assets-required-"),
    );
    try {
      expect(missingRequiredPaths(emptyRoot, command)).toEqual(command.requiredPaths);
    } finally {
      NodeFS.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("reports a test-only scripts/release-asset-names.test.ts edit as a changed retained outcome", () => {
    const headSha = resolveCommitRef(repositoryRoot, "HEAD");
    const temporaryRoot = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "kat-3386-release-asset-names-"),
    );
    const add = NodeChildProcess.spawnSync(
      "git",
      ["worktree", "add", "--detach", temporaryRoot, headSha],
      { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    expect(add.status).toBe(0);
    try {
      for (const relativePath of [
        "scripts/lib/upstream-preservation/checks.ts",
        "docs/upstream/retained-behavior.v1.json",
      ]) {
        NodeFS.copyFileSync(
          NodePath.join(repositoryRoot, relativePath),
          NodePath.join(temporaryRoot, relativePath),
        );
      }
      const baseStaged = NodeChildProcess.spawnSync(
        "git",
        [
          "add",
          "--",
          "scripts/lib/upstream-preservation/checks.ts",
          "docs/upstream/retained-behavior.v1.json",
        ],
        { cwd: temporaryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(baseStaged.status).toBe(0);
      const baseCommit = NodeChildProcess.spawnSync(
        "git",
        [
          "-c",
          "user.name=Kata preservation test",
          "-c",
          "user.email=kata-preservation-test@example.com",
          "commit",
          "--allow-empty",
          "--no-verify",
          "-m",
          "KAT-3386 owner path contract baseline",
        ],
        { cwd: temporaryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(baseCommit.status).toBe(0);
      const baseSha = resolveCommitRef(temporaryRoot, "HEAD");

      NodeFS.appendFileSync(
        NodePath.join(temporaryRoot, "scripts/release-asset-names.test.ts"),
        "\nexport const releaseAssetNamesCandidateChange = true;\n",
      );
      const staged = NodeChildProcess.spawnSync(
        "git",
        ["add", "--", "scripts/release-asset-names.test.ts"],
        { cwd: temporaryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(staged.status).toBe(0);
      const commit = NodeChildProcess.spawnSync(
        "git",
        [
          "-c",
          "user.name=Kata preservation test",
          "-c",
          "user.email=kata-preservation-test@example.com",
          "commit",
          "--no-verify",
          "-m",
          "test-only release asset names change",
        ],
        { cwd: temporaryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(commit.status).toBe(0);
      const candidateSha = resolveCommitRef(temporaryRoot, "HEAD");
      const report = runPreservation({
        mode: "human-review",
        repositoryRoot: temporaryRoot,
        candidate: candidateSha,
        base: baseSha,
        upstream: currentUpstreamSha,
        upstreamBase: upstreamBaseSha,
        commandExecutor: () => "PASS",
        executionTreeCheck: () => undefined,
      });

      expect(report.lines).toContain(
        "CHANGED_RETAINED_OUTCOMES status=NOT RUN ids=release-package-ownership",
      );
      expect(report.lines).toContain("INTEGRATION_RECORD status=NOT RUN");
      expect(report.exitCode).toBe(1);
    } finally {
      const remove = NodeChildProcess.spawnSync(
        "git",
        ["worktree", "remove", "--force", temporaryRoot],
        { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
      expect(remove.status).toBe(0);
      NodeFS.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("does not freeze KataUpstreamUpgrade.test.ts as a trusted assertion", () => {
    const check = PRESERVATION_CHECKS.find((candidate) => candidate.id === "migration-identity");
    expect(check?.id).toBe("migration-identity");
    const command = check?.commands[0];
    if (command === undefined) throw new Error("migration-identity has no command");
    expect(check?.ownerPaths).toEqual([
      "apps/server/src/persistence/Migrations.ts",
      "apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
    ]);
    expect(command.trustedPaths).toEqual([]);
    expect(command.requiredPaths).toEqual([
      "apps/server/src/persistence/Migrations.ts",
      "apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
    ]);
    expect(command.display).toBe(
      "vp test run apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
    );
    const emptyRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kat-3340-required-"));
    try {
      expect(missingRequiredPaths(emptyRoot, command)).toEqual(command.requiredPaths);
    } finally {
      NodeFS.rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it("accepts a KataUpstreamUpgrade.test.ts catalog-range edit", () => {
    withRetainedRegressionWorktree((temporaryRoot, candidateSha) => {
      const assertionPath = NodePath.join(
        temporaryRoot,
        "apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
      );
      const original = NodeFS.readFileSync(assertionPath, "utf8");
      const mutated = original.replace(
        "[43, 44, 45, 46, 47, 48, 49, 50, 51]",
        "[43, 44, 45, 46, 47, 48, 49, 50, 51, 52]",
      );
      if (mutated === original) throw new Error("Upgrade test range fixture did not mutate.");
      NodeFS.writeFileSync(assertionPath, mutated);
      const report = runPreservation({
        mode: "ci",
        repositoryRoot: temporaryRoot,
        candidate: candidateSha,
        base: currentSha,
        upstream: upstreamSha,
        upstreamBase: upstreamBaseSha,
        commandExecutor: () => "PASS",
        executionTreeCheck: () => undefined,
      });
      expect(report.lines).toContain("CHECK id=migration-identity status=PASS");
      expect(report.lines).not.toContain(
        "CHECK id=migration-identity status=FAIL detail=trusted assertion changed apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
      );
    }, false);
  });

  it("keeps shipped migration catalog IDs 41 through 51", () => {
    const catalog = NodeFS.readFileSync(
      NodePath.join(repositoryRoot, "apps/server/src/persistence/Migrations.ts"),
      "utf8",
    );
    for (const id of [41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51]) {
      expect(catalog).toContain(`[${id},`);
    }
  });

  describe("retired sandbox checks (KAT-3543)", () => {
    const retiredIds = new Set(["sandbox-preview-default", "sandbox-route-driver-registration"]);
    const retiredPaths = new Set([
      "apps/server/src/kataSandbox/migrations.ts",
      "apps/server/src/kataSandbox/migrations.test.ts",
    ]);
    const providerTest = "apps/server/src/provider/ProviderInstanceEnvironment.test.ts";
    const inventoryPath = (root: string) =>
      NodePath.join(root, "docs/upstream/retained-behavior.v1.json");
    type Entry = { id: string; ownerPaths: Array<string>; retainedOutcome: string };
    const rewriteInventory = (root: string, update: (entries: Array<Entry>) => void) => {
      const inventory = JSON.parse(NodeFS.readFileSync(inventoryPath(root), "utf8")) as {
        entries: Array<Entry>;
      };
      update(inventory.entries);
      NodeFS.writeFileSync(inventoryPath(root), `${JSON.stringify(inventory, null, 2)}\n`);
    };
    const removeSandbox = (root: string) => {
      NodeFS.rmSync(NodePath.join(root, "apps/server/src/kataSandbox"), {
        recursive: true,
        force: true,
      });
      rewriteInventory(root, (entries) => {
        for (const id of retiredIds) {
          entries.splice(
            entries.findIndex((entry) => entry.id === id),
            1,
          );
        }
        for (const entry of entries) {
          entry.ownerPaths = entry.ownerPaths.filter((path) => !retiredPaths.has(path));
        }
      });
    };
    const runCandidate = (root: string, candidateSha: string) => {
      const executed: Array<string> = [];
      const report = runPreservation({
        mode: "ci",
        repositoryRoot: root,
        candidate: candidateSha,
        base: currentSha,
        upstream: upstreamSha,
        upstreamBase: upstreamBaseSha,
        commandExecutor: (_root, command) => {
          executed.push(command.display);
          return "PASS";
        },
        executionTreeCheck: () => undefined,
      });
      return { report, executed };
    };

    it("runs neither retired check, no retired path, and no freeze on the unfrozen test", () => {
      expect(PRESERVATION_CHECKS.length).toBe(30);
      const ids = PRESERVATION_CHECKS.map((check) => check.id);
      expect(ids.filter((id) => retiredIds.has(id))).toEqual([]);
      const contractPaths = PRESERVATION_CHECKS.flatMap((check) => [
        ...check.ownerPaths,
        ...check.commands.flatMap((command) => [
          ...command.args,
          ...command.requiredPaths,
          ...(command.trustedPaths ?? []),
        ]),
      ]);
      expect(contractPaths.filter((path) => retiredPaths.has(path))).toEqual([]);
      const provider = PRESERVATION_CHECKS.find(
        (check) => check.id === "provider-sandbox-environment-isolation",
      );
      expect(provider?.commands[0]?.requiredPaths).toEqual([providerTest]);
      expect(provider?.commands[0]?.trustedPaths).toEqual([]);
    });

    it("accepts an inventory that still lists the retired checks and paths", () => {
      withRetainedRegressionWorktree((temporaryRoot, candidateSha) => {
        const { report, executed } = runCandidate(temporaryRoot, candidateSha);
        expect(report.lines).toContain("INVENTORY status=PASS");
        expect(report.lines).toContain("CHECK id=migration-identity status=PASS");
        expect(
          report.lines.filter((line) => [...retiredIds].some((id) => line.includes(id))),
        ).toEqual([]);
        expect(executed).toContain(
          "vp test run apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
        );
      }, false);
    });

    it("passes a candidate that deletes the sandbox and its bootstrap-token test case", () => {
      withRetainedRegressionWorktree((temporaryRoot, _candidateSha, commitFixture) => {
        removeSandbox(temporaryRoot);
        NodeFS.appendFileSync(
          NodePath.join(temporaryRoot, providerTest),
          "\n// Sandbox bootstrap-token case removed.\n",
        );
        const { report } = runCandidate(temporaryRoot, commitFixture());
        expect(report.lines).toContain("INVENTORY status=PASS");
        expect(report.lines).toContain("CHECK id=migration-identity status=PASS");
        expect(report.lines).toContain(
          "CHECK id=provider-sandbox-environment-isolation status=PASS",
        );
        expect(report.lines.filter((line) => line.includes("status=FAIL"))).toEqual([]);
      }, false);
    });

    it("still fails a removal that also drops a non-retired entry", () => {
      withRetainedRegressionWorktree((temporaryRoot, _candidateSha, commitFixture) => {
        removeSandbox(temporaryRoot);
        rewriteInventory(temporaryRoot, (entries) => {
          entries.splice(
            entries.findIndex((entry) => entry.id === "state-isolation"),
            1,
          );
        });
        const { report } = runCandidate(temporaryRoot, commitFixture());
        expect(report.lines).toContain(
          "INVENTORY status=FAIL detail=Inventory must contain exactly 30 entries; found 29.",
        );
      }, false);
    });

    it("still fails a removal that also drops a non-retired owner path", () => {
      withRetainedRegressionWorktree((temporaryRoot, _candidateSha, commitFixture) => {
        removeSandbox(temporaryRoot);
        rewriteInventory(temporaryRoot, (entries) => {
          const entry = entries.find((candidate) => candidate.id === "migration-identity");
          if (entry === undefined) throw new Error("migration-identity entry is missing.");
          entry.ownerPaths = entry.ownerPaths.filter(
            (path) => path !== "apps/server/src/persistence/Migrations.ts",
          );
        });
        const { report } = runCandidate(temporaryRoot, commitFixture());
        expect(report.lines).toContain(
          "INVENTORY status=FAIL detail=Inventory owner paths for migration-identity do not match the code contract.",
        );
      }, false);
    });

    it("rejects a retired path listed on an entry whose contract never had it", () => {
      withRetainedRegressionWorktree((temporaryRoot, _candidateSha, commitFixture) => {
        rewriteInventory(temporaryRoot, (entries) => {
          const entry = entries.find((candidate) => candidate.id === "state-isolation");
          if (entry === undefined) throw new Error("state-isolation entry is missing.");
          entry.ownerPaths.push("apps/server/src/kataSandbox/migrations.ts");
        });
        const { report } = runCandidate(temporaryRoot, commitFixture());
        expect(report.lines).toContain(
          "INVENTORY status=FAIL detail=Inventory owner paths for state-isolation do not match the code contract.",
        );
      }, false);
    });

    it("rejects an entry that lists an owner path twice", () => {
      withRetainedRegressionWorktree((temporaryRoot, _candidateSha, commitFixture) => {
        rewriteInventory(temporaryRoot, (entries) => {
          const entry = entries.find((candidate) => candidate.id === "migration-identity");
          if (entry === undefined) throw new Error("migration-identity entry is missing.");
          entry.ownerPaths.push("apps/server/src/kataSandbox/migrations.ts");
        });
        const { report } = runCandidate(temporaryRoot, commitFixture());
        expect(report.lines).toContain(
          "INVENTORY status=FAIL detail=Inventory owner paths for migration-identity do not match the code contract.",
        );
      }, false);
    });

    it("ignores retired owner paths in the outcome diff but still reports a real edit", () => {
      const inventory = JSON.parse(
        NodeFS.readFileSync(
          NodePath.join(repositoryRoot, "docs/upstream/retained-behavior.v1.json"),
          "utf8",
        ),
      ) as { entries: Array<InventoryEntry> };
      const withoutRetired = inventory.entries.map((entry) => ({
        ...entry,
        ownerPaths: entry.ownerPaths.filter((path) => !retiredPaths.has(path)),
      }));
      expect(changedInventoryOutcomeDetails(inventory.entries, withoutRetired)).toEqual([]);
      const edited = withoutRetired.map((entry) =>
        entry.id === "migration-identity"
          ? { ...entry, retainedOutcome: `${entry.retainedOutcome} Edited.` }
          : entry,
      );
      expect(changedInventoryOutcomeDetails(inventory.entries, edited)).toEqual([
        {
          id: "migration-identity",
          paths: [
            "apps/server/src/persistence/Migrations.ts",
            "apps/server/src/persistence/Migrations/KataUpstreamUpgrade.test.ts",
          ],
        },
      ]);
    });

    describe("retirement table validation", () => {
      const command = (
        paths: ReadonlyArray<string>,
        extraRequired: ReadonlyArray<string> = [],
      ) => ({
        display: `run ${paths.join(" ")}`,
        executable: "node",
        args: [...paths],
        requiredPaths: [...paths, ...extraRequired],
        trustedPaths: [...paths],
      });
      const contract: ReadonlyArray<PreservationCheck> = [
        {
          id: "alpha",
          title: "Alpha",
          evidenceKind: "automated",
          evidenceProfile: "portable",
          ownerPaths: ["src/alpha.ts", "src/shared.ts"],
          specRefs: ["docs/alpha.md"],
          commands: [command(["src/alpha.test.ts"], ["src/alpha-config.json"])],
        },
        {
          id: "beta",
          title: "Beta",
          evidenceKind: "automated",
          evidenceProfile: "portable",
          ownerPaths: ["src/beta.ts"],
          specRefs: ["docs/beta.md"],
          commands: [command(["src/beta.test.ts"])],
        },
      ];
      const tables = (overrides: Partial<RetirementTables>): RetirementTables => ({
        checks: new Map(),
        paths: new Map(),
        unfrozenTrustedPaths: new Map(),
        ...overrides,
      });
      const why = { issue: "KAT-0000", reason: "Test fixture." };

      it("applies retired checks, retired paths, and unfrozen trusted paths", () => {
        const checks = applyRetirements(
          contract,
          tables({
            checks: new Map([["beta", why]]),
            paths: new Map([["src/shared.ts", why]]),
            unfrozenTrustedPaths: new Map([["src/alpha.test.ts", why]]),
          }),
        );
        expect(checks.map((check) => check.id)).toEqual(["alpha"]);
        expect(checks[0]?.ownerPaths).toEqual(["src/alpha.ts"]);
        expect(checks[0]?.commands[0]?.requiredPaths).toEqual([
          "src/alpha.test.ts",
          "src/alpha-config.json",
        ]);
        expect(checks[0]?.commands[0]?.trustedPaths).toEqual([]);
      });

      it("rejects a retired check that is not in the contract", () => {
        expect(() =>
          applyRetirements(contract, tables({ checks: new Map([["gamma", why]]) })),
        ).toThrow("Retired check gamma is not in the preservation contract.");
      });

      it("rejects a retired path that is not in the contract", () => {
        expect(() =>
          applyRetirements(contract, tables({ paths: new Map([["src/missing.ts", why]]) })),
        ).toThrow("Retired path src/missing.ts is not in the preservation contract.");
      });

      it("rejects an unfrozen path that is not an active trusted path", () => {
        expect(() =>
          applyRetirements(
            contract,
            tables({
              checks: new Map([["beta", why]]),
              unfrozenTrustedPaths: new Map([["src/beta.test.ts", why]]),
            }),
          ),
        ).toThrow("Unfrozen path src/beta.test.ts is not an active trusted path.");
      });

      it("rejects a retirement that leaves a check without owner paths", () => {
        expect(() =>
          applyRetirements(contract, tables({ paths: new Map([["src/beta.ts", why]]) })),
        ).toThrow("Retired paths leave check beta without owner paths.");
      });

      it("rejects a retirement that leaves a command without required paths", () => {
        expect(() =>
          applyRetirements(contract, tables({ paths: new Map([["src/beta.test.ts", why]]) })),
        ).toThrow("Retired paths leave check beta with a command that has no required paths.");
      });

      it("rejects a retirement that leaves a command without path arguments", () => {
        expect(() =>
          applyRetirements(contract, tables({ paths: new Map([["src/alpha.test.ts", why]]) })),
        ).toThrow("Retired paths leave check alpha with a command that has no path arguments.");
      });

      it("holds exactly the sandbox retirements from KAT-3543", () => {
        expect([...RETIREMENTS.checks.keys()]).toEqual([
          "sandbox-preview-default",
          "sandbox-route-driver-registration",
        ]);
        expect([...RETIREMENTS.paths.keys()]).toEqual([
          "apps/server/src/kataSandbox/migrations.ts",
          "apps/server/src/kataSandbox/migrations.test.ts",
        ]);
        expect([...RETIREMENTS.unfrozenTrustedPaths.keys()]).toEqual([
          "apps/server/src/provider/ProviderInstanceEnvironment.test.ts",
        ]);
        const issues = [
          ...RETIREMENTS.checks.values(),
          ...RETIREMENTS.paths.values(),
          ...RETIREMENTS.unfrozenTrustedPaths.values(),
        ].map((retirement) => retirement.issue);
        expect(new Set(issues)).toEqual(new Set(["KAT-3543"]));
        expect(PRESERVATION_CONTRACT.length).toBe(32);
      });
    });
  });

  it("requires exact machine-verifiable evidence bindings", () => {
    const refs = resolveRefs(repositoryRoot, {
      candidate: currentSha,
      base: currentSha,
      upstream: upstreamSha,
      upstreamBase: upstreamBaseSha,
    });
    const evidenceDirectory = makeEvidenceDirectory();
    const manualExpectation = {
      kind: "manual" as const,
      refs,
      checkId: "icon-composer-live-evidence",
      status: "PASS" as const,
      observer: "maintainer",
      observedAt: "2026-09-09T00:00:00Z",
    };
    const integrationExpectation = {
      kind: "integration" as const,
      refs,
      checkId: "state-isolation",
      decision: "TAKE" as const,
      scopePaths: ["apps/desktop/src/app/DesktopStatePaths.ts"],
      approvedBy: "maintainer",
      approvedAt: "2026-09-09T00:00:00Z",
    };
    const rewrite = (relativePath: string, update: (value: Record<string, unknown>) => void) => {
      const absolutePath = NodePath.resolve(repositoryRoot, relativePath);
      const value = JSON.parse(NodeFS.readFileSync(absolutePath, "utf8")) as Record<
        string,
        unknown
      >;
      update(value);
      NodeFS.writeFileSync(absolutePath, JSON.stringify(value));
    };

    try {
      const validManualPath = writeEvidenceBinding(evidenceDirectory, refs, "valid-manual", {
        kind: "manual",
        checkId: manualExpectation.checkId,
        status: "PASS",
        observer: manualExpectation.observer,
        observedAt: manualExpectation.observedAt,
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, validManualPath, manualExpectation),
      ).not.toThrow();

      const staleRefsPath = writeEvidenceBinding(evidenceDirectory, refs, "stale-refs", {
        kind: "manual",
        checkId: manualExpectation.checkId,
        status: "PASS",
        observer: manualExpectation.observer,
        observedAt: manualExpectation.observedAt,
      });
      rewrite(staleRefsPath, (value) => {
        value.candidate = "0000000000000000000000000000000000000000";
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, staleRefsPath, manualExpectation),
      ).toThrow("refs do not exactly match");

      const staleProsePath = "docs/upstream/kat-3297-verification.md";
      expect(() =>
        validateEvidenceBinding(repositoryRoot, staleProsePath, manualExpectation),
      ).toThrow("Could not read evidence binding");
      expect(() =>
        validateEvidenceBinding(
          repositoryRoot,
          "docs/upstream/kat-3307-evidence-binding.example.json",
          manualExpectation,
        ),
      ).toThrow("repository-relative");

      const wrongCheckPath = writeEvidenceBinding(evidenceDirectory, refs, "wrong-check", {
        kind: "manual",
        checkId: "human-device-provider-evidence",
        status: "PASS",
        observer: manualExpectation.observer,
        observedAt: manualExpectation.observedAt,
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, wrongCheckPath, manualExpectation),
      ).toThrow("checkId");

      const wrongStatusPath = writeEvidenceBinding(evidenceDirectory, refs, "wrong-status", {
        kind: "manual",
        checkId: manualExpectation.checkId,
        observer: manualExpectation.observer,
        observedAt: manualExpectation.observedAt,
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, wrongStatusPath, manualExpectation),
      ).toThrow("status");

      const wrongDecisionPath = writeEvidenceBinding(evidenceDirectory, refs, "wrong-decision", {
        kind: "integration",
        checkId: integrationExpectation.checkId,
        decision: "SKIP",
        scopePaths: integrationExpectation.scopePaths,
        approvedBy: integrationExpectation.approvedBy,
        approvedAt: integrationExpectation.approvedAt,
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, wrongDecisionPath, integrationExpectation),
      ).toThrow("decision");

      const wrongScopePath = writeEvidenceBinding(evidenceDirectory, refs, "wrong-scope", {
        kind: "integration",
        checkId: integrationExpectation.checkId,
        decision: integrationExpectation.decision,
        scopePaths: ["apps/server/src/serverSettings.ts"],
        approvedBy: integrationExpectation.approvedBy,
        approvedAt: integrationExpectation.approvedAt,
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, wrongScopePath, integrationExpectation),
      ).toThrow("scopePaths");

      const placeholderResultPath = writeEvidenceBinding(
        evidenceDirectory,
        refs,
        "placeholder-result",
        {
          kind: "manual",
          checkId: manualExpectation.checkId,
          status: "PASS",
          observer: manualExpectation.observer,
          observedAt: manualExpectation.observedAt,
        },
      );
      rewrite(placeholderResultPath, (value) => {
        value.result = "<result>";
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, placeholderResultPath, manualExpectation),
      ).toThrow("placeholder");

      const missingArtifactPath = writeEvidenceBinding(
        evidenceDirectory,
        refs,
        "missing-artifact",
        {
          kind: "manual",
          checkId: manualExpectation.checkId,
          status: "PASS",
          observer: manualExpectation.observer,
          observedAt: manualExpectation.observedAt,
        },
      );
      rewrite(missingArtifactPath, (value) => {
        value.artifactPaths = ["docs/upstream/missing-evidence-result.txt"];
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, missingArtifactPath, manualExpectation),
      ).toThrow("does not exist");

      const circularPath = writeEvidenceBinding(evidenceDirectory, refs, "circular", {
        kind: "manual",
        checkId: manualExpectation.checkId,
        status: "PASS",
        observer: manualExpectation.observer,
        observedAt: manualExpectation.observedAt,
      });
      rewrite(circularPath, (value) => {
        value.artifactPaths = [circularPath];
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, circularPath, manualExpectation),
      ).toThrow("cannot reference itself");

      const validIntegrationPath = writeEvidenceBinding(
        evidenceDirectory,
        refs,
        "valid-integration",
        {
          kind: "integration",
          checkId: integrationExpectation.checkId,
          decision: integrationExpectation.decision,
          scopePaths: integrationExpectation.scopePaths,
          approvedBy: integrationExpectation.approvedBy,
          approvedAt: integrationExpectation.approvedAt,
        },
      );
      expect(() =>
        validateEvidenceBinding(repositoryRoot, validIntegrationPath, integrationExpectation),
      ).not.toThrow();

      const tamperedArtifactBindingPath = writeEvidenceBinding(
        evidenceDirectory,
        refs,
        "tampered-result-artifact",
        {
          kind: "manual",
          checkId: manualExpectation.checkId,
          status: "PASS",
          observer: manualExpectation.observer,
          observedAt: manualExpectation.observedAt,
        },
      );
      const tamperedBinding = JSON.parse(
        NodeFS.readFileSync(NodePath.resolve(repositoryRoot, tamperedArtifactBindingPath), "utf8"),
      ) as { artifactPaths: [string] };
      rewrite(tamperedBinding.artifactPaths[0], (value) => {
        value.digest = "0".repeat(64);
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, tamperedArtifactBindingPath, manualExpectation),
      ).toThrow("digest");

      const placeholderProducerBindingPath = writeEvidenceBinding(
        evidenceDirectory,
        refs,
        "placeholder-producer",
        {
          kind: "manual",
          checkId: manualExpectation.checkId,
          status: "PASS",
          observer: manualExpectation.observer,
          observedAt: manualExpectation.observedAt,
        },
      );
      const placeholderProducerBinding = JSON.parse(
        NodeFS.readFileSync(
          NodePath.resolve(repositoryRoot, placeholderProducerBindingPath),
          "utf8",
        ),
      ) as { artifactPaths: [string] };
      rewrite(placeholderProducerBinding.artifactPaths[0], (value) => {
        value.producer = "<producer>";
      });
      expect(() =>
        validateEvidenceBinding(repositoryRoot, placeholderProducerBindingPath, manualExpectation),
      ).toThrow("producer");
    } finally {
      NodeFS.rmSync(evidenceDirectory, { recursive: true, force: true });
    }
  });

  it("requires changed dispositions and live evidence to carry concrete artifacts", () => {
    const refs = resolveRefs(repositoryRoot, {
      candidate: currentSha,
      base: currentSha,
      upstream: upstreamSha,
      upstreamBase: upstreamBaseSha,
    });
    const evidenceDirectory = makeEvidenceDirectory();
    const integrationBindingPath = writeEvidenceBinding(
      evidenceDirectory,
      refs,
      "state-isolation-integration",
      {
        kind: "integration",
        checkId: "state-isolation",
        decision: "TAKE",
        scopePaths: ["apps/desktop/src/app/DesktopStatePaths.ts"],
        approvedBy: "maintainer",
        approvedAt: "2026-09-09T00:00:00Z",
      },
    );
    const iconBindingPath = writeEvidenceBinding(
      evidenceDirectory,
      refs,
      "icon-composer-live-evidence-record",
      {
        kind: "manual",
        checkId: "icon-composer-live-evidence",
        status: "PASS",
        observer: "maintainer",
        observedAt: "2026-09-09T00:00:00Z",
      },
    );
    const deviceBindingPath = writeEvidenceBinding(
      evidenceDirectory,
      refs,
      "human-device-provider-evidence-record",
      {
        kind: "manual",
        checkId: "human-device-provider-evidence",
        status: "PASS",
        observer: "maintainer",
        observedAt: "2026-09-09T00:00:00Z",
      },
    );
    const disposition = {
      checkId: "state-isolation",
      decision: "TAKE",
      scopePaths: ["apps/desktop/src/app/DesktopStatePaths.ts"],
      rationale: "Retain the Kata desktop state directory names.",
      approvedBy: "maintainer",
      approvedAt: "2026-09-09T00:00:00Z",
      evidence: { path: integrationBindingPath },
    } as const;
    const record = {
      schemaVersion: 1,
      candidate: refs.candidate,
      base: refs.base,
      upstream: refs.upstream,
      upstreamBase: refs.upstreamBase,
      dispositions: [disposition],
    };
    const changedScopes = new Map([
      ["state-isolation", ["apps/desktop/src/app/DesktopStatePaths.ts"]],
    ]);

    try {
      expect(() =>
        validateIntegrationRecord(record, refs, ["state-isolation"], changedScopes, repositoryRoot),
      ).not.toThrow();
      expect(() =>
        validateIntegrationRecord(
          {
            ...record,
            dispositions: [{ ...disposition, scope: "legacy scope" }],
          },
          refs,
          ["state-isolation"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("scope is not supported");
      expect(() =>
        validateIntegrationRecord(
          {
            ...record,
            dispositions: [{ ...disposition, evidence: { path: "../AGENTS.md" } }],
          },
          refs,
          ["state-isolation"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("repository-relative");
      expect(() =>
        validateIntegrationRecord(
          {
            ...record,
            dispositions: [{ ...disposition, scopePaths: ["all"] }],
          },
          refs,
          ["state-isolation"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("concrete");
      expect(() =>
        validateIntegrationRecord(
          {
            ...record,
            dispositions: [
              {
                ...disposition,
                scopePaths: [
                  "apps/desktop/src/app/DesktopStatePaths.ts",
                  "apps/desktop/src/app/DesktopStatePaths.ts",
                ],
              },
            ],
          },
          refs,
          ["state-isolation"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("duplicates");
      expect(() =>
        validateIntegrationRecord(
          {
            ...record,
            dispositions: [{ ...disposition, scopePaths: ["<owner path>"] }],
          },
          refs,
          ["state-isolation"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("template");
      expect(() =>
        validateIntegrationRecord(
          { ...record, dispositions: [] },
          refs,
          ["state-isolation"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("Missing TAKE/SKIP disposition");

      const twoChangedPaths = new Map([
        [
          "state-isolation",
          [
            "apps/desktop/src/app/DesktopStatePaths.ts",
            "apps/desktop/src/app/DesktopEnvironment.ts",
          ],
        ],
      ]);
      expect(() =>
        validateIntegrationRecord(
          record,
          refs,
          ["state-isolation"],
          twoChangedPaths,
          repositoryRoot,
        ),
      ).toThrow("exactly cover");
      expect(() =>
        validateIntegrationRecord(
          {
            ...record,
            dispositions: [
              {
                ...disposition,
                scopePaths: [
                  "apps/desktop/src/app/DesktopStatePaths.ts",
                  "apps/server/src/serverSettings.ts",
                  "apps/server/src/server.ts",
                ],
              },
            ],
          },
          refs,
          ["state-isolation"],
          twoChangedPaths,
          repositoryRoot,
        ),
      ).toThrow("exactly cover");

      const manualEvidence = {
        schemaVersion: 1,
        candidate: refs.candidate,
        base: refs.base,
        upstream: refs.upstream,
        upstreamBase: refs.upstreamBase,
        checks: [
          {
            checkId: "icon-composer-live-evidence",
            status: "PASS",
            evidence: { path: iconBindingPath },
            observer: "maintainer",
            observedAt: "2026-09-09T00:00:00Z",
          },
          {
            checkId: "human-device-provider-evidence",
            status: "PASS",
            evidence: { path: deviceBindingPath },
            observer: "maintainer",
            observedAt: "2026-09-09T00:00:00Z",
          },
        ],
      };
      expect(() =>
        validateManualEvidence(
          manualEvidence,
          refs,
          ["icon-composer-live-evidence", "human-device-provider-evidence"],
          repositoryRoot,
        ),
      ).not.toThrow();
      expect(() =>
        validateManualEvidence(
          {
            ...manualEvidence,
            checks: [
              {
                ...manualEvidence.checks[0],
                observer: "<maintainer>",
              },
              manualEvidence.checks[1],
            ],
          },
          refs,
          ["icon-composer-live-evidence", "human-device-provider-evidence"],
          repositoryRoot,
        ),
      ).toThrow("template");
      expect(() =>
        validateManualEvidence(
          {
            ...manualEvidence,
            checks: [
              {
                ...manualEvidence.checks[0],
                observer: "   ",
              },
              manualEvidence.checks[1],
            ],
          },
          refs,
          ["icon-composer-live-evidence", "human-device-provider-evidence"],
          repositoryRoot,
        ),
      ).toThrow("observer");
      expect(() =>
        validateManualEvidence(
          {
            ...manualEvidence,
            checks: [
              {
                ...manualEvidence.checks[0],
                observedAt: "2026-09-09T00:00:00-07:00",
              },
              manualEvidence.checks[1],
            ],
          },
          refs,
          ["icon-composer-live-evidence", "human-device-provider-evidence"],
          repositoryRoot,
        ),
      ).toThrow("UTC timestamp");
      expect(() =>
        validateManualEvidence(
          { ...manualEvidence, checks: [] },
          refs,
          ["icon-composer-live-evidence"],
          repositoryRoot,
        ),
      ).toThrow("Missing mandatory manual evidence");
    } finally {
      NodeFS.rmSync(evidenceDirectory, { recursive: true, force: true });
    }
  });
});
