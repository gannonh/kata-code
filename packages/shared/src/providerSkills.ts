import type { ServerProviderSkill } from "@kata-sh/code-contracts";

const PROVIDER_SKILL_TOKEN_PREFIX = "skill";

/**
 * Matches Composer `$skillname` / path-qualified `$skill:name:hash` tokens
 * embedded in prompts and rendered message text. A token is preceded by start
 * of string or whitespace and followed by whitespace or end of string.
 */
export const PROVIDER_SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;

/** FNV-1a 32-bit hash encoded as base-36 for compact path-qualified skill tokens. */
function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Stable hash of a skill filesystem path for path-qualified invocation tokens. */
export function providerSkillPathHash(path: string): string {
  return fnv1a32(path);
}

/** Build a path-qualified Composer token (`skill:name:hash`) for a provider skill. */
export function makeProviderSkillInvocationToken(
  skill: Pick<ServerProviderSkill, "name" | "path">,
): string {
  return `${PROVIDER_SKILL_TOKEN_PREFIX}:${skill.name}:${providerSkillPathHash(skill.path)}`;
}

/** True when `token` is a `skill:name:hash` path-qualified invocation token. */
export function isPathQualifiedProviderSkillToken(token: string): boolean {
  if (!token.startsWith(`${PROVIDER_SKILL_TOKEN_PREFIX}:`)) {
    return false;
  }
  const parts = token.split(":");
  return parts.length >= 3 && parts[0] === PROVIDER_SKILL_TOKEN_PREFIX;
}
