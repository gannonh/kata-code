// @effect-diagnostics nodeBuiltinImport:off - the public CLI is exercised as a real child process.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";

import {
  calculateResultArtifactDigest,
  changedInventoryOutcomeDetails,
  parseNameStatusDiff,
  matchesOwnerPath,
  resolveRefs,
  resolveCommitRef,
  resolveEvidenceArtifact,
  validateEvidenceBinding,
  runPreservation,
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
const currentUpstreamSha = "36668dbe4fe2f8c881cc4f93bc675413eef1406f";
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
    NodeFS.symlinkSync(source, NodePath.join(destinationParent, "node_modules"), "dir");
  }
};

const withHistoricalBaselineWorktree = <A>(run: (temporaryRoot: string) => A): A => {
  const temporaryRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "kat-3307-baseline-"));
  const add = NodeChildProcess.spawnSync(
    "git",
    ["worktree", "add", "--detach", temporaryRoot, currentSha],
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

const withSandboxRegressionWorktree = <A>(
  run: (temporaryRoot: string, candidateSha: string, commitFixture: () => string) => A,
  mutateSandbox = true,
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

    if (mutateSandbox) {
      const sandboxFeaturePath = NodePath.join(
        temporaryRoot,
        "apps/server/src/kataSandbox/sandboxFeature.ts",
      );
      const original = NodeFS.readFileSync(sandboxFeaturePath, "utf8");
      const mutated = original.replace("return override ?? stored;", "return override ?? !stored;");
      if (mutated === original)
        throw new Error("Sandbox regression fixture did not mutate source.");
      NodeFS.writeFileSync(sandboxFeaturePath, mutated);
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
          "apps/server/src/kataSandbox/sandboxFeature.ts",
          "apps/server/src/kataSandbox/sandboxFeature.test.ts",
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
    withSandboxRegressionWorktree((temporaryRoot, candidateSha) => {
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
      [scriptPath, "--skip", "sandbox-preview-default"],
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

        expect(result.status).toBe(0);
        expect(result.stdout).toContain(
          `UPSTREAM_PRESERVATION mode=baseline candidate=${currentSha} base=${currentSha}`,
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
    "fails the public preservation gate for a retained sandbox regression",
    { timeout: 5 * 60 * 1000 },
    () => {
      withSandboxRegressionWorktree((temporaryRoot, candidateSha) => {
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
          "CHECK id=sandbox-preview-default status=FAIL detail=command vp test run apps/server/src/serverSettings.test.ts apps/server/src/kataSandbox/sandboxFeature.test.ts apps/web/src/components/settings/ConnectionsSettings.sandbox.test.tsx apps/web/src/components/settings/settingsBranding.test.tsx",
        );
      });
    },
  );

  it("fails the public preservation gate when a grouped test path is missing", () => {
    withSandboxRegressionWorktree((temporaryRoot, candidateSha, commitFixture) => {
      NodeFS.rmSync(
        NodePath.join(temporaryRoot, "apps/server/src/kataSandbox/sandboxFeature.test.ts"),
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
        "CHECK id=sandbox-preview-default status=FAIL detail=missing required path apps/server/src/kataSandbox/sandboxFeature.test.ts",
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
    withSandboxRegressionWorktree((temporaryRoot, candidateSha) => {
      const assertionPath = NodePath.join(
        temporaryRoot,
        "apps/server/src/kataSandbox/sandboxFeature.test.ts",
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
        id: "sandbox-preview-default",
        status: "FAIL",
        reason: "trusted assertion changed apps/server/src/kataSandbox/sandboxFeature.test.ts",
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
      checkId: "sandbox-preview-default",
      decision: "TAKE" as const,
      scopePaths: ["apps/server/src/kataSandbox/sandboxFeature.ts"],
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
      "sandbox-preview-default-integration",
      {
        kind: "integration",
        checkId: "sandbox-preview-default",
        decision: "TAKE",
        scopePaths: ["apps/server/src/kataSandbox/sandboxFeature.ts"],
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
      checkId: "sandbox-preview-default",
      decision: "TAKE",
      scopePaths: ["apps/server/src/kataSandbox/sandboxFeature.ts"],
      rationale: "Retain the registered sandbox preview and its stored default.",
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
      ["sandbox-preview-default", ["apps/server/src/kataSandbox/sandboxFeature.ts"]],
    ]);

    try {
      expect(() =>
        validateIntegrationRecord(
          record,
          refs,
          ["sandbox-preview-default"],
          changedScopes,
          repositoryRoot,
        ),
      ).not.toThrow();
      expect(() =>
        validateIntegrationRecord(
          {
            ...record,
            dispositions: [{ ...disposition, scope: "legacy scope" }],
          },
          refs,
          ["sandbox-preview-default"],
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
          ["sandbox-preview-default"],
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
          ["sandbox-preview-default"],
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
                  "apps/server/src/kataSandbox/sandboxFeature.ts",
                  "apps/server/src/kataSandbox/sandboxFeature.ts",
                ],
              },
            ],
          },
          refs,
          ["sandbox-preview-default"],
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
          ["sandbox-preview-default"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("template");
      expect(() =>
        validateIntegrationRecord(
          { ...record, dispositions: [] },
          refs,
          ["sandbox-preview-default"],
          changedScopes,
          repositoryRoot,
        ),
      ).toThrow("Missing TAKE/SKIP disposition");

      const twoChangedPaths = new Map([
        [
          "sandbox-preview-default",
          ["apps/server/src/kataSandbox/sandboxFeature.ts", "apps/server/src/serverSettings.ts"],
        ],
      ]);
      expect(() =>
        validateIntegrationRecord(
          record,
          refs,
          ["sandbox-preview-default"],
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
                  "apps/server/src/kataSandbox/sandboxFeature.ts",
                  "apps/server/src/serverSettings.ts",
                  "apps/server/src/server.ts",
                ],
              },
            ],
          },
          refs,
          ["sandbox-preview-default"],
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
