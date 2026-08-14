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
export const redactProviderSecrets = (value: unknown, key?: string): unknown =>
  redactValue(value, key, new WeakSet<object>());

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const redactValue = (
  value: unknown,
  key: string | undefined,
  visiting: WeakSet<object>,
): unknown => {
  if (typeof value === "string") {
    return key !== undefined && secretKeyPattern.test(key) ? REDACTED : redactString(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (visiting.has(value)) {
    return REDACTED;
  }
  if (value instanceof Error) {
    visiting.add(value);
    try {
      const output: Record<string, unknown> = {
        name: value.name,
        message: redactString(value.message),
      };
      if (typeof value.stack === "string") {
        output.stack = redactString(value.stack);
      }
      if (value.cause !== undefined) {
        output.cause = redactValue(value.cause, undefined, visiting);
      }
      for (const [entryKey, entryValue] of Object.entries(value)) {
        if (!(entryKey in output)) {
          output[entryKey] = redactValue(entryValue, entryKey, visiting);
        }
      }
      return output;
    } finally {
      visiting.delete(value);
    }
  }
  if (Array.isArray(value)) {
    visiting.add(value);
    try {
      return value.map((entry) => redactValue(entry, undefined, visiting));
    } finally {
      visiting.delete(value);
    }
  }
  if (!isPlainObject(value)) {
    return value;
  }
  visiting.add(value);
  try {
    const output: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      output[entryKey] = redactValue(entryValue, entryKey, visiting);
    }
    return output;
  } finally {
    visiting.delete(value);
  }
};

export const redactProviderEvent = <T>(event: T): T => redactProviderSecrets(event) as T;

export { REDACTED };
