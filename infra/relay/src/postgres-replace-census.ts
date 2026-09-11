export type PostgresReplaceActor = "region" | "replicas" | "arch" | "status" | "providerMode";

export interface PostgresIdentity {
  readonly name?: unknown;
  readonly region?: unknown;
  readonly replicas?: unknown;
  readonly arch?: unknown;
  readonly clusterSize?: unknown;
  readonly defaultBranch?: unknown;
  readonly state?: unknown;
  readonly id?: unknown;
}

export interface PostgresReplaceCensus {
  readonly actors: readonly PostgresReplaceActor[];
  readonly status?: string | undefined;
  readonly providerMode?: string | undefined;
  readonly planMode?: string | undefined;
  readonly news: PostgresIdentity;
  readonly olds: PostgresIdentity;
  readonly output: PostgresIdentity;
}

const identityKeys = [
  "name",
  "region",
  "replicas",
  "arch",
  "clusterSize",
  "defaultBranch",
  "state",
  "id",
] as const;

export function pickPostgresIdentity(value: unknown): PostgresIdentity {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of identityKeys) {
    if (key in record) {
      picked[key] = record[key];
    }
  }
  return picked;
}

function regionSlug(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const slug = (value as { slug?: unknown }).slug;
  return typeof slug === "string" && slug.length > 0 ? slug : undefined;
}

function archOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Mirrors alchemy/Planetscale PostgresDatabase.diff replace guards plus
 * Plan mode-switch and in-flight status recovery.
 */
export function alchemyPostgresReplaceActors(input: {
  readonly news: unknown;
  readonly olds: unknown;
  readonly output: unknown;
  readonly status?: string | undefined;
  readonly providerMode?: string | undefined;
  readonly planMode?: string | undefined;
}): PostgresReplaceActor[] {
  const news =
    typeof input.news === "object" && input.news !== null
      ? (input.news as Record<string, unknown>)
      : {};
  const olds =
    typeof input.olds === "object" && input.olds !== null
      ? (input.olds as Record<string, unknown>)
      : {};
  const output =
    typeof input.output === "object" && input.output !== null
      ? (input.output as Record<string, unknown>)
      : {};

  const actors: PostgresReplaceActor[] = [];
  const newsRegion = regionSlug(news.region);
  const outputRegion = regionSlug(output.region);
  if (newsRegion && outputRegion && newsRegion !== outputRegion) {
    actors.push("region");
  }
  if (news.replicas !== olds.replicas) {
    actors.push("replicas");
  }
  const newsArch = archOf(news.arch);
  const oldArch = archOf(output.arch) ?? archOf(olds.arch) ?? "x86";
  if (newsArch && newsArch !== oldArch) {
    actors.push("arch");
  }
  if (input.status === "creating" || input.status === "replacing" || input.status === "replaced") {
    actors.push("status");
  }
  if (
    input.planMode !== undefined &&
    input.providerMode !== undefined &&
    input.planMode !== input.providerMode
  ) {
    actors.push("providerMode");
  }
  return actors;
}

export function postgresStateIdentity(row: unknown): {
  readonly fqn?: unknown;
  readonly logicalId?: unknown;
  readonly resourceType?: unknown;
  readonly status?: unknown;
  readonly providerMode?: unknown;
  readonly props: PostgresIdentity;
  readonly attr: PostgresIdentity;
  readonly oldStatus?: unknown;
  readonly oldProps?: PostgresIdentity | undefined;
  readonly oldAttr?: PostgresIdentity | undefined;
} | null {
  if (typeof row !== "object" || row === null) {
    return null;
  }
  const record = row as Record<string, unknown>;
  const old =
    typeof record.old === "object" && record.old !== null
      ? (record.old as Record<string, unknown>)
      : undefined;
  return {
    fqn: record.fqn,
    logicalId: record.logicalId,
    resourceType: record.resourceType,
    status: record.status,
    providerMode: record.providerMode,
    props: pickPostgresIdentity(record.props),
    attr: pickPostgresIdentity(record.attr),
    oldStatus: old?.status,
    oldProps: old ? pickPostgresIdentity(old.props) : undefined,
    oldAttr: old ? pickPostgresIdentity(old.attr) : undefined,
  };
}

export const productionRelayDatabaseId = "s5mpblbu2m4s";
export const productionRelayDatabaseName = "katacoderelay";

export type AbortPostgresReplaceResult =
  | { readonly kind: "noop"; readonly reason: string }
  | { readonly kind: "refuse"; readonly reason: string }
  | {
      readonly kind: "restored";
      readonly row: Record<string, unknown>;
      readonly restoredId: string;
      readonly restoredName: string;
    };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Restore the live generation when Alchemy is stuck mid-replace.
 * Plan keeps emitting replace while status is replacing, even if desired
 * props match the live database.
 */
export function abortInFlightPostgresReplace(
  row: unknown,
  expected: { readonly id: string; readonly name: string } = {
    id: productionRelayDatabaseId,
    name: productionRelayDatabaseName,
  },
): AbortPostgresReplaceResult {
  const current = asRecord(row);
  if (current === undefined) {
    return { kind: "refuse", reason: "Alchemy row is missing" };
  }
  if (current.status !== "replacing") {
    return { kind: "noop", reason: `status is ${String(current.status)}` };
  }
  const old = asRecord(current.old);
  if (old === undefined || (old.status !== "updated" && old.status !== "created")) {
    return { kind: "refuse", reason: "old generation is not a completed database row" };
  }
  const attr = asRecord(old.attr);
  if (attr === undefined) {
    return { kind: "refuse", reason: "old generation has no database identity" };
  }
  const id = typeof attr.id === "string" ? attr.id : undefined;
  const name = typeof attr.name === "string" ? attr.name : undefined;
  if (id === undefined || name === undefined) {
    return { kind: "refuse", reason: "old generation has no database identity" };
  }
  if (name !== expected.name || id !== expected.id) {
    return {
      kind: "refuse",
      reason: `old generation identity ${name}/${id} is not ${expected.name}/${expected.id}`,
    };
  }
  if (attr.state !== "ready") {
    return { kind: "refuse", reason: `old generation state is ${String(attr.state)}` };
  }
  return { kind: "restored", row: old, restoredId: id, restoredName: name };
}

export type ConfirmRestoredPostgresGenerationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "refuse"; readonly reason: string };

export function confirmRestoredPostgresGeneration(
  after: unknown,
  expected: { readonly id: string; readonly name: string },
): ConfirmRestoredPostgresGenerationResult {
  const current = asRecord(after);
  if (current === undefined) {
    return { kind: "refuse", reason: "post-write Alchemy row is missing" };
  }
  const attr = asRecord(current.attr);
  if (attr === undefined) {
    return { kind: "refuse", reason: "post-write generation has no database identity" };
  }
  const id = typeof attr.id === "string" ? attr.id : undefined;
  const name = typeof attr.name === "string" ? attr.name : undefined;
  if (id === undefined || name === undefined) {
    return { kind: "refuse", reason: "post-write generation has no database identity" };
  }
  if (name !== expected.name || id !== expected.id) {
    return {
      kind: "refuse",
      reason: `post-write identity ${name}/${id} is not ${expected.name}/${expected.id}`,
    };
  }
  if (attr.state !== "ready") {
    return { kind: "refuse", reason: `post-write generation state is ${String(attr.state)}` };
  }
  return { kind: "ok" };
}
