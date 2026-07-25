import { describe, expect, it } from "vite-plus/test";

import {
  CURSOR_RETRIABLE_MAX_ATTEMPTS,
  cursorRetriableBackoffMillis,
  cursorRetryExhaustedMessage,
  cursorRetryWarningMessage,
  parseCursorRetriableFailure,
} from "./CursorRetriableFailure.ts";

describe("parseCursorRetriableFailure", () => {
  // These are the exact strings observed in Cursor provider logs. If Cursor
  // changes the wording, retries silently stop and the error text leaks back
  // into assistant messages, so the literals are asserted verbatim.
  it.each([
    ["\n\nError: RetriableError: [aborted] read ECONNRESET", "aborted", "read ECONNRESET"],
    ["\n\nError: RetriableError: [unavailable] PING timed out", "unavailable", "PING timed out"],
    ["\n\nError: RetriableError: [unknown] Premature close", "unknown", "Premature close"],
  ])("recognizes %j", (text, code, detail) => {
    const failure = parseCursorRetriableFailure(text);
    expect(failure?.code).toBe(code);
    expect(failure?.detail).toBe(detail);
    expect(failure?.message).toBe(text.trim());
  });

  it("recognizes a marker with no bracketed status code", () => {
    const failure = parseCursorRetriableFailure("Error: RetriableError: socket hang up");
    expect(failure?.code).toBeUndefined();
    expect(failure?.detail).toBe("socket hang up");
  });

  it("ignores assistant prose that merely mentions the error", () => {
    // A turn that explains the error is real model output. Dropping it would
    // hide the answer and trigger a pointless retry.
    expect(
      parseCursorRetriableFailure(
        "You are hitting Error: RetriableError: [aborted] read ECONNRESET because the socket closed.",
      ),
    ).toBeUndefined();
  });

  it.each([
    ["", "empty text"],
    ["hello from cursor", "ordinary output"],
    ["Error: something else went wrong", "a non-retriable error"],
    ["Error: RetriableError:", "a marker with no detail"],
  ])("returns undefined for %j (%s)", (text) => {
    expect(parseCursorRetriableFailure(text)).toBeUndefined();
  });
});

describe("cursorRetriableBackoffMillis", () => {
  it("backs off progressively and never returns a negative delay", () => {
    expect(cursorRetriableBackoffMillis(1)).toBe(1_000);
    expect(cursorRetriableBackoffMillis(2)).toBe(3_000);
    // Callers past the configured table reuse the last (longest) delay rather
    // than falling back to a hot loop.
    expect(cursorRetriableBackoffMillis(99)).toBe(3_000);
    expect(cursorRetriableBackoffMillis(0)).toBeGreaterThan(0);
  });
});

describe("retry messages", () => {
  const failure = parseCursorRetriableFailure("Error: RetriableError: [aborted] read ECONNRESET")!;

  it("names the next attempt so the user can tell retries apart", () => {
    expect(
      cursorRetryWarningMessage({
        failure,
        attempt: 1,
        maxAttempts: CURSOR_RETRIABLE_MAX_ATTEMPTS,
      }),
    ).toBe(
      "Cursor reported a retriable failure (read ECONNRESET); retrying turn (attempt 2 of 3).",
    );
  });

  it("reports how many attempts were spent before giving up", () => {
    expect(cursorRetryExhaustedMessage({ failure, attempts: 3 })).toBe(
      "Cursor failed after 3 attempts: Error: RetriableError: [aborted] read ECONNRESET",
    );
    expect(cursorRetryExhaustedMessage({ failure, attempts: 1 })).toContain("1 attempt:");
  });
});
