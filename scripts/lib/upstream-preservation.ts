// @effect-diagnostics nodeBuiltinImport:off

import * as NodePath from "node:path";

import {
  PRESERVATION_CHECKS,
  type CommandPlan,
  type PreservationCheck,
} from "./upstream-preservation/checks.ts";
import {
  changedRetainedOutcomeDetailsWithInventory,
  loadInventory,
} from "./upstream-preservation/inventory.ts";
import { statusForIntegration, statusForManualEvidence } from "./upstream-preservation/records.ts";
import { resolveRefs, validateFrozenUpstreamRefs } from "./upstream-preservation-refs.ts";
import {
  missingRequiredPaths,
  runCommandPlan,
  validateTrustedAssertions,
  validateExecutionTree,
} from "./upstream-preservation-runner.ts";

export {
  PRESERVATION_CHECKS,
  type CommandPlan,
  type EvidenceKind,
  type EvidenceProfile,
  type PreservationCheck,
} from "./upstream-preservation/checks.ts";
export {
  INVENTORY_RELATIVE_PATH,
  changedInventoryOutcomeDetails,
  changedRetainedOutcomeDetails,
  changedRetainedOutcomes,
  loadInventory,
  validateInventory,
  type ChangedRetainedOutcome,
  type InventoryEntry,
} from "./upstream-preservation/inventory.ts";
export {
  INTEGRATION_RECORD_VERSION,
  MANUAL_EVIDENCE_VERSION,
  validateIntegrationRecord,
  validateManualEvidence,
} from "./upstream-preservation/records.ts";

export {
  calculateResultArtifactDigest,
  EVIDENCE_BINDING_VERSION,
  RESULT_ARTIFACT_VERSION,
  validateExactRefs,
  validateEvidenceBinding,
  resolveEvidenceArtifact,
  type EvidenceBindingExpectation,
} from "./upstream-preservation-evidence.ts";
export {
  makeCommitSha,
  matchesOwnerPath,
  parseNameStatusDiff,
  resolveCommitRef,
  resolveRefs,
  validateFrozenUpstreamRefs,
  type ChangedPath,
} from "./upstream-preservation-refs.ts";
export {
  missingRequiredPaths,
  runCommandPlan,
  validateTrustedAssertions,
  validateExecutionTree,
} from "./upstream-preservation-runner.ts";

export type PreservationMode = "ci" | "baseline" | "human-review";
export type CheckStatus = "PASS" | "FAIL" | "NOT RUN";
export type CommitSha = string & { readonly __brand: "CommitSha" };

export interface ResolvedRefs {
  readonly candidate: CommitSha;
  readonly base: CommitSha;
  readonly upstream: CommitSha;
  readonly upstreamBase: CommitSha;
}

export interface CheckResult {
  readonly id: string;
  readonly status: CheckStatus;
  readonly reason?: string;
}

export type PreservationCommandExecutor = (
  repositoryRoot: string,
  command: CommandPlan,
) => CheckStatus;

export interface PreservationReport {
  readonly mode: PreservationMode;
  readonly refs: ResolvedRefs;
  readonly results: ReadonlyArray<CheckResult>;
  readonly inventoryStatus: CheckStatus;
  readonly integrationStatus: CheckStatus;
  readonly humanReviewStatus: CheckStatus;
  readonly lines: ReadonlyArray<string>;
  readonly exitCode: number;
}

export const CANONICAL_CHECK_IDS = PRESERVATION_CHECKS.map((check) => check.id);

const runCheck = (
  repositoryRoot: string,
  check: PreservationCheck,
  commandExecutor: PreservationCommandExecutor,
  base: CommitSha,
): CheckResult => {
  if (check.evidenceKind === "manual") {
    const reason =
      check.id === "icon-composer-live-evidence"
        ? "requires macOS Icon Composer evidence"
        : check.id === "mobile-android-asset-live-evidence"
          ? "requires Android asset/device evidence; KAT-3301 remains open"
          : "requires device/provider evidence";
    return { id: check.id, status: "NOT RUN", reason };
  }
  for (const command of check.commands) {
    const missingPaths = missingRequiredPaths(repositoryRoot, command);
    if (missingPaths.length > 0) {
      return {
        id: check.id,
        status: "FAIL",
        reason: `missing required path ${missingPaths.join(",")}`,
      };
    }
    const trustedAssertionError = validateTrustedAssertions(repositoryRoot, base, command);
    if (trustedAssertionError !== undefined) {
      return { id: check.id, status: "FAIL", reason: trustedAssertionError };
    }
    const status = commandExecutor(repositoryRoot, command);
    if (status !== "PASS") return { id: check.id, status, reason: `command ${command.display}` };
  }
  return { id: check.id, status: "PASS" };
};

export interface RunPreservationOptions {
  readonly mode: PreservationMode;
  readonly repositoryRoot: string;
  readonly candidate: string;
  readonly base: string;
  readonly upstream: string;
  readonly upstreamBase: string;
  readonly inventoryPath?: string;
  readonly integrationRecordPath?: string;
  readonly manualEvidencePath?: string;
  readonly commandExecutor?: PreservationCommandExecutor;
  readonly executionTreeCheck?: (repositoryRoot: string, refs: ResolvedRefs) => void;
}

export function runPreservation(options: RunPreservationOptions): PreservationReport {
  if (options.inventoryPath !== undefined && options.mode !== "baseline") {
    throw new Error(`--inventory is only supported in baseline mode.`);
  }
  const refs = resolveRefs(options.repositoryRoot, options);
  validateFrozenUpstreamRefs(options.repositoryRoot, refs);
  (options.executionTreeCheck ?? validateExecutionTree)(options.repositoryRoot, refs);
  let inventoryStatus: CheckStatus = "PASS";
  try {
    loadInventory(options.repositoryRoot, options.inventoryPath);
  } catch (error) {
    inventoryStatus = "FAIL";
    const message = error instanceof Error ? error.message : String(error);
    const lines = [
      `UPSTREAM_PRESERVATION mode=${options.mode} candidate=${refs.candidate} base=${refs.base} upstream=${refs.upstream} upstream-base=${refs.upstreamBase}`,
      `INVENTORY status=FAIL detail=${message}`,
      "HUMAN_REVIEW_ACCEPTANCE status=NOT RUN",
    ];
    return {
      mode: options.mode,
      refs,
      results: [],
      inventoryStatus,
      integrationStatus: "NOT RUN",
      humanReviewStatus: "NOT RUN",
      lines,
      exitCode: 1,
    };
  }

  const commandExecutor = options.commandExecutor ?? runCommandPlan;
  const results = PRESERVATION_CHECKS.map((check) =>
    runCheck(options.repositoryRoot, check, commandExecutor, refs.base),
  );
  const changedDetails = changedRetainedOutcomeDetailsWithInventory(
    options.repositoryRoot,
    refs.base,
    refs.candidate,
  );
  const changedIds = changedDetails.map((outcome) => outcome.id);
  const changedScopes = new Map(
    changedDetails.map((outcome) => [outcome.id, outcome.paths] as const),
  );
  let integrationStatus: CheckStatus = "NOT RUN";
  let integrationError: string | undefined;
  try {
    integrationStatus = statusForIntegration(
      options.mode,
      changedIds,
      changedScopes,
      options.integrationRecordPath,
      options.repositoryRoot,
      refs,
    );
  } catch (error) {
    integrationStatus = "FAIL";
    integrationError = error instanceof Error ? error.message : String(error);
  }
  const manualIds = PRESERVATION_CHECKS.filter((check) => check.evidenceKind === "manual").map(
    (check) => check.id,
  );
  let humanReviewStatus: CheckStatus = "NOT RUN";
  let manualEvidenceError: string | undefined;
  try {
    humanReviewStatus = statusForManualEvidence(
      options.mode,
      options.manualEvidencePath,
      options.repositoryRoot,
      refs,
      manualIds,
    );
  } catch (error) {
    humanReviewStatus = "FAIL";
    manualEvidenceError = error instanceof Error ? error.message : String(error);
  }

  const automatedFailed = results.some((result) => {
    const check = PRESERVATION_CHECKS.find((candidate) => candidate.id === result.id);
    if (check?.evidenceKind === "manual") return false;
    return result.status === "FAIL" || result.status === "NOT RUN";
  });
  const mandatoryManualMissing = options.mode === "human-review" && humanReviewStatus !== "PASS";
  const mandatoryIntegrationMissing =
    options.mode === "human-review" && changedIds.length > 0 && integrationStatus !== "PASS";
  const humanAcceptanceStatus: CheckStatus =
    options.mode !== "human-review"
      ? "NOT RUN"
      : automatedFailed || integrationStatus === "FAIL"
        ? "FAIL"
        : mandatoryManualMissing || mandatoryIntegrationMissing
          ? "NOT RUN"
          : "PASS";

  const reportedResults = results.map((result) => {
    const check = PRESERVATION_CHECKS.find((candidate) => candidate.id === result.id);
    return humanReviewStatus === "PASS" && check?.evidenceKind === "manual"
      ? { id: result.id, status: "PASS" as const }
      : result;
  });
  const changedOutcomeStatus: CheckStatus =
    changedIds.length === 0
      ? "PASS"
      : integrationStatus === "PASS"
        ? "PASS"
        : integrationStatus === "FAIL"
          ? "FAIL"
          : "NOT RUN";

  const lines = [
    `UPSTREAM_PRESERVATION mode=${options.mode} candidate=${refs.candidate} base=${refs.base} upstream=${refs.upstream} upstream-base=${refs.upstreamBase}`,
    `INVENTORY status=${inventoryStatus}`,
    ...reportedResults.map((result) =>
      result.reason === undefined
        ? `CHECK id=${result.id} status=${result.status}`
        : `CHECK id=${result.id} status=${result.status} detail=${result.reason}`,
    ),
    `CHANGED_RETAINED_OUTCOMES status=${changedOutcomeStatus} ids=${changedIds.join(",") || "none"}`,
    integrationError === undefined
      ? `INTEGRATION_RECORD status=${integrationStatus}`
      : `INTEGRATION_RECORD status=FAIL detail=${integrationError}`,
    manualEvidenceError === undefined
      ? `HUMAN_REVIEW_ACCEPTANCE status=${humanAcceptanceStatus}`
      : `HUMAN_REVIEW_ACCEPTANCE status=FAIL detail=${manualEvidenceError}`,
  ];

  const exitCode = automatedFailed || mandatoryManualMissing || mandatoryIntegrationMissing ? 1 : 0;
  return {
    mode: options.mode,
    refs,
    results: reportedResults,
    inventoryStatus,
    integrationStatus,
    humanReviewStatus,
    lines,
    exitCode,
  };
}

export interface ParsedCliOptions extends Omit<RunPreservationOptions, "repositoryRoot"> {
  readonly repositoryRoot: string;
}

const requireValue = (args: ReadonlyArray<string>, index: number, name: string): string => {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${name}.`);
  return value;
};

export function parseCliArgs(
  args: ReadonlyArray<string>,
  repositoryRoot = process.cwd(),
): ParsedCliOptions {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  let mode: PreservationMode | undefined;
  let candidate: string | undefined;
  let base: string | undefined;
  let upstream: string | undefined;
  let upstreamBase: string | undefined;
  let repositoryRootOverride: string | undefined;
  let inventoryPath: string | undefined;
  let integrationRecordPath: string | undefined;
  let manualEvidencePath: string | undefined;
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const arg = normalizedArgs[index];
    if (arg === undefined) throw new Error("Argument parsing reached an invalid position.");
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument ${JSON.stringify(arg)}.`);
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const value = equals === -1 ? requireValue(normalizedArgs, index, name) : arg.slice(equals + 1);
    if (equals === -1) index += 1;
    if (seen.has(name)) throw new Error(`Argument ${name} was provided more than once.`);
    seen.add(name);
    if (
      name === "--skip" ||
      name === "--allow-missing" ||
      name === "--commands" ||
      name === "--disabled"
    ) {
      throw new Error(
        `${name} is not supported; mandatory preservation evidence cannot be skipped.`,
      );
    }
    if (name === "--repository-root" || name === "--inventory") {
      values.set(name, value);
      continue;
    }
    if (
      ![
        "--mode",
        "--candidate",
        "--base",
        "--upstream",
        "--upstream-base",
        "--repository-root",
        "--inventory",
        "--integration-record",
        "--manual-evidence",
      ].includes(name)
    ) {
      throw new Error(`Unknown argument ${name}.`);
    }
    values.set(name, value);
  }
  const modeValue = values.get("--mode");
  if (modeValue !== "ci" && modeValue !== "baseline" && modeValue !== "human-review") {
    throw new Error("--mode must be ci, baseline, or human-review.");
  }
  mode = modeValue;
  repositoryRootOverride = values.get("--repository-root");
  inventoryPath = values.get("--inventory");
  if (mode !== "baseline" && repositoryRootOverride !== undefined) {
    throw new Error("--repository-root is only supported in baseline mode.");
  }
  if (mode !== "baseline" && inventoryPath !== undefined) {
    throw new Error("--inventory is only supported in baseline mode.");
  }
  candidate = values.get("--candidate");
  base = values.get("--base");
  upstream = values.get("--upstream");
  upstreamBase = values.get("--upstream-base");
  if (
    candidate === undefined ||
    base === undefined ||
    upstream === undefined ||
    upstreamBase === undefined
  ) {
    throw new Error("--candidate, --base, --upstream, and --upstream-base are required.");
  }
  integrationRecordPath = values.get("--integration-record");
  manualEvidencePath = values.get("--manual-evidence");
  return {
    mode,
    repositoryRoot:
      repositoryRootOverride === undefined
        ? repositoryRoot
        : NodePath.resolve(repositoryRoot, repositoryRootOverride),
    candidate,
    base,
    upstream,
    upstreamBase,
    ...(inventoryPath === undefined ? {} : { inventoryPath }),
    ...(integrationRecordPath === undefined ? {} : { integrationRecordPath }),
    ...(manualEvidencePath === undefined ? {} : { manualEvidencePath }),
  };
}

export function formatCliError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `UPSTREAM_PRESERVATION status=FAIL detail=${message}`;
}
