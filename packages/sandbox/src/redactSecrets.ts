/**
 * `redactSecrets` — literal-value replacement of each non-empty secret value
 * with a `***` placeholder in captured/logged setup output.
 *
 * Phase 2 setup captures `install`/`start`/`terminals` output as a buffered
 * string. Every injected secret value is redacted (replaced with a
 * placeholder) before the captured text is logged or surfaced, so a leaked
 * secret in user-script output is not a security failure.
 *
 * Values are sorted by length descending so a longer secret is redacted before
 * a shorter secret that is a substring of it (otherwise the shorter replacement
 * would corrupt the longer value and leave a partial secret in place). Empty
 * strings are skipped (a literal replacement of `""` would match between every
 * character).
 *
 * Pure and I/O-free so it is reusable by the future Kata Agent and
 * independently unit-testable with no server context.
 *
 * @module redactSecrets
 */

/** Placeholder substituted for every non-empty secret value. */
export const REDACTED_PLACEHOLDER = "***";

/**
 * Replace each non-empty secret value in `text` with `***`. Values are matched
 * literally (no regex) and applied longest-first so overlapping substrings
 * redact correctly. Empty-string values are skipped.
 */
export function redactSecrets(text: string, secretValues: ReadonlyArray<string>): string {
  const values = secretValues.filter((v) => v.length > 0);
  if (values.length === 0) return text;
  // Longest first so a secret that contains a shorter secret as a substring is
  // redacted before the shorter one would split it.
  const ordered = [...values].sort((a, b) => b.length - a.length);
  let result = text;
  for (const secret of ordered) {
    // Literal split/join replacement: no regex special-character handling.
    result = result.split(secret).join(REDACTED_PLACEHOLDER);
  }
  return result;
}
