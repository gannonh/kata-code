/**
 * Cursor emits upstream transport failures as assistant text rather than as a
 * JSON-RPC error: the ACP `session/prompt` call resolves with
 * `stopReason: "end_turn"` and the only content of the turn is a chunk like
 * `\n\nError: RetriableError: [aborted] read ECONNRESET`. Left alone that
 * renders as a successful assistant message whose body is an error string.
 *
 * This module recognizes those chunks so the Cursor adapter can suppress them,
 * retry the prompt, and surface a real runtime error when retries run out.
 *
 * @module provider/acp/CursorRetriableFailure
 */

/** Attempts per turn, including the first. */
export const CURSOR_RETRIABLE_MAX_ATTEMPTS = 3;

/** Backoff before attempt N+1, indexed by completed attempt count - 1. */
export const CURSOR_RETRIABLE_BACKOFF_MILLIS: ReadonlyArray<number> = [1_000, 3_000];

const CURSOR_RETRIABLE_PATTERN =
  /^Error:\s*RetriableError:\s*(?:\[(?<code>[^\]]*)\]\s*)?(?<detail>.+)$/s;

export interface CursorRetriableFailure {
  /** Cursor's bracketed status code, e.g. `aborted`, `unavailable`. */
  readonly code: string | undefined;
  /** Human-readable cause, e.g. `read ECONNRESET`. */
  readonly detail: string;
  /** The original chunk text, trimmed. */
  readonly message: string;
}

/**
 * Parse a Cursor retriable-failure marker out of an assistant text chunk.
 *
 * Only whole-chunk matches are recognized. A chunk that mixes real assistant
 * prose with the marker is left untouched so genuine model output is never
 * swallowed.
 */
export function parseCursorRetriableFailure(text: string): CursorRetriableFailure | undefined {
  const trimmed = text.trim();
  const match = CURSOR_RETRIABLE_PATTERN.exec(trimmed);
  if (!match?.groups) {
    return undefined;
  }
  const code = match.groups.code?.trim();
  const detail = match.groups.detail?.trim();
  if (!detail) {
    return undefined;
  }
  return {
    code: code ? code : undefined,
    detail,
    message: trimmed,
  };
}

/** Milliseconds to wait before the attempt following `completedAttempts`. */
export function cursorRetriableBackoffMillis(completedAttempts: number): number {
  const index = Math.max(0, completedAttempts - 1);
  return (
    CURSOR_RETRIABLE_BACKOFF_MILLIS[index] ??
    CURSOR_RETRIABLE_BACKOFF_MILLIS[CURSOR_RETRIABLE_BACKOFF_MILLIS.length - 1] ??
    0
  );
}

/** Message shown when a turn is retried after a Cursor transport failure. */
export function cursorRetryWarningMessage(input: {
  readonly failure: CursorRetriableFailure;
  readonly attempt: number;
  readonly maxAttempts: number;
}): string {
  return `Cursor reported a retriable failure (${input.failure.detail}); retrying turn (attempt ${input.attempt + 1} of ${input.maxAttempts}).`;
}

/** Message shown when a turn fails after all retries are exhausted. */
export function cursorRetryExhaustedMessage(input: {
  readonly failure: CursorRetriableFailure;
  readonly attempts: number;
}): string {
  return `Cursor failed after ${input.attempts} attempt${input.attempts === 1 ? "" : "s"}: ${input.failure.message}`;
}
