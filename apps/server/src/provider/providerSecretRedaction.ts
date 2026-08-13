const registeredSecrets = new Map<string, number>();
const REDACTED = "[REDACTED]";

const secretKeyPattern = /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION|BEARER)/iu;

/** Register a process-local credential and return a removable redaction handle. */
export const registerProviderSecret = (secret: string): (() => void) => {
  const value = secret.trim();
  if (!value) return () => {};
  registeredSecrets.set(value, (registeredSecrets.get(value) ?? 0) + 1);
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    const count = registeredSecrets.get(value);
    if (count === undefined || count <= 1) registeredSecrets.delete(value);
    else registeredSecrets.set(value, count - 1);
  };
};

/** Test/diagnostic helper: no secret values are returned. */
export const registeredProviderSecretCount = (): number => registeredSecrets.size;

const redactString = (value: string): string => {
  let redacted = value;
  for (const secret of registeredSecrets.keys()) {
    if (secret.length > 0 && redacted.includes(secret)) {
      redacted = redacted.split(secret).join(REDACTED);
    }
  }
  return redacted;
};

/** Clone and redact provider payloads before they reach logs, events, or UI. */
export const redactProviderSecrets = (value: unknown, key?: string): unknown => {
  if (typeof value === "string") {
    return key !== undefined && secretKeyPattern.test(key) ? REDACTED : redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactProviderSecrets(entry));
  }
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactProviderSecrets(entryValue, entryKey);
    }
    return output;
  }
  return value;
};

export const redactProviderEvent = <T>(event: T): T => redactProviderSecrets(event) as T;

export { REDACTED };
