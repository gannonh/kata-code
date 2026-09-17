import * as NodeCrypto from "node:crypto";
import type { LinearEventTrigger, LinearRoutineEvent } from "@kata-sh/code-contracts";

export const LINEAR_TIMESTAMP_TOLERANCE_MS = 60_000;

/** A Linear issue webhook delivery reduced to the fields routines filter on. */
export interface LinearRoutineEventSummary {
  readonly provider: "linear";
  /** "created" for Issue/create, "updated" for Issue/update. */
  readonly action: "created" | "updated";
  readonly workspaceId: string;
  readonly teamId: string | null;
  readonly projectId: string | null;
  readonly stateId: string | null;
  readonly stateChanged: boolean;
  readonly previousStateId: string | null;
  readonly labelIds: ReadonlyArray<string>;
  readonly addedLabelIds: ReadonlyArray<string>;
  readonly issueId: string;
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly actor: string;
}

/** A delivery routines can run on, or an ignored delivery with its diagnostic. */
export type LinearEventSummary =
  | { readonly kind: "event"; readonly summary: LinearRoutineEventSummary }
  | { readonly kind: "ignored"; readonly detail: string };

const MAX_TEXT = 200;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const bounded = (value: string | null): string =>
  (value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

const ignored = (detail: string): LinearEventSummary => ({ kind: "ignored", detail });

function stringIds(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return value.filter((id): id is string => typeof id === "string");
}

/** Hex HMAC-SHA256 of the raw body, as Linear sends it in Linear-Signature. */
export function linearWebhookSignature(secret: Uint8Array, body: Uint8Array): string {
  return NodeCrypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Timing-safe comparison of a Linear-Signature header. */
export function linearSignatureMatches(
  secret: Uint8Array,
  body: Uint8Array,
  header: string,
): boolean {
  const expected = Buffer.from(linearWebhookSignature(secret, body));
  const provided = Buffer.from(header);
  return (
    expected.byteLength === provided.byteLength && NodeCrypto.timingSafeEqual(expected, provided)
  );
}

/** Millisecond epoch the payload declares in webhookTimestamp, or null. */
export function payloadWebhookTimestamp(payload: unknown): number | null {
  const value = asRecord(payload)?.webhookTimestamp;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Signed timestamp freshness: |now - timestamp| <= LINEAR_TIMESTAMP_TOLERANCE_MS. */
export function linearTimestampIsFresh(timestamp: number | null, now: number): boolean {
  return timestamp !== null && Math.abs(now - timestamp) <= LINEAR_TIMESTAMP_TOLERANCE_MS;
}

/** Entity type the payload declares (payload.type), or null. */
export function payloadEventType(payload: unknown): string | null {
  return asString(asRecord(payload)?.type);
}

/** Organization id the payload declares (payload.organizationId), or null. */
export function payloadOrganizationId(payload: unknown): string | null {
  return asString(asRecord(payload)?.organizationId);
}

/** Maps an Issue create/update payload to a routine event or an ignored diagnostic. */
export function summarizeLinearEvent(payload: unknown): LinearEventSummary {
  const body = asRecord(payload);
  if (!body) return ignored("Payload is not an object.");
  const organizationId = payloadOrganizationId(payload);
  if (organizationId === null) return ignored("Payload has no organizationId.");
  if (payloadEventType(payload) !== "Issue") return ignored("Payload type is not Issue.");
  const data = asRecord(body.data);
  const issueId = asString(data?.id);
  if (data === null || issueId === null) return ignored("Payload data has no issue id.");
  const fields = {
    provider: "linear",
    workspaceId: organizationId,
    teamId: asString(data.teamId),
    projectId: asString(data.projectId),
    issueId,
    identifier: bounded(asString(data.identifier)),
    title: bounded(asString(data.title)),
    url: bounded(asString(data.url)),
    actor: bounded(asString(asRecord(body.actor)?.name) ?? asString(body.actorId)),
  } as const;
  if (body.action === "create") {
    return {
      kind: "event",
      summary: {
        ...fields,
        action: "created",
        stateId: asString(data.stateId),
        stateChanged: false,
        previousStateId: null,
        labelIds: stringIds(data.labelIds),
        addedLabelIds: [],
      },
    };
  }
  if (body.action === "update") {
    const updatedFrom = asRecord(body.updatedFrom);
    if (updatedFrom === null) return ignored("Issue update without transition evidence.");
    const transition = stateTransition(updatedFrom, data);
    const labelIds = stringIds(data.labelIds);
    const addedLabelIds = addedLabels(updatedFrom, data, labelIds);
    if (!transition.changed && addedLabelIds.length === 0)
      return ignored("Issue update without a status transition or added label.");
    return {
      kind: "event",
      summary: {
        ...fields,
        action: "updated",
        stateId: transition.stateId,
        stateChanged: transition.changed,
        previousStateId: transition.previousStateId,
        labelIds,
        addedLabelIds,
      },
    };
  }
  return ignored("Only Issue create and update are supported.");
}

/**
 * Routine events a summarized delivery can raise. One update can raise two, so
 * every saved trigger is checked separately against them.
 */
function summaryEvents(summary: LinearRoutineEventSummary): ReadonlyArray<LinearRoutineEvent> {
  if (summary.action === "created") return ["issue_created"];
  const events: LinearRoutineEvent[] = [];
  if (summary.stateChanged) events.push("status_changed");
  if (summary.addedLabelIds.length > 0) events.push("label_added");
  return events;
}

/** Decides whether a saved trigger admits a summarized Linear delivery. */
export function linearTriggerMatchesEvent(
  trigger: LinearEventTrigger,
  summary: LinearRoutineEventSummary,
): boolean {
  if (trigger.workspaceId !== summary.workspaceId) return false;
  if (trigger.teamId !== undefined && trigger.teamId !== summary.teamId) return false;
  if (trigger.projectId !== undefined && trigger.projectId !== summary.projectId) return false;
  if (!summaryEvents(summary).includes(trigger.event)) return false;
  if (trigger.event === "status_changed") return summary.stateId === trigger.stateId;
  if (trigger.event === "label_added") return summary.addedLabelIds.includes(trigger.labelId);
  return true;
}

/** Bounded, untrusted context appended below the saved instruction. */
export function formatLinearEventContext(summary: LinearRoutineEventSummary): string {
  const lines = [
    "Linear issue event context (untrusted, provided by the webhook payload):",
    `- Action: ${summary.action}`,
  ];
  if (summary.identifier) lines.push(`- Issue: ${summary.identifier}`);
  if (summary.title) lines.push(`- Title: ${summary.title}`);
  if (summary.url) lines.push(`- URL: ${summary.url}`);
  if (summary.actor) lines.push(`- Actor: ${summary.actor}`);
  if (summary.action === "updated") {
    if (summary.stateChanged) lines.push("- Change: status changed");
    if (summary.addedLabelIds.length > 0)
      lines.push(`- Change: labels added (${summary.addedLabelIds.length})`);
  }
  return lines.join("\n");
}

function stateTransition(
  updatedFrom: Record<string, unknown>,
  data: Record<string, unknown>,
): {
  readonly changed: boolean;
  readonly previousStateId: string | null;
  readonly stateId: string | null;
} {
  // Only a string or null names a previous state; anything else is not evidence.
  const previous = asStateId(updatedFrom.stateId);
  const stateId = asStateId(data.stateId) ?? null;
  return {
    changed: previous !== undefined && previous !== stateId,
    previousStateId: previous ?? null,
    stateId,
  };
}

/** A JSON string or null as-is; anything else marks a value that is not evidence. */
const asStateId = (value: unknown): string | null | undefined =>
  value === null || typeof value === "string" ? value : undefined;

/**
 * Labels the update added: the current labels absent from the pre-update list
 * when the payload carries one, unioned with any explicitly added label ids.
 */
function addedLabels(
  updatedFrom: Record<string, unknown>,
  data: Record<string, unknown>,
  labelIds: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const added = new Set<string>();
  if ("labelIds" in updatedFrom) {
    const previous = new Set(stringIds(updatedFrom.labelIds));
    for (const id of labelIds) if (!previous.has(id)) added.add(id);
  }
  for (const id of stringIds(data.addedLabelIds)) added.add(id);
  return [...added];
}
