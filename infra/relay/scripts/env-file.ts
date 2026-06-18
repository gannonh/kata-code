export function upsertEnvValue(contents: string, name: string, value: string): string {
  const entry = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "mu");
  if (pattern.test(contents)) {
    return contents.replace(pattern, entry);
  }
  if (!contents) {
    return `${entry}\n`;
  }
  return `${contents}${contents.endsWith("\n") ? "" : "\n"}${entry}\n`;
}

export function upsertEnvValues(
  contents: string,
  entries: Readonly<Record<string, string>>,
): string {
  let next = contents;
  for (const [name, value] of Object.entries(entries)) {
    next = upsertEnvValue(next, name, value);
  }
  return next;
}
