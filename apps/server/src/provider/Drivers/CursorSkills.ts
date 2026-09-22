/**
 * CursorSkills — workspace-aware discovery and native invocation for Cursor.
 *
 * Cursor discovers Agent Skills recursively from user and project roots but
 * its ACP command catalog only appears after opening a real session. Scanning
 * the same roots avoids starting an agent and its MCP servers just to populate
 * a composer menu. Installed plugin skills live under the plugin cache, so
 * those roots are added from the enabled install rather than a full plugin walk.
 *
 * @module provider/Drivers/CursorSkills
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

import type { ServerProviderSkill } from "@kata-sh/code-contracts";
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import { parse as parseYamlDocument } from "yaml";

import { cursorDataDir } from "../acp/CursorPluginMcp.ts";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const SKILL_MENTION_PATTERN =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)(?=\s|$)/gu;
const HAS_SKILL_MENTION_PATTERN = new RegExp(SKILL_MENTION_PATTERN.source, "u");
const MAX_SKILL_DEPTH = 10;
const MAX_SKILL_BYTES = ByteSize.bytes(1_000_000);
const MAX_SKILL_SCAN_ENTRIES = 10_000;
const MAX_SKILL_SCAN_BYTES = ByteSize.bytes(8_000_000);

interface CursorSkillFrontmatter {
  readonly description?: string;
  readonly displayName?: string;
  readonly userInvocationOnly?: boolean;
  readonly userInvocable?: boolean;
  readonly cliVisible: boolean;
}

interface CursorSkillScanBudget {
  remainingEntries: number;
  remainingBytes: bigint;
  exhausted: boolean;
  incomplete: boolean;
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

const orUndefined = <A, R>(
  effect: Effect.Effect<A, PlatformError.PlatformError, R>,
  budget?: CursorSkillScanBudget,
): Effect.Effect<A | undefined, never, R> =>
  effect.pipe(
    Effect.map((value): A | undefined => value),
    Effect.catchTags({
      PlatformError: (error) => {
        if (error.reason._tag !== "NotFound" && budget) budget.incomplete = true;
        return Effect.void.pipe(Effect.as(undefined));
      },
    }),
  );

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
  readonly budget: CursorSkillScanBudget;
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

interface CloudPluginRecord {
  readonly pluginId: string;
  readonly name: string;
  readonly marketplaceSlug: string;
  readonly resolvedCommitSha: string;
}

type InstalledPluginIds =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "Ready"; readonly ids: ReadonlySet<string> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pluginIdString(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function pluginIdFromInstalledEntry(value: unknown): string | undefined {
  const direct = pluginIdString(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  return pluginIdString(value.id);
}

interface InstalledPluginIdRow {
  readonly key: string;
  readonly ids: ReadonlySet<string>;
}

function installedPluginKeySuffix(key: string): string | undefined {
  const pipe = key.indexOf("|");
  if (pipe === -1) return undefined;
  return key.slice(pipe + 1);
}

function fileUriToPath(uri: string): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    return NodePath.normalize(NodeURL.fileURLToPath(uri));
  } catch {
    return undefined;
  }
}

function pathContains(root: string, cwd: string): boolean {
  const relative = NodePath.relative(root, cwd);
  return relative === "" || (!relative.startsWith("..") && !NodePath.isAbsolute(relative));
}

function unionPluginIds(rows: ReadonlyArray<InstalledPluginIdRow>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    for (const id of row.ids) ids.add(id);
  }
  return ids;
}

function selectInstalledPluginIds(
  rows: ReadonlyArray<InstalledPluginIdRow>,
  cwd?: string,
): ReadonlySet<string> {
  // A key with no window suffix is the whole installed set. Tests and older
  // Cursor builds write that shape. Per-window rows must not be unioned: a
  // stale window still names the previous plugin id.
  const unsuffixed = rows.filter((row) => installedPluginKeySuffix(row.key) === undefined);
  if (unsuffixed.length > 0) return unionPluginIds(unsuffixed);

  const normalizedCwd = cwd?.trim() ? NodePath.normalize(cwd) : undefined;
  if (normalizedCwd !== undefined) {
    const matches = rows.flatMap((row) => {
      const folders = (installedPluginKeySuffix(row.key) ?? "").split(",").flatMap((part) => {
        const folder = fileUriToPath(part.trim());
        return folder ? [folder] : [];
      });
      const matched = folders.filter((folder) => pathContains(folder, normalizedCwd));
      if (matched.length === 0) return [];
      return [
        {
          row,
          matchLength: Math.max(...matched.map((folder) => folder.length)),
          folderCount: folders.length,
        },
      ];
    });
    matches.sort(
      (left, right) =>
        right.matchLength - left.matchLength ||
        left.folderCount - right.folderCount ||
        left.row.key.localeCompare(right.row.key),
    );
    const best = matches[0];
    if (best) return best.row.ids;
  }

  const noWorkspace = rows.filter((row) => installedPluginKeySuffix(row.key) === "no-workspace");
  if (noWorkspace.length > 0) return unionPluginIds(noWorkspace);
  return new Set();
}

function staysInside(parent: string, child: string, separator: string): boolean {
  return child === parent || child.startsWith(`${parent}${separator}`);
}

const decodeUnknownJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const readJsonObject = Effect.fn("readCursorPluginJson")(function* (
  filePath: string,
  budget: CursorSkillScanBudget,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const contents = yield* orUndefined(fileSystem.readFileString(filePath), budget);
  if (contents === undefined) return undefined;
  const parsed = decodeUnknownJson(contents);
  if (Option.isNone(parsed) || !isRecord(parsed.value)) return undefined;
  return parsed.value;
});

const cursorGlobalStateDb = Effect.fn("cursorGlobalStateDb")(function* (
  userHome: string,
  environment: NodeJS.ProcessEnv,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const appData = environment.APPDATA?.trim() || path.join(userHome, "AppData", "Roaming");
  const linuxConfigHome = environment.XDG_CONFIG_HOME?.trim() || path.join(userHome, ".config");
  const candidates = [
    environment.CURSOR_GLOBAL_STATE_DB?.trim(),
    path.join(linuxConfigHome, "Cursor", "User", "globalStorage", "state.vscdb"),
    path.join(
      userHome,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    ),
    path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const info = yield* orUndefined(fileSystem.stat(candidate));
    if (info?.type === "File") return candidate;
  }
  return undefined;
});

function sqliteText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return undefined;
}

function readInstalledPluginIdsSync(dbPath: string, cwd?: string): InstalledPluginIds {
  try {
    const database = new NodeSqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = database
        .prepare("SELECT key, value FROM ItemTable WHERE key GLOB 'cursor.plugins.installedIds*'")
        .all() as ReadonlyArray<{ key?: unknown; value?: unknown }>;
      const parsed: InstalledPluginIdRow[] = [];
      for (const row of rows) {
        const key = sqliteText(row.key)?.trim();
        const text = sqliteText(row.value);
        if (!key || !text) continue;
        const decoded = decodeUnknownJson(text);
        if (Option.isNone(decoded) || !Array.isArray(decoded.value)) continue;
        const ids = new Set<string>();
        for (const entry of decoded.value) {
          const normalized = pluginIdFromInstalledEntry(entry);
          if (normalized) ids.add(normalized);
        }
        parsed.push({ key, ids });
      }
      return { _tag: "Ready", ids: selectInstalledPluginIds(parsed, cwd) };
    } finally {
      database.close();
    }
  } catch {
    return { _tag: "Unreadable" };
  }
}

const readCloudPlugins = Effect.fn("readCloudPlugins")(function* (
  manifestPath: string,
  budget: CursorSkillScanBudget,
) {
  const manifest = yield* readJsonObject(manifestPath, budget);
  const plugins = manifest?.plugins;
  if (!Array.isArray(plugins)) return [];
  const records: CloudPluginRecord[] = [];
  for (const plugin of plugins) {
    if (!isRecord(plugin)) continue;
    const pluginId = pluginIdString(plugin.pluginId);
    const name = typeof plugin.name === "string" ? plugin.name.trim() : "";
    const marketplaceSlug =
      typeof plugin.marketplaceSlug === "string" ? plugin.marketplaceSlug.trim() : "";
    const resolvedCommitSha =
      typeof plugin.resolvedCommitSha === "string" ? plugin.resolvedCommitSha.trim() : "";
    if (!pluginId || !name || !marketplaceSlug || !resolvedCommitSha) continue;
    records.push({ pluginId, name, marketplaceSlug, resolvedCommitSha });
  }
  return records;
});

const cacheCompleteVersions = Effect.fn("cacheCompleteVersions")(function* (
  pluginDir: string,
  budget: CursorSkillScanBudget,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* orUndefined(fileSystem.readDirectory(pluginDir), budget);
  if (!entries) return [];
  const found: Array<{ directory: string; mtimeMs: number }> = [];
  for (const entry of [...entries].sort()) {
    if (budget.exhausted) return found;
    if (entry.startsWith("ew-disabled-") || entry.endsWith(".installed")) continue;
    if (budget.remainingEntries === 0) {
      budget.exhausted = true;
      return found;
    }
    budget.remainingEntries -= 1;
    const directory = path.join(pluginDir, entry);
    const info = yield* orUndefined(fileSystem.stat(directory), budget);
    if (info?.type !== "Directory") continue;
    const marker = yield* orUndefined(
      fileSystem.stat(path.join(directory, ".cache-complete")),
      budget,
    );
    if (marker?.type !== "File") continue;
    found.push({
      directory,
      mtimeMs: Option.match(marker.mtime, {
        onNone: () => 0,
        onSome: (date) => date.getTime(),
      }),
    });
  }
  found.sort(
    (left, right) => right.mtimeMs - left.mtimeMs || left.directory.localeCompare(right.directory),
  );
  return found;
});

const pluginSkillDirectories = Effect.fn("pluginSkillDirectories")(function* (
  pluginRoot: string,
  budget: CursorSkillScanBudget,
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

function expandHome(value: string, userHome: string): string {
  if (value === "~") return userHome;
  if (value.startsWith("~/") || value.startsWith("~\\")) return `${userHome}${value.slice(1)}`;
  return value;
}

const localPluginRoots = Effect.fn("localPluginRoots")(function* (
  settingsPath: string,
  userHome: string,
  budget: CursorSkillScanBudget,
) {
  const path = yield* Path.Path;
  const settings = yield* readJsonObject(settingsPath, budget);
  const enabled = settings?.enabled_plugins;
  if (!isRecord(enabled)) return [];
  const roots: string[] = [];
  for (const value of Object.values(enabled)) {
    const configured =
      typeof value === "string"
        ? value
        : isRecord(value) && value.enabled !== false && typeof value.path === "string"
          ? value.path
          : undefined;
    if (!configured?.trim()) continue;
    const expanded = expandHome(configured.trim(), userHome);
    roots.push(
      path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(settingsPath), expanded),
    );
  }
  return roots;
});

const cursorPluginSkillDirectories = Effect.fn("cursorPluginSkillDirectories")(function* (
  userHome: string,
  environment: NodeJS.ProcessEnv,
  budget: CursorSkillScanBudget,
  cwd?: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dataDir = cursorDataDir(environment, userHome);
  const cacheDir = path.join(dataDir, "plugins", "cache");
  const directories: string[] = [];
  const seen = new Set<string>();
  const addPlugin = function* (pluginRoot: string) {
    if (seen.has(pluginRoot)) return;
    seen.add(pluginRoot);
    for (const directory of yield* pluginSkillDirectories(pluginRoot, budget)) {
      directories.push(directory);
    }
  };

  for (const pluginRoot of yield* localPluginRoots(
    path.join(dataDir, "settings.json"),
    userHome,
    budget,
  )) {
    const info = yield* orUndefined(fileSystem.stat(pluginRoot), budget);
    if (info?.type !== "Directory") continue;
    yield* addPlugin(pluginRoot);
  }

  const stateDb = yield* cursorGlobalStateDb(userHome, environment);
  const installed = stateDb
    ? readInstalledPluginIdsSync(stateDb, cwd)
    : ({ _tag: "Missing" } as const);
  if (installed._tag === "Unreadable") return directories;

  const manifest = yield* readCloudPlugins(
    path.join(cacheDir, ".cloud-plugin-manifest.json"),
    budget,
  );
  const enabled = (pluginId: string) => installed._tag === "Missing" || installed.ids.has(pluginId);
  const resolvedIds = new Set<string>();
  const hasCompleteCache = function* (directory: string) {
    const marker = yield* orUndefined(
      fileSystem.stat(path.join(directory, ".cache-complete")),
      budget,
    );
    return marker?.type === "File";
  };

  for (const plugin of manifest) {
    if (!enabled(plugin.pluginId)) continue;
    const candidates = [plugin.pluginId, plugin.name].map((key) =>
      path.join(cacheDir, plugin.marketplaceSlug, key, plugin.resolvedCommitSha),
    );
    for (const candidate of candidates) {
      if (!(yield* hasCompleteCache(candidate))) continue;
      yield* addPlugin(candidate);
      resolvedIds.add(plugin.pluginId);
      break;
    }
  }

  if (installed._tag === "Ready") {
    const marketplaces = yield* orUndefined(fileSystem.readDirectory(cacheDir), budget);
    for (const pluginId of installed.ids) {
      if (resolvedIds.has(pluginId) || budget.exhausted || !marketplaces) continue;
      let newest: { directory: string; mtimeMs: number } | undefined;
      for (const marketplace of marketplaces) {
        if (marketplace.startsWith(".") || marketplace.startsWith("ew-disabled-")) continue;
        const marketplaceDir = path.join(cacheDir, marketplace);
        const marketplaceInfo = yield* orUndefined(fileSystem.stat(marketplaceDir), budget);
        if (marketplaceInfo?.type !== "Directory") continue;
        const versions = yield* cacheCompleteVersions(path.join(marketplaceDir, pluginId), budget);
        const candidate = versions[0];
        if (!candidate) continue;
        if (!newest || candidate.mtimeMs > newest.mtimeMs) newest = candidate;
      }
      if (!newest) continue;
      yield* addPlugin(newest.directory);
      resolvedIds.add(pluginId);
    }

    const unresolved = [...installed.ids].filter((pluginId) => !resolvedIds.has(pluginId));
    const adoptions: string[] = [];
    for (const plugin of manifest) {
      if (enabled(plugin.pluginId)) continue;
      const versions = yield* cacheCompleteVersions(
        path.join(cacheDir, plugin.marketplaceSlug, plugin.name),
        budget,
      );
      const newer = versions.find(
        (version) => path.basename(version.directory) !== plugin.resolvedCommitSha,
      );
      if (newer) adoptions.push(newer.directory);
    }
    // ponytail: a disabled manifest row stands in for an installed id with no
    // cache folder only when the counts match. Several unknown ids are
    // ambiguous, so adopt none until the manifest names each id.
    if (unresolved.length > 0 && adoptions.length === unresolved.length) {
      for (const directory of adoptions) yield* addPlugin(directory);
    }
  }

  return directories;
});

const inspectCursorSkills = Effect.fn("inspectCursorSkills")(function* (
  cwd?: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const path = yield* Path.Path;
  const userHome = environment.HOME?.trim() || environment.USERPROFILE?.trim() || NodeOS.homedir();
  const rootsBelow = (base: string, scope: "user" | "project") => [
    { directory: path.join(base, ".cursor", "skills"), scope },
    { directory: path.join(base, ".agents", "skills"), scope },
    { directory: path.join(base, ".codex", "skills"), scope },
    { directory: path.join(base, ".claude", "skills"), scope },
  ];
  const skillsByName = new Map<string, ServerProviderSkill>();
  const budget: CursorSkillScanBudget = {
    remainingEntries: MAX_SKILL_SCAN_ENTRIES,
    remainingBytes: MAX_SKILL_SCAN_BYTES,
    exhausted: false,
    incomplete: false,
  };
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
