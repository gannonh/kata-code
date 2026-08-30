const SECRET_KEY = /(token|secret|password|credential|authorization|auth)/i;

export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value === null || typeof value !== "object") return value;

  const entries = Object.entries(value);
  return Object.fromEntries(
    entries.map(([key, child]) => [
      key,
      SECRET_KEY.test(key) ? "[redacted]" : redactSecrets(child),
    ]),
  );
}

export function redactDiagnostic(value: unknown): string {
  const redacted = redactSecrets(value);
  return typeof redacted === "string"
    ? redacted
    : (JSON.stringify(redacted) ?? "Unknown diagnostic");
}
