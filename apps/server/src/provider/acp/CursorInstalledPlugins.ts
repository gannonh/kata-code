// @effect-diagnostics nodeBuiltinImport:off
/**
 * CursorInstalledPlugins — which Cursor plugins are enabled for a workspace.
 *
 * Cursor records installs per window in `state.vscdb`
 * (`cursor.plugins.installedIds*`) and maps ids to cache folders through
 * `plugins/cache/.cloud-plugin-manifest.json`. Local plugins come from
 * `enabled_plugins` in `~/.cursor/settings.json`. Skill discovery and plugin
 * MCP discovery both resolve plugin roots here. The per-project `mcps/`
 * folder is a tool-schema cache that Cursor rewrites, so it is not an install
 * record.
 *
 * @module provider/acp/CursorInstalledPlugins
 */
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeURL from "node:url";

import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

const MAX_PLUGIN_SCAN_ENTRIES = 10_000;
const MAX_PLUGIN_SCAN_BYTES = ByteSize.bytes(8_000_000);

export interface CursorPluginScanBudget {
  remainingEntries: number;
  remainingBytes: bigint;
  exhausted: boolean;
  incomplete: boolean;
}

export function makeCursorPluginScanBudget(): CursorPluginScanBudget {
  return {
    remainingEntries: MAX_PLUGIN_SCAN_ENTRIES,
    remainingBytes: MAX_PLUGIN_SCAN_BYTES,
    exhausted: false,
    incomplete: false,
  };
}

export function cursorHome(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || env.USERPROFILE?.trim() || NodeOS.homedir();
}

export function cursorDataDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir = cursorHome(env),
): string {
  const override = env.CURSOR_DATA_DIR?.trim();
  if (override) return override;
  return NodePath.join(homedir, ".cursor");
}

export const orUndefined = <A, R>(
  effect: Effect.Effect<A, PlatformError.PlatformError, R>,
  budget?: CursorPluginScanBudget,
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

function fileUriToPath(uri: string, path: Path.Path): string | undefined {
  if (!uri.startsWith("file:")) return undefined;
  try {
    return path.normalize(NodeURL.fileURLToPath(uri));
  } catch {
    return undefined;
  }
}

function pathContains(root: string, cwd: string, path: Path.Path): boolean {
  const relative = path.relative(root, cwd);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
  path: Path.Path,
  cwd?: string,
): ReadonlySet<string> {
  const scopedRows = rows.filter((row) => installedPluginKeySuffix(row.key) !== undefined);
  const normalizedCwd = cwd?.trim() ? path.normalize(cwd) : undefined;
  if (normalizedCwd !== undefined) {
    const matches = scopedRows.flatMap((row) => {
      const folders = (installedPluginKeySuffix(row.key) ?? "").split(",").flatMap((part) => {
        const folder = fileUriToPath(part.trim(), path);
        return folder ? [folder] : [];
      });
      const matched = folders.filter((folder) => pathContains(folder, normalizedCwd, path));
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

  const noWorkspace = scopedRows.filter(
    (row) => installedPluginKeySuffix(row.key) === "no-workspace",
  );
  if (noWorkspace.length > 0) return unionPluginIds(noWorkspace);
  return new Set();
}

const decodeUnknownJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export const readJsonObject = Effect.fn("readCursorPluginJson")(function* (
  filePath: string,
  budget: CursorPluginScanBudget,
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

function readInstalledPluginIdsSync(
  dbPath: string,
  cwd: string | undefined,
  path: Path.Path,
): InstalledPluginIds {
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
      return { _tag: "Ready", ids: selectInstalledPluginIds(parsed, path, cwd) };
    } finally {
      database.close();
    }
  } catch {
    return { _tag: "Unreadable" };
  }
}

const readCloudPlugins = Effect.fn("readCloudPlugins")(function* (
  manifestPath: string,
  budget: CursorPluginScanBudget,
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
  budget: CursorPluginScanBudget,
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

function expandHome(value: string, userHome: string): string {
  if (value === "~") return userHome;
  if (value.startsWith("~/") || value.startsWith("~\\")) return `${userHome}${value.slice(1)}`;
  return value;
}

const localPluginRoots = Effect.fn("localPluginRoots")(function* (
  settingsPath: string,
  userHome: string,
  budget: CursorPluginScanBudget,
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

/**
 * `listed`: `enabled_plugins` or the workspace install record names the plugin.
 * `inferred`: the manifest stands in for a missing install record, or a cache
 * version is adopted for an installed id that nothing maps to a plugin.
 */
export type CursorPluginEvidence = "listed" | "inferred";

export interface CursorPluginRoot {
  readonly root: string;
  readonly evidence: CursorPluginEvidence;
}

/** Plugin roots enabled for `cwd`, local plugins first, deduplicated. */
export const cursorInstalledPluginRoots = Effect.fn("cursorInstalledPluginRoots")(function* (
  userHome: string,
  environment: NodeJS.ProcessEnv,
  budget: CursorPluginScanBudget,
  cwd?: string,
): Effect.fn.Return<ReadonlyArray<CursorPluginRoot>, never, FileSystem.FileSystem | Path.Path> {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dataDir = cursorDataDir(environment, userHome);
  const cacheDir = path.join(dataDir, "plugins", "cache");
  const roots: CursorPluginRoot[] = [];
  const addPlugin = (root: string, evidence: CursorPluginEvidence) => {
    if (!roots.some((entry) => entry.root === root)) roots.push({ root, evidence });
  };

  for (const pluginRoot of yield* localPluginRoots(
    path.join(dataDir, "settings.json"),
    userHome,
    budget,
  )) {
    const info = yield* orUndefined(fileSystem.stat(pluginRoot), budget);
    if (info?.type !== "Directory") continue;
    addPlugin(pluginRoot, "listed");
  }

  const stateDb = yield* cursorGlobalStateDb(userHome, environment);
  const installed = stateDb
    ? readInstalledPluginIdsSync(stateDb, cwd, path)
    : ({ _tag: "Missing" } as const);
  if (installed._tag === "Unreadable") return roots;

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
      addPlugin(candidate, installed._tag === "Ready" ? "listed" : "inferred");
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
      addPlugin(newest.directory, "listed");
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
      for (const directory of adoptions) addPlugin(directory, "inferred");
    }
  }

  return roots;
});
