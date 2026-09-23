/**
 * CursorSkills — workspace-aware discovery and native invocation for Cursor.
 *
 * Cursor discovers Agent Skills recursively from user and project roots but
 * its ACP command catalog only appears after opening a real session. Scanning
 * the same roots avoids starting an agent and its MCP servers just to populate
 * a composer menu. Installed plugin skills live under the enabled plugin roots
 * from `CursorInstalledPlugins`.
 *
 * @module provider/Drivers/CursorSkills
 */

import type { ServerProviderSkill } from "@kata-sh/code-contracts";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYamlDocument } from "yaml";

import {
  cursorHome,
  cursorInstalledPluginRoots,
  makeCursorPluginScanBudget,
  orUndefined,
  readJsonObject,
  type CursorPluginScanBudget,
} from "../acp/CursorInstalledPlugins.ts";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILL_MENTION_PATTERN =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;
const HAS_SKILL_MENTION_PATTERN = new RegExp(SKILL_MENTION_PATTERN.source, "u");
const MAX_SKILL_DEPTH = 10;
const MAX_SKILL_BYTES = ByteSize.bytes(1_000_000);

interface CursorSkillFrontmatter {
  readonly description?: string;
  readonly displayName?: string;
  readonly userInvocationOnly?: boolean;
  readonly userInvocable?: boolean;
  readonly cliVisible: boolean;
}

class CursorSkillsProbeError extends Schema.TaggedError<CursorSkillsProbeError>()(
  "CursorSkillsProbeError",
  {
    reason: Schema.Literals(["scan-budget-exhausted", "filesystem-error"]),
    cwd: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    const location = this.cwd === undefined ? "" : ` for '${this.cwd}'`;
    return `Cursor skill discovery${location} was incomplete (${this.reason}).`;
  }
}

function parseFrontmatterBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase()) {
    case "true":
    case "yes":
    case "on":
      return true;
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return undefined;
  }
}

function parseSkillFrontmatter(contents: string): CursorSkillFrontmatter | undefined {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) return { cliVisible: true };

  let parsed: unknown;
  try {
    parsed = parseYamlDocument(match[1] ?? "");
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;

  const record = parsed as Record<string, unknown>;
  const metadata =
    typeof record.metadata === "object" && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : undefined;
  const rawSurfaces = metadata?.surfaces;
  const surfaces = Array.isArray(rawSurfaces)
    ? rawSurfaces.filter((surface): surface is string => typeof surface === "string")
    : typeof rawSurfaces === "string"
      ? rawSurfaces.split(",")
      : [];
  const description = typeof record.description === "string" ? record.description.trim() : "";
  const displayName = typeof record.name === "string" ? record.name.trim() : "";
  return {
    cliVisible:
      surfaces.length === 0 || surfaces.some((surface) => surface.trim().toLowerCase() === "cli"),
    ...(description ? { description } : {}),
    ...(displayName ? { displayName } : {}),
    ...(parseFrontmatterBoolean(record["disable-model-invocation"]) === true
      ? { userInvocationOnly: true }
      : {}),
    ...(parseFrontmatterBoolean(record["user-invocable"]) === false
      ? { userInvocable: false }
      : {}),
  };
}

const discoverSkillsInRoot = Effect.fn("discoverCursorSkillsInRoot")(function* (input: {
  readonly directory: string;
  readonly scope: "user" | "project";
  readonly budget: CursorPluginScanBudget;
}): Effect.fn.Return<ReadonlyArray<ServerProviderSkill>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const skills: ServerProviderSkill[] = [];
  if (input.budget.exhausted) return skills;
  const rootDirectory = yield* orUndefined(fileSystem.realPath(input.directory), input.budget);
  if (!rootDirectory) return skills;
  const visitedDirectories = new Set<string>();

  const visit = Effect.fn("visitCursorSkillDirectory")(function* (
    directory: string,
    depth: number,
  ): Effect.fn.Return<void, never> {
    if (input.budget.exhausted) return;
    const resolvedDirectory = yield* orUndefined(fileSystem.realPath(directory), input.budget);
    if (!resolvedDirectory) {
      return;
    }
    if (visitedDirectories.has(resolvedDirectory)) {
      return;
    }
    visitedDirectories.add(resolvedDirectory);
    // A symlink whose target lives outside the root is a skill package
    // boundary: read its own SKILL.md so linked skill libraries show up, but
    // never walk the target tree.
    const insideRoot =
      resolvedDirectory === rootDirectory ||
      resolvedDirectory.startsWith(`${rootDirectory}${path.sep}`);

    const skillPath = path.join(directory, "SKILL.md");
    const skillInfo = yield* orUndefined(fileSystem.stat(skillPath), input.budget);
    if (skillInfo?.type === "File") {
      let frontmatter: CursorSkillFrontmatter | undefined = { cliVisible: true };
      if (skillInfo.size <= MAX_SKILL_BYTES && skillInfo.size <= input.budget.remainingBytes) {
        const contents = yield* orUndefined(fileSystem.readFileString(skillPath));
        if (contents !== undefined) {
          input.budget.remainingBytes -= skillInfo.size;
          frontmatter = parseSkillFrontmatter(contents);
        }
      }
      const name = path.basename(directory).trim();
      if (frontmatter?.cliVisible && name) {
        skills.push({
          name,
          path: skillPath,
          scope: input.scope,
          enabled: true,
          ...(frontmatter.displayName && frontmatter.displayName !== name
            ? { displayName: frontmatter.displayName }
            : {}),
          ...(frontmatter.description ? { description: frontmatter.description } : {}),
          ...(frontmatter.userInvocationOnly ? { userInvocationOnly: true } : {}),
          ...(frontmatter.userInvocable === false ? { userInvocable: false } : {}),
        });
      }
    }

    if (!insideRoot) {
      return;
    }
    const entries = yield* orUndefined(fileSystem.readDirectory(directory), input.budget);
    if (!entries) {
      return;
    }
    for (const entry of [...entries].sort()) {
      if (input.budget.remainingEntries === 0) {
        input.budget.exhausted = true;
        return;
      }
      input.budget.remainingEntries -= 1;
      const child = path.join(directory, entry);
      const info = yield* orUndefined(fileSystem.stat(child), input.budget);
      if (info?.type !== "Directory") continue;
      if (depth >= MAX_SKILL_DEPTH) {
        input.budget.exhausted = true;
        return;
      }
      yield* visit(child, depth + 1);
    }
  });

  yield* visit(rootDirectory, 0);
  return skills;
});

function staysInside(parent: string, child: string, separator: string): boolean {
  return child === parent || child.startsWith(`${parent}${separator}`);
}

const pluginSkillDirectories = Effect.fn("pluginSkillDirectories")(function* (
  pluginRoot: string,
  budget: CursorPluginScanBudget,
) {
  const path = yield* Path.Path;
  const manifestPaths = [".cursor-plugin", ".claude-plugin", ".codex-plugin"].map((directory) =>
    path.join(pluginRoot, directory, "plugin.json"),
  );
  let skillsField: unknown;
  for (const manifestPath of manifestPaths) {
    const manifest = yield* readJsonObject(manifestPath, budget);
    if (!manifest || !("skills" in manifest)) continue;
    skillsField = manifest.skills;
    break;
  }
  const relatives = Array.isArray(skillsField)
    ? skillsField.filter(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
      )
    : typeof skillsField === "string" && skillsField.trim().length > 0
      ? [skillsField]
      : ["skills"];
  const directories: string[] = [];
  for (const relative of relatives) {
    const resolved = path.resolve(pluginRoot, relative);
    const directory = relative.replaceAll("\\", "/").endsWith("SKILL.md")
      ? path.dirname(resolved)
      : resolved;
    if (!staysInside(pluginRoot, directory, path.sep)) continue;
    directories.push(directory);
  }
  return directories;
});

const cursorPluginSkillDirectories = Effect.fn("cursorPluginSkillDirectories")(function* (
  userHome: string,
  environment: NodeJS.ProcessEnv,
  budget: CursorPluginScanBudget,
  cwd?: string,
) {
  const directories: string[] = [];
  for (const { root } of yield* cursorInstalledPluginRoots(userHome, environment, budget, cwd)) {
    directories.push(...(yield* pluginSkillDirectories(root, budget)));
  }
  return directories;
});

const inspectCursorSkills = Effect.fn("inspectCursorSkills")(function* (
  cwd?: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const path = yield* Path.Path;
  const userHome = cursorHome(environment);
  const rootsBelow = (base: string, scope: "user" | "project") => [
    { directory: path.join(base, ".cursor", "skills"), scope },
    { directory: path.join(base, ".agents", "skills"), scope },
    { directory: path.join(base, ".codex", "skills"), scope },
    { directory: path.join(base, ".claude", "skills"), scope },
  ];
  const skillsByName = new Map<string, ServerProviderSkill>();
  const budget = makeCursorPluginScanBudget();
  const pluginDirectories = yield* cursorPluginSkillDirectories(userHome, environment, budget, cwd);
  const roots = [
    ...(cwd ? rootsBelow(cwd, "project") : []),
    ...rootsBelow(userHome, "user"),
    ...pluginDirectories.map((directory) => ({ directory, scope: "user" as const })),
  ];
  for (const root of roots) {
    if (budget.exhausted) break;
    const skills = yield* discoverSkillsInRoot({ ...root, budget });
    for (const skill of skills) {
      if (!skillsByName.has(skill.name)) skillsByName.set(skill.name, skill);
    }
  }
  return {
    skills: [...skillsByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    failureReason: budget.exhausted
      ? ("scan-budget-exhausted" as const)
      : budget.incomplete
        ? ("filesystem-error" as const)
        : undefined,
  };
});

export const discoverCursorSkills = Effect.fn("discoverCursorSkills")(function* (
  cwd?: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return (yield* inspectCursorSkills(cwd, environment)).skills;
});

export const probeCursorSkills = Effect.fn("probeCursorSkills")(function* (
  cwd?: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const inspection = yield* inspectCursorSkills(cwd, environment);
  if (inspection.failureReason) {
    return yield* new CursorSkillsProbeError({
      reason: inspection.failureReason,
      ...(cwd ? { cwd } : {}),
    });
  }
  return inspection.skills;
});

/** Cursor invokes Agent Skills with `/name`; T3 composers insert `$name`. */
export function hasCursorSkillMention(prompt: string): boolean {
  return HAS_SKILL_MENTION_PATTERN.test(prompt);
}

export function rewriteCursorSkillMentions(
  prompt: string,
  skillNames: ReadonlySet<string>,
): string {
  return prompt.replace(SKILL_MENTION_PATTERN, (match, prefix: string, name: string) =>
    skillNames.has(name) ? `${prefix}/${name}` : match,
  );
}

/** A composer pick is `$name`. Cursor runs that skill only when the prompt is `/name` alone. */
export function cursorSkillInvocation(
  prompt: string,
  skillNames: ReadonlySet<string>,
): string | undefined {
  const trimmed = rewriteCursorSkillMentions(prompt, skillNames).trim();
  return /^\/[^\s/]+$/.test(trimmed) ? trimmed : undefined;
}
