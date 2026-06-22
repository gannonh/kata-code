import { setTimeout as delay } from "node:timers/promises";

export class TimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;
  readonly details?: string;

  constructor(label: string, timeoutMs: number, details?: string) {
    super(
      details
        ? `${label}: timed out after ${timeoutMs}ms\n${details}`
        : `${label}: timed out after ${timeoutMs}ms`,
    );
    this.name = "TimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
    this.details = details;
  }
}

export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
  details?: string | (() => Promise<string | undefined>),
): Promise<T> {
  const abortController = new AbortController();
  const timeoutTask = (async () => {
    await delay(timeoutMs, undefined, { signal: abortController.signal });
    const resolvedDetails = typeof details === "function" ? await details() : details;
    throw new TimeoutError(label, timeoutMs, resolvedDetails);
  })();

  try {
    return await Promise.race([operation(abortController.signal), timeoutTask]);
  } finally {
    abortController.abort();
  }
}
