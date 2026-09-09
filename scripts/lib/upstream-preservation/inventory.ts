// @effect-diagnostics nodeBuiltinImport:off

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Schema from "effect/Schema";

import { PRESERVATION_CHECKS } from "./checks.ts";
import { matchesOwnerPath, parseNameStatusDiff, runGit } from "../upstream-preservation-refs.ts";
import {
  decodeOrThrow,
  sameStrings,
  sorted,
  validateConcreteText,
} from "../upstream-preservation-contract.ts";
import type { CommitSha } from "../upstream-preservation.ts";

export const INVENTORY_RELATIVE_PATH = "docs/upstream/retained-behavior.v1.json";

const InventoryEvidenceSchema = Schema.Struct({
  kind: Schema.Literals(["automated", "manual"]),
  profile: Schema.Literals(["portable", "live"]),
  verification: Schema.NonEmptyString,
});

const InventoryEntrySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  retainedOutcome: Schema.NonEmptyString,
  ownerPaths: Schema.Array(Schema.NonEmptyString),
  specRefs: Schema.Array(Schema.NonEmptyString),
  evidence: InventoryEvidenceSchema,
});

const InventorySchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  inventoryVersion: Schema.Literal("v1"),
  entries: Schema.Array(InventoryEntrySchema),
});

type InventoryFile = Schema.Schema.Type<typeof InventorySchema>;
export type InventoryEntry = InventoryFile["entries"][number];

const FORBIDDEN_INVENTORY_KEYS = new Set([
  "required",
  "mandatory",
  "command",
  "commands",
  "skip",
  "disabled",
  "allowMissing",
  "allow-missing",
  "enabled",
]);

const decodeInventory = Schema.decodeUnknownSync(InventorySchema);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertNoForbiddenInventoryKeys = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenInventoryKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_INVENTORY_KEYS.has(key)) {
      throw new Error(`Inventory field ${JSON.stringify(`${path}.${key}`)} is not allowed.`);
    }
    assertNoForbiddenInventoryKeys(child, `${path}.${key}`);
  }
};

export function validateInventory(
  value: unknown,
  repositoryRoot: string,
  inventorySourceRoot = repositoryRoot,
): InventoryFile {
  assertNoForbiddenInventoryKeys(value, "inventory");
  const inventory = decodeOrThrow(decodeInventory, value, "Retained behavior inventory");
  if (inventory.entries.length !== PRESERVATION_CHECKS.length) {
    throw new Error(
      `Inventory must contain exactly ${PRESERVATION_CHECKS.length} entries; found ${inventory.entries.length}.`,
    );
  }

  const seen = new Set<string>();
  for (const entry of inventory.entries) {
    if (seen.has(entry.id))
      throw new Error(`Inventory contains duplicate check id ${JSON.stringify(entry.id)}.`);
    seen.add(entry.id);
    const check = PRESERVATION_CHECKS.find((candidate) => candidate.id === entry.id);
    if (check === undefined)
      throw new Error(`Inventory contains unknown check id ${JSON.stringify(entry.id)}.`);
    if (entry.evidence.verification !== check.id) {
      throw new Error(
        `Inventory checker binding for ${entry.id} must be ${JSON.stringify(check.id)}.`,
      );
    }
    if (
      entry.evidence.kind !== check.evidenceKind ||
      entry.evidence.profile !== check.evidenceProfile
    ) {
      throw new Error(
        `Inventory evidence kind/profile for ${entry.id} does not match the code contract.`,
      );
    }
    if (!sameStrings(entry.ownerPaths, check.ownerPaths)) {
      throw new Error(`Inventory owner paths for ${entry.id} do not match the code contract.`);
    }
    if (!sameStrings(entry.specRefs, check.specRefs)) {
      throw new Error(`Inventory spec references for ${entry.id} do not match the code contract.`);
    }
    if (
      entry.ownerPaths.length === 0 ||
      entry.specRefs.length === 0 ||
      entry.retainedOutcome.trim() === ""
    ) {
      throw new Error(`Inventory entry ${entry.id} is missing required evidence fields.`);
    }
    validateConcreteText(entry.title, `Inventory title for ${entry.id}`);
    validateConcreteText(entry.retainedOutcome, `Inventory retained outcome for ${entry.id}`);
    for (const relativePath of entry.ownerPaths) {
      if (!NodeFS.existsSync(NodePath.resolve(repositoryRoot, relativePath))) {
        throw new Error(`Inventory owner path does not exist: ${relativePath}`);
      }
    }
    for (const relativePath of entry.specRefs) {
      if (
        !NodeFS.existsSync(NodePath.resolve(repositoryRoot, relativePath)) &&
        !NodeFS.existsSync(NodePath.resolve(inventorySourceRoot, relativePath))
      ) {
        throw new Error(`Inventory spec reference does not exist: ${relativePath}`);
      }
    }
  }
  for (const check of PRESERVATION_CHECKS) {
    if (!seen.has(check.id)) throw new Error(`Inventory is missing mandatory check ${check.id}.`);
  }
  return inventory;
}

const resolveExternalInventoryPath = (inventoryPath: string): string =>
  NodePath.isAbsolute(inventoryPath)
    ? inventoryPath
    : NodePath.resolve(process.cwd(), inventoryPath);

const inventorySourceRoot = (inventoryPath: string): string => {
  const suffix = `${NodePath.sep}${INVENTORY_RELATIVE_PATH.split("/").join(NodePath.sep)}`;
  return inventoryPath.endsWith(suffix)
    ? inventoryPath.slice(0, -suffix.length)
    : NodePath.dirname(inventoryPath);
};

export function loadInventory(
  repositoryRoot: string,
  externalInventoryPath?: string,
): InventoryFile {
  const inventoryPath =
    externalInventoryPath === undefined
      ? NodePath.resolve(repositoryRoot, INVENTORY_RELATIVE_PATH)
      : resolveExternalInventoryPath(externalInventoryPath);
  if (!NodeFS.existsSync(inventoryPath))
    throw new Error(`Missing retained behavior inventory: ${INVENTORY_RELATIVE_PATH}`);
  let raw: unknown;
  try {
    raw = JSON.parse(NodeFS.readFileSync(inventoryPath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read retained behavior inventory: ${message}`, { cause: error });
  }
  return validateInventory(raw, repositoryRoot, inventorySourceRoot(inventoryPath));
}

export interface ChangedRetainedOutcome {
  readonly id: string;
  readonly paths: ReadonlyArray<string>;
}

export function changedRetainedOutcomeDetails(
  repositoryRoot: string,
  base: CommitSha,
  candidate: CommitSha,
): ReadonlyArray<ChangedRetainedOutcome> {
  if (base === candidate) return [];
  const changedPaths = parseNameStatusDiff(
    runGit(repositoryRoot, [
      "diff",
      "--name-status",
      "--find-renames",
      "--find-copies",
      `${base}..${candidate}`,
    ]),
  );
  return PRESERVATION_CHECKS.flatMap((check) => {
    const paths = changedPaths
      .flatMap((changedPath) => [changedPath.oldPath, changedPath.newPath])
      .filter(
        (changedPath, index, allPaths) =>
          check.ownerPaths.some((ownerPath) => matchesOwnerPath(changedPath, ownerPath)) &&
          allPaths.indexOf(changedPath) === index,
      );
    return paths.length === 0 ? [] : [{ id: check.id, paths }];
  });
}

const inventoryEntryFingerprint = (entry: InventoryEntry): string =>
  JSON.stringify({
    id: entry.id,
    title: entry.title,
    retainedOutcome: entry.retainedOutcome,
    ownerPaths: entry.ownerPaths,
    specRefs: entry.specRefs,
    evidence: entry.evidence,
  });

export function changedInventoryOutcomeDetails(
  baseEntries: ReadonlyArray<InventoryEntry> | undefined,
  candidateEntries: ReadonlyArray<InventoryEntry> | undefined,
): ReadonlyArray<ChangedRetainedOutcome> {
  if (baseEntries === undefined || candidateEntries === undefined) return [];
  const baseById = new Map(baseEntries.map((entry) => [entry.id, entry] as const));
  const candidateById = new Map(candidateEntries.map((entry) => [entry.id, entry] as const));
  const ids = sorted([...new Set([...baseById.keys(), ...candidateById.keys()])]);
  return ids.flatMap((id) => {
    const baseEntry = baseById.get(id);
    const candidateEntry = candidateById.get(id);
    if (
      baseEntry !== undefined &&
      candidateEntry !== undefined &&
      inventoryEntryFingerprint(baseEntry) === inventoryEntryFingerprint(candidateEntry)
    ) {
      return [];
    }
    const paths = sorted([
      ...new Set([...(baseEntry?.ownerPaths ?? []), ...(candidateEntry?.ownerPaths ?? [])]),
    ]);
    return paths.length === 0 ? [] : [{ id, paths }];
  });
}

const readInventoryAtRef = (
  repositoryRoot: string,
  reference: CommitSha,
): InventoryFile | undefined => {
  const pathRef = `${reference}:${INVENTORY_RELATIVE_PATH}`;
  const probe = NodeChildProcess.spawnSync("git", ["cat-file", "-e", pathRef], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (probe.status !== 0) return undefined;
  const raw = JSON.parse(runGit(repositoryRoot, ["show", pathRef])) as unknown;
  return decodeOrThrow(decodeInventory, raw, `Retained behavior inventory at ${reference}`);
};

export const changedRetainedOutcomeDetailsWithInventory = (
  repositoryRoot: string,
  base: CommitSha,
  candidate: CommitSha,
): ReadonlyArray<ChangedRetainedOutcome> => {
  const fileChanges = changedRetainedOutcomeDetails(repositoryRoot, base, candidate);
  const inventoryChanges = changedInventoryOutcomeDetails(
    readInventoryAtRef(repositoryRoot, base)?.entries,
    readInventoryAtRef(repositoryRoot, candidate)?.entries,
  );
  const byId = new Map<string, ChangedRetainedOutcome>();
  for (const outcome of [...fileChanges, ...inventoryChanges]) {
    const previous = byId.get(outcome.id);
    byId.set(
      outcome.id,
      previous === undefined
        ? outcome
        : { id: outcome.id, paths: sorted([...new Set([...previous.paths, ...outcome.paths])]) },
    );
  }
  return PRESERVATION_CHECKS.flatMap((check) => {
    const outcome = byId.get(check.id);
    return outcome === undefined ? [] : [outcome];
  });
};

export function changedRetainedOutcomes(
  repositoryRoot: string,
  base: CommitSha,
  candidate: CommitSha,
): ReadonlyArray<string> {
  return changedRetainedOutcomeDetailsWithInventory(repositoryRoot, base, candidate).map(
    (outcome) => outcome.id,
  );
}
