// @effect-diagnostics nodeBuiltinImport:off

import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Schema from "effect/Schema";

import {
  decodeOrThrow,
  sameStrings,
  validateConcreteText,
  validateUtcTimestamp,
} from "./upstream-preservation-contract.ts";
import type { ResolvedRefs } from "./upstream-preservation.ts";

export const RESULT_ARTIFACT_VERSION = 1 as const;
export const EVIDENCE_BINDING_VERSION = 1 as const;

const EvidenceBindingSchema = Schema.Struct({
  schemaVersion: Schema.Literal(EVIDENCE_BINDING_VERSION),
  kind: Schema.Literals(["integration", "manual"]),
  candidate: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  upstream: Schema.NonEmptyString,
  upstreamBase: Schema.NonEmptyString,
  checkId: Schema.NonEmptyString,
  result: Schema.NonEmptyString,
  artifactPaths: Schema.Array(Schema.NonEmptyString),
  decision: Schema.optional(Schema.Literals(["TAKE", "SKIP"])),
  scopePaths: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  status: Schema.optional(Schema.Literal("PASS")),
  approvedBy: Schema.optional(Schema.NonEmptyString),
  approvedAt: Schema.optional(Schema.NonEmptyString),
  observer: Schema.optional(Schema.NonEmptyString),
  observedAt: Schema.optional(Schema.NonEmptyString),
});

const ResultArtifactSchema = Schema.Struct({
  schemaVersion: Schema.Literal(RESULT_ARTIFACT_VERSION),
  candidate: Schema.NonEmptyString,
  base: Schema.NonEmptyString,
  upstream: Schema.NonEmptyString,
  upstreamBase: Schema.NonEmptyString,
  checkId: Schema.NonEmptyString,
  result: Schema.NonEmptyString,
  producer: Schema.NonEmptyString,
  provenance: Schema.NonEmptyString,
  digest: Schema.NonEmptyString,
});

const decodeEvidenceBinding = Schema.decodeUnknownSync(EvidenceBindingSchema);
const decodeResultArtifact = Schema.decodeUnknownSync(ResultArtifactSchema);

type EvidenceBinding = Schema.Schema.Type<typeof EvidenceBindingSchema>;

export interface ResultArtifactPayload {
  readonly schemaVersion: typeof RESULT_ARTIFACT_VERSION;
  readonly candidate: string;
  readonly base: string;
  readonly upstream: string;
  readonly upstreamBase: string;
  readonly checkId: string;
  readonly result: string;
  readonly producer: string;
  readonly provenance: string;
}

export const calculateResultArtifactDigest = (artifact: ResultArtifactPayload): string =>
  NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: artifact.schemaVersion,
        candidate: artifact.candidate,
        base: artifact.base,
        upstream: artifact.upstream,
        upstreamBase: artifact.upstreamBase,
        checkId: artifact.checkId,
        result: artifact.result,
        producer: artifact.producer,
        provenance: artifact.provenance,
      }),
    )
    .digest("hex");

const parseExactRefs = (
  candidate: string,
  base: string,
  upstream: string,
  upstreamBase: string,
): ResolvedRefs => {
  const values = { candidate, base, upstream, upstreamBase };
  for (const [label, value] of Object.entries(values)) {
    if (!/^[0-9a-f]{40}$/.test(value)) {
      throw new Error(`Evidence ${label} ref must be a full lowercase commit SHA.`);
    }
  }
  return values as ResolvedRefs;
};

export const validateExactRefs = (
  label: string,
  value: { candidate: string; base: string; upstream: string; upstreamBase: string },
  refs: ResolvedRefs,
): void => {
  const provided = parseExactRefs(value.candidate, value.base, value.upstream, value.upstreamBase);
  if (
    provided.candidate !== refs.candidate ||
    provided.base !== refs.base ||
    provided.upstream !== refs.upstream ||
    provided.upstreamBase !== refs.upstreamBase
  ) {
    throw new Error(`${label} refs do not exactly match the resolved command refs.`);
  }
};

export function resolveEvidenceArtifact(repositoryRoot: string, artifactPath: string): string {
  const normalized = NodePath.posix.normalize(artifactPath);
  const segments = artifactPath.split("/");
  if (
    artifactPath.length === 0 ||
    artifactPath.startsWith("/") ||
    artifactPath.includes("\\") ||
    normalized !== artifactPath ||
    segments.some((segment) => segment === ".." || segment === ".") ||
    /example/i.test(artifactPath) ||
    /(?:<|>|placeholder|todo|\.\.\.)/i.test(artifactPath)
  ) {
    throw new Error(
      `Evidence artifact path must be a concrete repository-relative file: ${artifactPath}`,
    );
  }
  const root = NodePath.resolve(repositoryRoot);
  const resolved = NodePath.resolve(root, artifactPath);
  const relative = NodePath.relative(root, resolved);
  if (relative.startsWith("..") || NodePath.isAbsolute(relative)) {
    throw new Error(`Evidence artifact path escapes the repository: ${artifactPath}`);
  }
  if (!NodeFS.statSync(resolved, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Evidence artifact does not exist as a file: ${artifactPath}`);
  }
  const realRoot = NodeFS.realpathSync(root);
  const realResolved = NodeFS.realpathSync(resolved);
  const realRelative = NodePath.relative(realRoot, realResolved);
  if (realRelative.startsWith("..") || NodePath.isAbsolute(realRelative)) {
    throw new Error(`Evidence artifact escapes the repository: ${artifactPath}`);
  }
  return resolved;
}

const readJsonFile = (path: string, label: string): unknown => {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${label}: ${message}`, { cause: error });
  }
};

const validateResultArtifact = (
  repositoryRoot: string,
  artifactPath: string,
  bindingPath: string,
  expected: { readonly refs: ResolvedRefs; readonly checkId: string; readonly result: string },
): void => {
  const resolved = resolveEvidenceArtifact(repositoryRoot, artifactPath);
  if (NodeFS.realpathSync(resolved) === NodeFS.realpathSync(bindingPath)) {
    throw new Error(`Evidence binding for ${expected.checkId} cannot reference itself.`);
  }
  const artifact = decodeOrThrow(
    decodeResultArtifact,
    readJsonFile(resolved, "evidence result artifact"),
    "Evidence result artifact",
  );
  validateExactRefs("Evidence result artifact", artifact, expected.refs);
  if (artifact.checkId !== expected.checkId) {
    throw new Error(`Evidence result artifact checkId does not match ${expected.checkId}.`);
  }
  if (artifact.result !== expected.result) {
    throw new Error(`Evidence result artifact result does not match ${expected.checkId}.`);
  }
  validateConcreteText(artifact.result, `Evidence result artifact result for ${expected.checkId}`);
  validateConcreteText(
    artifact.producer,
    `Evidence result artifact producer for ${expected.checkId}`,
  );
  validateConcreteText(
    artifact.provenance,
    `Evidence result artifact provenance for ${expected.checkId}`,
  );
  if (!/^[0-9a-f]{64}$/.test(artifact.digest)) {
    throw new Error(`Evidence result artifact digest for ${expected.checkId} is invalid.`);
  }
  const expectedDigest = calculateResultArtifactDigest({
    schemaVersion: artifact.schemaVersion,
    candidate: artifact.candidate,
    base: artifact.base,
    upstream: artifact.upstream,
    upstreamBase: artifact.upstreamBase,
    checkId: artifact.checkId,
    result: artifact.result,
    producer: artifact.producer,
    provenance: artifact.provenance,
  });
  if (artifact.digest !== expectedDigest) {
    throw new Error(`Evidence result artifact digest does not match ${expected.checkId}.`);
  }
};

export type EvidenceBindingExpectation =
  | {
      readonly kind: "integration";
      readonly refs: ResolvedRefs;
      readonly checkId: string;
      readonly decision: "TAKE" | "SKIP";
      readonly scopePaths: ReadonlyArray<string>;
      readonly approvedBy: string;
      readonly approvedAt: string;
    }
  | {
      readonly kind: "manual";
      readonly refs: ResolvedRefs;
      readonly checkId: string;
      readonly status: "PASS";
      readonly observer: string;
      readonly observedAt: string;
    };

export function validateEvidenceBinding(
  repositoryRoot: string,
  bindingPath: string,
  expected: EvidenceBindingExpectation,
): void {
  const bindingResolved = resolveEvidenceArtifact(repositoryRoot, bindingPath);
  const binding = decodeOrThrow(
    decodeEvidenceBinding,
    readJsonFile(bindingResolved, "evidence binding"),
    "Evidence binding",
  ) as EvidenceBinding;
  validateExactRefs("Evidence binding", binding, expected.refs);
  if (binding.kind !== expected.kind) {
    throw new Error(
      `Evidence binding kind for ${expected.checkId} must be ${JSON.stringify(expected.kind)}.`,
    );
  }
  if (binding.checkId !== expected.checkId) {
    throw new Error(`Evidence binding checkId does not match ${expected.checkId}.`);
  }
  validateConcreteText(binding.result, `Evidence binding result for ${expected.checkId}`);
  if (binding.result.trim() === "") {
    throw new Error(`Evidence binding result for ${expected.checkId} must be non-empty.`);
  }
  if (binding.artifactPaths.length === 0) {
    throw new Error(`Evidence binding for ${expected.checkId} must list an underlying artifact.`);
  }
  const resolvedUnderlying = binding.artifactPaths.map((artifactPath) => {
    validateResultArtifact(repositoryRoot, artifactPath, bindingResolved, {
      refs: expected.refs,
      checkId: expected.checkId,
      result: binding.result,
    });
    return resolveEvidenceArtifact(repositoryRoot, artifactPath);
  });
  if (new Set(resolvedUnderlying).size !== resolvedUnderlying.length) {
    throw new Error(`Evidence binding for ${expected.checkId} contains duplicate artifacts.`);
  }

  if (expected.kind === "integration") {
    if (binding.decision !== expected.decision) {
      throw new Error(`Evidence binding decision does not match ${expected.checkId}.`);
    }
    if (binding.scopePaths === undefined || !sameStrings(binding.scopePaths, expected.scopePaths)) {
      throw new Error(`Evidence binding scopePaths does not match ${expected.checkId}.`);
    }
    if (binding.approvedBy !== expected.approvedBy) {
      throw new Error(`Evidence binding approvedBy does not match ${expected.checkId}.`);
    }
    if (binding.approvedAt !== expected.approvedAt) {
      throw new Error(`Evidence binding approvedAt does not match ${expected.checkId}.`);
    }
    validateUtcTimestamp(binding.approvedAt, `Evidence binding approvedAt for ${expected.checkId}`);
    if (
      binding.status !== undefined ||
      binding.observer !== undefined ||
      binding.observedAt !== undefined
    ) {
      throw new Error("Integration evidence binding contains manual-only fields.");
    }
    return;
  }

  if (binding.status !== expected.status) {
    throw new Error(`Evidence binding status does not match ${expected.checkId}.`);
  }
  if (binding.observer !== expected.observer) {
    throw new Error(`Evidence binding observer does not match ${expected.checkId}.`);
  }
  if (binding.observedAt !== expected.observedAt) {
    throw new Error(`Evidence binding observedAt does not match ${expected.checkId}.`);
  }
  validateUtcTimestamp(binding.observedAt, `Evidence binding observedAt for ${expected.checkId}`);
  if (
    binding.decision !== undefined ||
    binding.scopePaths !== undefined ||
    binding.approvedBy !== undefined ||
    binding.approvedAt !== undefined
  ) {
    throw new Error("Manual evidence binding contains integration-only fields.");
  }
}
