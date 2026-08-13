const registeredSecrets = new Set<string>();
const MAX_REGISTERED_SECRETS = 512;
const REDACTED = "[REDACTED]";

const secretKeyPattern = /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|AUTHORIZATION|BEARER)/iu;

/** Register a process-local credential for redaction from provider diagnostics. */
export const registerProviderSecret = (secret: string): void => {
  const value = secret.trim();
  if (!value) return;
  if (registeredSecrets.size >= MAX_REGISTERED_SECRETS) {
    const oldest = registeredSecrets.values().next().value;
    if (oldest) registeredSecrets.delete(oldest);
  }
  registeredSecrets.add(value);
};

const redactString = (value: string): string => {
  let redacted = value;
  for (const secret of registeredSecrets) {
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
