/**
 * Classify a Pi SDK turn/prompt failure as interrupted vs failed.
 *
 * Pi surfaces an in-flight abort through `session.abort()` and through
 * abort-shaped errors thrown out of `prompt()`. Kata must distinguish those
 * from genuine provider errors: an interruption maps to a `turn.aborted`
 * event, not a failed turn.
 *
 * @module provider/piTurnFailure
 */

export type PiTurnFailureKind = "interrupted" | "failed";

export interface PiTurnFailureClassification {
  readonly kind: PiTurnFailureKind;
  readonly reason: string;
}

const INTERRUPTED_MARKERS = ["abort", "interrupted"] as const;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

function nameOf(error: unknown): string {
  if (error instanceof Error && error.name) return error.name;
  return "";
}

/**
 * Classify a Pi turn failure. An `AbortError` (or any error whose name/message
 * matches a known interruption marker) is treated as interrupted; everything
 * else is a real failure.
 */
export function classifyPiTurnFailure(error: unknown): PiTurnFailureClassification {
  const name = nameOf(error);
  const message = messageOf(error).toLowerCase();

  if (name === "AbortError" || INTERRUPTED_MARKERS.some((marker) => message.includes(marker))) {
    return { kind: "interrupted", reason: "Pi turn was interrupted." };
  }

  return {
    kind: "failed",
    reason: message || "Pi turn failed without a diagnostic message.",
  };
}
