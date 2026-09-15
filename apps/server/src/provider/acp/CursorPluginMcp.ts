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
const UNRESOLVED_PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/;

export function cursorWorkspaceSlug(cwd: string): string {
  return cwd
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function cursorDataDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir = NodeOS.homedir(),
): string {
  const override = env.CURSOR_DATA_DIR?.trim();
  if (override) return override;
  return NodePath.join(homedir, ".cursor");
}

export function discoverCursorPluginMcpServers(
  cwd: string,
  options?: { readonly env?: NodeJS.ProcessEnv; readonly homedir?: string },
): ReadonlyArray<EffectAcpSchema.McpServer> {
  const env = options?.env ?? process.env;
  const dataDir = cursorDataDir(env, options?.homedir ?? NodeOS.homedir());
  const installed = readInstalledPluginIdentifiers(
    NodePath.join(dataDir, "projects", cursorWorkspaceSlug(cwd), "mcps"),
  );
  if (installed.size === 0) return [];
  return readPluginCacheMcpServers(NodePath.join(dataDir, "plugins", "cache"), installed);
}

function readInstalledPluginIdentifiers(mcpsDir: string): Set<string> {
  const identifiers = new Set<string>();
  let entries: NodeFS.Dirent[];
  try {
    entries = NodeFS.readdirSync(mcpsDir, { withFileTypes: true });
  } catch {
    return identifiers;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = NodePath.join(mcpsDir, entry.name, "SERVER_METADATA.json");
    const metadata = readJsonObject(metadataPath);
    const identifier =
      stringField(metadata, "serverIdentifier") ?? stringField(metadata, "serverName");
    if (identifier) identifiers.add(identifier);
  }
  return identifiers;
}

function readPluginCacheMcpServers(
  cacheDir: string,
  installed: ReadonlySet<string>,
): ReadonlyArray<EffectAcpSchema.McpServer> {
  const servers: EffectAcpSchema.McpServer[] = [];
  const taken = new Set<string>();
  let marketplaces: NodeFS.Dirent[];
  try {
    marketplaces = NodeFS.readdirSync(cacheDir, { withFileTypes: true });
  } catch {
    return servers;
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
        if (!installed.has(identifier) || taken.has(identifier)) continue;
        const converted = toAcpMcpServer(identifier, rawConfig, pluginRoot);
        if (!converted) continue;
        taken.add(identifier);
        servers.push(converted);
      }
    }
  }
  return servers;
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
): EffectAcpSchema.McpServer | undefined {
  if (!isRecord(rawConfig)) return undefined;
  const type = stringField(rawConfig, "type")?.toLowerCase();
  const url = expandPluginRoot(stringField(rawConfig, "url"), pluginRoot);
  const command = expandPluginRoot(stringField(rawConfig, "command"), pluginRoot);
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
      headers: objectToHeaders(rawConfig.headers),
    };
  }
  if (url && type === "sse") {
    return {
      type: "sse",
      name,
      url,
      headers: objectToHeaders(rawConfig.headers),
    };
  }
  if (command) {
    const resolvedCommand = command.startsWith(".")
      ? NodePath.resolve(pluginRoot, command)
      : command;
    return {
      name,
      command: resolvedCommand,
      args: stringArray(rawConfig.args).map(
        (value) => expandPluginRoot(value, pluginRoot) ?? value,
      ),
      env: objectToEnv(rawConfig.env),
    };
  }
  return undefined;
}

function objectToHeaders(value: unknown): ReadonlyArray<{ name: string; value: string }> {
  if (!isRecord(value)) return [];
  const headers: Array<{ name: string; value: string }> = [];
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "string" || hasUnresolvedPlaceholder(raw)) continue;
    headers.push({ name, value: raw });
  }
  return headers;
}

function objectToEnv(value: unknown): ReadonlyArray<{ name: string; value: string }> {
  if (!isRecord(value)) return [];
  const env: Array<{ name: string; value: string }> = [];
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw !== "string" || hasUnresolvedPlaceholder(raw)) continue;
    env.push({ name, value: raw });
  }
  return env;
}

function expandPluginRoot(value: string | undefined, pluginRoot: string): string | undefined {
  if (value === undefined) return undefined;
  let expanded = value;
  for (const name of PLUGIN_ROOT_VARS) {
    expanded = expanded.replaceAll(`\${${name}}`, pluginRoot);
  }
  return expanded;
}

function hasUnresolvedPlaceholder(value: string): boolean {
  const match = UNRESOLVED_PLACEHOLDER.exec(value);
  if (!match) return false;
  const name = match[1];
  return name !== undefined && !(PLUGIN_ROOT_VARS as readonly string[]).includes(name);
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
