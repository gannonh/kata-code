// @effect-diagnostics nodeBuiltinImport:off
/**
 * Cursor marketplace plugin MCP → ACP `mcpServers` entries.
 *
 * `agent acp` (cursor-agent 2026.09.10) loads project/user `.cursor/mcp.json`
 * into the session lease. Marketplace plugins are a separate loader used by
 * interactive CLI (`getPluginMcpServers`) and are not wired into ACP.
 * `--plugin-dir` is ignored by the `acp` command. Session `mcpServers` are
 * merged into that lease by name, so Kata Code must pass plugin launch
 * configs alongside t3-code.
 *
 * Launch config comes from the plugin cache `mcp.json` (stdio/http/url), not
 * from project MCP tool schema JSON files. Project `SERVER_METADATA.json` only
 * names which plugins are installed for `cwd`.
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type * as EffectAcpSchema from "effect-acp/schema";

const PLUGIN_ROOT_VARS = ["CURSOR_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"] as const;
const TEMPLATE_PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g;

export interface CursorPluginMcpDiscovery {
  readonly servers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly authRequired: ReadonlyArray<{
    readonly identifier: string;
    readonly displayName: string;
  }>;
}

interface InstalledPlugin {
  readonly displayName: string;
  readonly hasMcpAuthTool: boolean;
}

export function cursorWorkspaceSlug(cwd: string): string {
  return cwd
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cursorDataDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir = homeFromEnv(env),
): string {
  const override = env.CURSOR_DATA_DIR?.trim();
  if (override) return override;
  return NodePath.join(homedir, ".cursor");
}

function homeFromEnv(env: NodeJS.ProcessEnv): string {
  return env.HOME?.trim() || env.USERPROFILE?.trim() || NodeOS.homedir();
}

export function discoverCursorPluginMcpServers(
  cwd: string,
  options?: { readonly env?: NodeJS.ProcessEnv; readonly homedir?: string },
): CursorPluginMcpDiscovery {
  const env = options?.env ?? process.env;
  const dataDir = cursorDataDir(env, options?.homedir);
  const projectDir = NodePath.join(dataDir, "projects", cursorWorkspaceSlug(cwd));
  const installed = readInstalledPlugins(NodePath.join(projectDir, "mcps"));
  if (installed.size === 0) return { servers: [], authRequired: [] };
  const accessTokens = readPluginAccessTokens(NodePath.join(projectDir, "mcp-auth.json"));
  return readPluginCacheMcpServers(
    NodePath.join(dataDir, "plugins", "cache"),
    installed,
    accessTokens,
    env,
  );
}

function readPluginAccessTokens(filePath: string): ReadonlyMap<string, string> {
  const tokens = new Map<string, string>();
  const records = readJsonObject(filePath);
  if (!records) return tokens;
  for (const [identifier, rawRecord] of Object.entries(records)) {
    if (!isRecord(rawRecord) || !isRecord(rawRecord.tokens)) continue;
    const accessToken = stringField(rawRecord.tokens, "access_token");
    if (accessToken) tokens.set(identifier, accessToken);
  }
  return tokens;
}

function readInstalledPlugins(mcpsDir: string): ReadonlyMap<string, InstalledPlugin> {
  const installed = new Map<string, InstalledPlugin>();
  let entries: NodeFS.Dirent[];
  try {
    entries = NodeFS.readdirSync(mcpsDir, { withFileTypes: true });
  } catch {
    return installed;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = NodePath.join(mcpsDir, entry.name, "SERVER_METADATA.json");
    const metadata = readJsonObject(metadataPath);
    const identifier =
      stringField(metadata, "serverIdentifier") ?? stringField(metadata, "serverName");
    if (!identifier) continue;
    installed.set(identifier, {
      displayName: stringField(metadata, "serverName") ?? identifier,
      hasMcpAuthTool: isFile(NodePath.join(mcpsDir, entry.name, "tools", "mcp_auth.json")),
    });
  }
  return installed;
}

function readPluginCacheMcpServers(
  cacheDir: string,
  installed: ReadonlyMap<string, InstalledPlugin>,
  accessTokens: ReadonlyMap<string, string>,
  env: NodeJS.ProcessEnv,
): CursorPluginMcpDiscovery {
  const servers: EffectAcpSchema.McpServer[] = [];
  const authRequired: Array<{ identifier: string; displayName: string }> = [];
  const taken = new Set<string>();
  let marketplaces: NodeFS.Dirent[];
  try {
    marketplaces = NodeFS.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return { servers, authRequired };
  }
  for (const marketplace of marketplaces) {
    if (!marketplace.isDirectory()) continue;
    const marketplaceDir = NodePath.join(cacheDir, marketplace.name);
    let plugins: NodeFS.Dirent[];
    try {
      plugins = NodeFS.readdirSync(marketplaceDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const plugin of plugins) {
      if (!plugin.isDirectory() || plugin.name.startsWith("ew-disabled-")) continue;
      const mcpJsonPath = newestPluginMcpJson(NodePath.join(marketplaceDir, plugin.name));
      if (!mcpJsonPath) continue;
      const pluginRoot = NodePath.dirname(mcpJsonPath);
      const parsed = readJsonObject(mcpJsonPath);
      const mcpServers = parsed?.mcpServers;
      if (!isRecord(mcpServers)) continue;
      for (const [serverKey, rawConfig] of Object.entries(mcpServers)) {
        const identifier = `plugin-${plugin.name}-${serverKey}`;
        const installedPlugin = installed.get(identifier);
        if (!installedPlugin || taken.has(identifier)) continue;
        const converted = toAcpMcpServer(
          identifier,
          rawConfig,
          pluginRoot,
          accessTokens.get(identifier),
          env,
        );
        if (!converted) continue;
        taken.add(identifier);
        servers.push(converted);
        if (
          installedPlugin.hasMcpAuthTool &&
          "type" in converted &&
          (converted.type === "http" || converted.type === "sse") &&
          !converted.headers.some((header) => header.name.toLowerCase() === "authorization")
        ) {
          authRequired.push({ identifier, displayName: installedPlugin.displayName });
        }
      }
    }
  }
  authRequired.sort((left, right) => left.identifier.localeCompare(right.identifier));
  return { servers, authRequired };
}

function isFile(filePath: string): boolean {
  try {
    return NodeFS.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function newestPluginMcpJson(pluginDir: string): string | undefined {
  const direct = NodePath.join(pluginDir, "mcp.json");
  if (NodeFS.existsSync(direct) && NodeFS.statSync(direct).isFile()) return direct;
  let shas: NodeFS.Dirent[];
  try {
    shas = NodeFS.readdirSync(pluginDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const ranked = shas
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("ew-disabled-"))
    .map((entry) => {
      const dir = NodePath.join(pluginDir, entry.name);
      const mcpJson = NodePath.join(dir, "mcp.json");
      try {
        const stat = NodeFS.statSync(mcpJson);
        return stat.isFile() ? { mcpJson, mtimeMs: stat.mtimeMs } : undefined;
      } catch {
        return undefined;
      }
    })
    .filter((entry): entry is { mcpJson: string; mtimeMs: number } => entry !== undefined)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return ranked[0]?.mcpJson;
}

function toAcpMcpServer(
  name: string,
  rawConfig: unknown,
  pluginRoot: string,
  accessToken: string | undefined,
  env: NodeJS.ProcessEnv,
): EffectAcpSchema.McpServer | undefined {
  if (!isRecord(rawConfig)) return undefined;
  const type = stringField(rawConfig, "type")?.toLowerCase();
  const url = resolveTemplate(stringField(rawConfig, "url"), pluginRoot, env);
  const command = resolveTemplate(stringField(rawConfig, "command"), pluginRoot, env);
  if (
    url &&
    (type === undefined ||
      type === "http" ||
      type === "streamable-http" ||
      type === "streamablehttp")
  ) {
    return {
      type: "http",
      name,
      url,
      headers: httpHeaders(rawConfig.headers, pluginRoot, accessToken, env),
    };
  }
  if (url && type === "sse") {
    return {
      type: "sse",
      name,
      url,
      headers: httpHeaders(rawConfig.headers, pluginRoot, accessToken, env),
    };
  }
  if (command) {
    const resolvedCommand = command.startsWith(".")
      ? NodePath.resolve(pluginRoot, command)
      : command;
    return {
      name,
      command: resolvedCommand,
      args: stringArray(rawConfig.args)
        .map((value) => resolveTemplate(value, pluginRoot, env))
        .filter((value): value is string => value !== undefined),
      env: objectToEntries(rawConfig.env, pluginRoot, env),
    };
  }
  return undefined;
}

function httpHeaders(
  rawHeaders: unknown,
  pluginRoot: string,
  accessToken: string | undefined,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<{ name: string; value: string }> {
  const configured = objectToEntries(rawHeaders, pluginRoot, env);
  if (
    accessToken === undefined ||
    configured.some((header) => header.name.toLowerCase() === "authorization")
  ) {
    return configured;
  }
  return [...configured, { name: "Authorization", value: `Bearer ${accessToken}` }];
}

function objectToEntries(
  value: unknown,
  pluginRoot: string,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<{ name: string; value: string }> {
  if (!isRecord(value)) return [];
  const entries: Array<{ name: string; value: string }> = [];
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    const resolved = resolveTemplate(raw, pluginRoot, env);
    if (resolved === undefined) continue;
    entries.push({ name, value: resolved });
  }
  return entries;
}

function resolveTemplate(
  value: string | undefined,
  pluginRoot: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (value === undefined) return undefined;
  let unresolved = false;
  const resolved = value.replace(
    TEMPLATE_PLACEHOLDER,
    (_match, name: string, fallback: string | undefined) => {
      if ((PLUGIN_ROOT_VARS as readonly string[]).includes(name)) return pluginRoot;
      const fromEnv = env[name];
      if (fromEnv !== undefined) return fromEnv;
      if (fallback !== undefined) return fallback;
      unresolved = true;
      return "";
    },
  );
  return unresolved ? undefined : resolved;
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(NodeFS.readFileSync(filePath, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringField(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
