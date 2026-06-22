const FATAL_LAUNCH_ERROR_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Failed to fetch dynamically imported module",
] as const;

export function trackFatalLaunchErrors(page: {
  on(event: "pageerror", listener: (error: Error) => void): void;
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): void;
}): () => readonly string[] {
  const errors: string[] = [];
  const record = (message: string) => {
    errors.push(message);
  };

  page.on("pageerror", (error) => {
    record(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      record(message.text());
    }
  });

  return () => errors;
}

export function assertNoFatalLaunchErrors(errors: readonly string[]): void {
  const failures = errors.filter((entry) =>
    FATAL_LAUNCH_ERROR_PATTERNS.some((pattern) => entry.includes(pattern)),
  );

  if (failures.length > 0) {
    throw new Error(`Fatal renderer errors during launch:\n${failures.join("\n")}`);
  }
}
