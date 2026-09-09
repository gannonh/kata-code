// @effect-diagnostics nodeBuiltinImport:off

import * as NodePath from "node:path";

import * as Schema from "effect/Schema";

import {
  validateExactRefs,
  validateEvidenceBinding,
  resolveEvidenceArtifact,
} from "../upstream-preservation-evidence.ts";
import {
  decodeOrThrow,
  readJsonFile,
  sameStrings,
  validateConcreteText,
  validateUtcTimestamp,
} from "../upstream-preservation-contract.ts";
import { PRESERVATION_CHECKS } from "./checks.ts";
import type { CheckStatus, PreservationMode, ResolvedRefs } from "../upstream-preservation.ts";

export const INTEGRATION_RECORD_VERSION = 1 as const;
export const MANUAL_EVIDENCE_VERSION = 1 as const;

const WILDCARD_PATTERN = /[*?]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const EvidenceArtifactSchema = Schema.Struct({
  path: Schema.NonEmptyString,
});

const IntegrationDispositionSchema = Schema.Struct({
  checkId: Schema.NonEmptyString,
  decision: Schema.Literals(["TAKE", "SKIP"]),
  scopePaths: Schema.Array(Schema.NonEmptyString),
  rationale: Schema.NonEmptyString,
  approvedBy: Schema.NonEmptyString,
  approvedAt: Schema.NonEmptyString,
  evidence: EvidenceArtifactSchema,
});

const IntegrationRecordSchema = Schema.Struct({
  schemaVersion: Schema.Literal(INTEGRATION_RECORD_VERSION),
  candidate: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  upstream: Schema.NonEmptyString,
  upstreamBase: Schema.NonEmptyString,
  dispositions: Schema.Array(IntegrationDispositionSchema),
});

type IntegrationRecord = Schema.Schema.Type<typeof IntegrationRecordSchema>;

const ManualEvidenceItemSchema = Schema.Struct({
  checkId: Schema.NonEmptyString,
  status: Schema.Literal("PASS"),
  evidence: EvidenceArtifactSchema,
  observer: Schema.NonEmptyString,
  observedAt: Schema.NonEmptyString,
});

const ManualEvidenceSchema = Schema.Struct({
  schemaVersion: Schema.Literal(MANUAL_EVIDENCE_VERSION),
  candidate: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  upstream: Schema.NonEmptyString,
  upstreamBase: Schema.NonEmptyString,
  checks: Schema.Array(ManualEvidenceItemSchema),
});

const decodeIntegrationRecord = Schema.decodeUnknownSync(IntegrationRecordSchema);
const decodeManualEvidence = Schema.decodeUnknownSync(ManualEvidenceSchema);

const validateApprovedAt = (value: string): void => {
  validateUtcTimestamp(value, "Integration disposition approvedAt");
};

export function validateIntegrationRecord(
  value: unknown,
  refs: ResolvedRefs,
  changedIds: ReadonlyArray<string>,
  changedScopes: ReadonlyMap<string, ReadonlyArray<string>>,
  repositoryRoot: string,
): void {
  if (isRecord(value) && Array.isArray(value.dispositions)) {
    value.dispositions.forEach((disposition, index) => {
      if (isRecord(disposition) && "scope" in disposition) {
        throw new Error(
          `Integration disposition dispositions[${index}].scope is not supported; use scopePaths.`,
        );
      }
    });
  }
  const record = decodeOrThrow(decodeIntegrationRecord, value, "Integration record");
  validateExactRefs("Integration record", record, refs);
  const byCheckId = new Map<string, IntegrationRecord["dispositions"][number]>();
  for (const disposition of record.dispositions) {
    if (!PRESERVATION_CHECKS.some((check) => check.id === disposition.checkId)) {
      throw new Error(`Integration record contains unknown check id ${disposition.checkId}.`);
    }
    if (byCheckId.has(disposition.checkId)) {
      throw new Error(
        `Integration record contains more than one disposition for ${disposition.checkId}.`,
      );
    }
    if (disposition.scopePaths.length === 0) {
      throw new Error(
        `Integration disposition scopePaths for ${disposition.checkId} must be non-empty.`,
      );
    }
    if (new Set(disposition.scopePaths).size !== disposition.scopePaths.length) {
      throw new Error(
        `Integration disposition scopePaths for ${disposition.checkId} must not contain duplicates.`,
      );
    }
    for (const scopePath of disposition.scopePaths) {
      if (WILDCARD_PATTERN.test(scopePath) || /\b(?:all|everything)\b/i.test(scopePath)) {
        throw new Error(
          `Integration disposition scopePaths for ${disposition.checkId} must be concrete.`,
        );
      }
      validateConcreteText(
        scopePath,
        `Integration disposition scopePath for ${disposition.checkId}`,
      );
    }
    validateConcreteText(
      disposition.rationale,
      `Integration disposition rationale for ${disposition.checkId}`,
    );
    validateConcreteText(
      disposition.approvedBy,
      `Integration disposition approvedBy for ${disposition.checkId}`,
    );
    validateApprovedAt(disposition.approvedAt);
    const changedPaths = changedScopes.get(disposition.checkId) ?? [];
    if (!sameStrings(disposition.scopePaths, changedPaths)) {
      throw new Error(
        `Integration disposition scopePaths for ${disposition.checkId} must exactly cover every changed owner path.`,
      );
    }
    validateEvidenceBinding(repositoryRoot, disposition.evidence.path, {
      kind: "integration",
      refs,
      checkId: disposition.checkId,
      decision: disposition.decision,
      scopePaths: disposition.scopePaths,
      approvedBy: disposition.approvedBy,
      approvedAt: disposition.approvedAt,
    });
    byCheckId.set(disposition.checkId, disposition);
  }
  for (const checkId of changedIds) {
    if (!byCheckId.has(checkId)) {
      throw new Error(`Missing TAKE/SKIP disposition for changed retained outcome ${checkId}.`);
    }
  }
  for (const checkId of byCheckId.keys()) {
    if (!changedIds.includes(checkId)) {
      throw new Error(`Integration disposition ${checkId} has no changed retained outcome.`);
    }
  }
}

export function validateManualEvidence(
  value: unknown,
  refs: ResolvedRefs,
  requiredIds: ReadonlyArray<string>,
  repositoryRoot: string,
): void {
  const evidence = decodeOrThrow(decodeManualEvidence, value, "Manual evidence");
  validateExactRefs("Manual evidence", evidence, refs);
  const ids = new Set<string>();
  for (const item of evidence.checks) {
    if (ids.has(item.checkId))
      throw new Error(`Manual evidence contains duplicate check id ${item.checkId}.`);
    ids.add(item.checkId);
    const check = PRESERVATION_CHECKS.find((candidate) => candidate.id === item.checkId);
    if (check === undefined || check.evidenceKind !== "manual") {
      throw new Error(`Manual evidence contains non-manual check id ${item.checkId}.`);
    }
    validateConcreteText(item.observer, `Manual evidence observer for ${item.checkId}`);
    validateUtcTimestamp(item.observedAt, `Manual evidence observedAt for ${item.checkId}`);
    validateEvidenceBinding(repositoryRoot, item.evidence.path, {
      kind: "manual",
      refs,
      checkId: item.checkId,
      status: item.status,
      observer: item.observer,
      observedAt: item.observedAt,
    });
  }
  for (const id of requiredIds) {
    if (!ids.has(id)) throw new Error(`Missing mandatory manual evidence for ${id}.`);
  }
  if (ids.size !== requiredIds.length)
    throw new Error("Manual evidence contains an unexpected check.");
}

export const statusForIntegration = (
  mode: PreservationMode,
  changedIds: ReadonlyArray<string>,
  changedScopes: ReadonlyMap<string, ReadonlyArray<string>>,
  integrationRecordPath: string | undefined,
  repositoryRoot: string,
  refs: ResolvedRefs,
): CheckStatus => {
  if (mode !== "human-review" || changedIds.length === 0) return "NOT RUN";
  if (integrationRecordPath === undefined) return "NOT RUN";
  resolveEvidenceArtifact(repositoryRoot, integrationRecordPath);
  const raw = readJsonFile(
    NodePath.resolve(repositoryRoot, integrationRecordPath),
    "integration record",
  );
  validateIntegrationRecord(raw, refs, changedIds, changedScopes, repositoryRoot);
  return "PASS";
};

export const statusForManualEvidence = (
  mode: PreservationMode,
  manualEvidencePath: string | undefined,
  repositoryRoot: string,
  refs: ResolvedRefs,
  manualIds: ReadonlyArray<string>,
): CheckStatus => {
  if (mode !== "human-review") return "NOT RUN";
  if (manualEvidencePath === undefined) return "NOT RUN";
  resolveEvidenceArtifact(repositoryRoot, manualEvidencePath);
  const raw = readJsonFile(NodePath.resolve(repositoryRoot, manualEvidencePath), "manual evidence");
  validateManualEvidence(raw, refs, manualIds, repositoryRoot);
  return "PASS";
};
