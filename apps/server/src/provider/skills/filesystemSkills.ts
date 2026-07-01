// @effect-diagnostics nodeBuiltinImport:off - Pi SDK skill loader uses sync node fs; this module mirrors that pattern.
import type { ServerProviderSkill } from "@kata-sh/code-contracts";
import {
  PROVIDER_SKILL_TOKEN_REGEX,
  isPathQualifiedProviderSkillToken,
  makeProviderSkillInvocationToken,
} from "@kata-sh/code-shared/providerSkills";
import { loadSkillsFromDir, stripFrontmatter, type Skill } from "@earendil-works/pi-coding-agent";
import * as NodeFs from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

/** Skill directory names scanned for Cursor (project + user). */
export const CURSOR_SKILL_DIRECTORY_NAMES = [
  ".cursor/skills",
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
] as const;

export interface FilesystemSkillDiscoveryOptions {
  readonly cwd: string;
  readonly homeDir?: string;
}

export interface IndexedFilesystemSkill {
  readonly name: string;
  readonly filePath: string;
  readonly baseDir: string;
  readonly scope: "project" | "user";
}

interface SkillScanLocation {
  readonly dir: string;
  readonly scope: "project" | "user";
  readonly source: string;
}

function resolveSkillScanLocations(options: FilesystemSkillDiscoveryOptions): SkillScanLocation[] {
  const cwd = NodePath.resolve(options.cwd);
  const homeDir = NodePath.resolve(options.homeDir ?? NodeOs.homedir());
  const locations: SkillScanLocation[] = [];

  for (const directoryName of CURSOR_SKILL_DIRECTORY_NAMES) {
    locations.push({
      dir: NodePath.join(cwd, directoryName),
      scope: "project",
      source: `project:${directoryName}`,
    });
  }
  for (const directoryName of CURSOR_SKILL_DIRECTORY_NAMES) {
    locations.push({
      dir: NodePath.join(homeDir, directoryName),
      scope: "user",
      source: `user:${directoryName}`,
    });
  }

  return locations;
}

function mapSkillToServerProviderSkill(
  skill: Skill,
  scope: "project" | "user",
): ServerProviderSkill {
  return {
    name: skill.name,
    path: skill.filePath,
    scope,
    enabled: !skill.disableModelInvocation,
    ...(skill.description ? { description: skill.description } : {}),
  };
}

function toIndexedFilesystemSkill(skill: Skill, scope: "project" | "user"): IndexedFilesystemSkill {
  return {
    name: skill.name,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    scope,
  };
}

function indexSkillByName(
  indexed: Map<string, IndexedFilesystemSkill>,
  skill: Skill,
  scope: "project" | "user",
): void {
  if (indexed.has(skill.name)) {
    return;
  }
  indexed.set(skill.name, toIndexedFilesystemSkill(skill, scope));
}

/**
 * Discover skills from Cursor-compatible filesystem locations.
 *
 * Scan order is project directories first, then user-level. When multiple
 * skills share a name, the first match wins for `$skillname` expansion.
 */
export function discoverCursorFilesystemSkills(options: FilesystemSkillDiscoveryOptions): {
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly indexedByName: ReadonlyMap<string, IndexedFilesystemSkill>;
  readonly indexedByInvocationToken: ReadonlyMap<string, IndexedFilesystemSkill>;
} {
  const seenPaths = new Set<string>();
  const skills: ServerProviderSkill[] = [];
  const indexedByName = new Map<string, IndexedFilesystemSkill>();
  const indexedByInvocationToken = new Map<string, IndexedFilesystemSkill>();

  for (const location of resolveSkillScanLocations(options)) {
    const loaded = loadSkillsFromDir({
      dir: location.dir,
      source: location.source,
    });

    for (const skill of loaded.skills) {
      if (seenPaths.has(skill.filePath)) {
        continue;
      }
      seenPaths.add(skill.filePath);
      const serverSkill = mapSkillToServerProviderSkill(skill, location.scope);
      const indexedSkill = toIndexedFilesystemSkill(skill, location.scope);
      skills.push(serverSkill);
      indexSkillByName(indexedByName, skill, location.scope);
      indexedByInvocationToken.set(makeProviderSkillInvocationToken(serverSkill), indexedSkill);
    }
  }

  return { skills, indexedByName, indexedByInvocationToken };
}

export function formatSkillInvocationBlock(
  skill: IndexedFilesystemSkill,
  rawContent: string,
): string {
  const body = stripFrontmatter(rawContent).trim();
  return [
    `<skill name="${skill.name}" location="${skill.filePath}">`,
    `References are relative to ${skill.baseDir}.`,
    "",
    body,
    "</skill>",
  ].join("\n");
}

/**
 * Expand Composer `$skillname` tokens into inline Agent Skills XML blocks.
 * Unknown tokens are left unchanged.
 */
export function expandSkillTokensInText(
  text: string,
  indexedByName: ReadonlyMap<string, IndexedFilesystemSkill>,
  indexedByInvocationToken: ReadonlyMap<string, IndexedFilesystemSkill>,
  readSkillContent: (skill: IndexedFilesystemSkill) => string,
): string {
  let result = "";
  let cursor = 0;

  for (const match of text.matchAll(PROVIDER_SKILL_TOKEN_REGEX)) {
    const prefix = match[1] ?? "";
    const skillName = match[2] ?? "";
    const matchIndex = match.index ?? 0;
    const tokenStart = matchIndex + prefix.length;
    const tokenText = `$${skillName}`;
    const skill = isPathQualifiedProviderSkillToken(skillName)
      ? indexedByInvocationToken.get(skillName)
      : indexedByName.get(skillName);

    result += text.slice(cursor, tokenStart);

    if (skill) {
      const rawContent = readSkillContent(skill);
      result += formatSkillInvocationBlock(skill, rawContent);
    } else {
      result += tokenText;
    }

    cursor = tokenStart + tokenText.length;
  }

  if (cursor === 0) {
    return text;
  }

  result += text.slice(cursor);
  return result;
}

/**
 * Discover and expand Composer `$skillname` tokens for a Cursor prompt.
 */
export function expandCursorSkillTokensInPrompt(
  text: string,
  options: FilesystemSkillDiscoveryOptions,
): string {
  const { indexedByName, indexedByInvocationToken } = discoverCursorFilesystemSkills(options);
  return expandSkillTokensInText(text, indexedByName, indexedByInvocationToken, (skill) =>
    NodeFs.readFileSync(skill.filePath, "utf-8"),
  );
}
