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
 * Installed plugin roots come from `CursorInstalledPlugins`. Each root's
 * `mcp.json` holds the launch config, and Cursor names each server
 * `plugin-<plugin.json name>-<server key>`, the key it uses in the project's
 * `mcp-auth.json` OAuth store.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  cursorDataDir,
  cursorHome,
  cursorInstalledPluginRoots,
  makeCursorPluginScanBudget,
} from "./CursorInstalledPlugins.ts";

const PLUGIN_ROOT_VARS = ["CURSOR_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"] as const;
const PLUGIN_MANIFEST_DIRS = [".cursor-plugin", ".claude-plugin", ".codex-plugin"] as const;
const TEMPLATE_PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g;
const PLUGIN_AUTH_PROBE_TIMEOUT_MS = 5_000;

export type CursorPluginMcpFetch = typeof globalThis.fetch;
type HttpCursorPluginMcpServer = Extract<
  EffectAcpSchema.McpServer,
  { readonly type: "http" | "sse" }
>;

interface ConvertedPluginMcpServer {
  readonly server: EffectAcpSchema.McpServer;
  readonly usesStoredAccessToken: boolean;
}

interface ResolvedHttpHeaders {
  readonly headers: ReadonlyArray<{ name: string; value: string }>;
  readonly usesStoredAccessToken: boolean;
}

export interface CursorPluginMcpDiscoveryOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly homedir?: string;
  readonly fetch?: CursorPluginMcpFetch;
}

export interface CursorPluginMcpAuthRequirement {
  readonly identifier: string;
  readonly displayName: string;
}

export interface CursorPluginMcpDiscovery {
  readonly servers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly authRequired: ReadonlyArray<CursorPluginMcpAuthRequirement>;
}

export function cursorWorkspaceSlug(cwd: string): string {
  return cwd
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const discoverCursorPluginMcpServers = Effect.fn("discoverCursorPluginMcpServers")(
  function* (
    cwd: string,
    options?: CursorPluginMcpDiscoveryOptions,
  ): Effect.fn.Return<CursorPluginMcpDiscovery, never, FileSystem.FileSystem | Path.Path> {
    const env = options?.env ?? process.env;
    const userHome = options?.homedir ?? cursorHome(env);
    const pluginRoots = yield* cursorInstalledPluginRoots(
      userHome,
      env,
      makeCursorPluginScanBudget(),
      cwd,
    );
    if (pluginRoots.length === 0) return { servers: [], authRequired: [] };
    const accessTokens = readPluginAccessTokens(
      NodePath.join(
        cursorDataDir(env, userHome),
        "projects",
        cursorWorkspaceSlug(cwd),
        "mcp-auth.json",
      ),
    );
    const fetchFn = options?.fetch;
    return yield* Effect.promise(() =>
      readPluginMcpServers(pluginRoots, accessTokens, env, fetchFn),
    );
  },
);

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

function readPluginManifest(pluginRoot: string): Record<string, unknown> | undefined {
  for (const directory of PLUGIN_MANIFEST_DIRS) {
    const manifest = readJsonObject(NodePath.join(pluginRoot, directory, "plugin.json"));
    if (manifest) return manifest;
  }
  return undefined;
}

async function readPluginMcpServers(
  pluginRoots: ReadonlyArray<string>,
  accessTokens: ReadonlyMap<string, string>,
  env: NodeJS.ProcessEnv,
  fetchFn: CursorPluginMcpFetch | undefined,
): Promise<CursorPluginMcpDiscovery> {
  const servers: EffectAcpSchema.McpServer[] = [];
  const authChecks: Array<Promise<CursorPluginMcpAuthRequirement | undefined>> = [];
  const taken = new Set<string>();
  for (const pluginRoot of pluginRoots) {
    const mcpServers = readJsonObject(NodePath.join(pluginRoot, "mcp.json"))?.mcpServers;
    if (!isRecord(mcpServers)) continue;
    const manifest = readPluginManifest(pluginRoot);
    const pluginName = stringField(manifest, "name") ?? NodePath.basename(pluginRoot);
    for (const [serverKey, rawConfig] of Object.entries(mcpServers)) {
      const identifier = `plugin-${pluginName}-${serverKey}`;
      if (taken.has(identifier)) continue;
      const converted = toAcpMcpServer(
        identifier,
        rawConfig,
        pluginRoot,
        accessTokens.get(identifier),
        env,
      );
      if (!converted) continue;
      taken.add(identifier);
      servers.push(converted.server);
      const server = converted.server;
      if (
        fetchFn !== undefined &&
        isHttpCursorPluginMcpServer(server) &&
        (converted.usesStoredAccessToken || !server.headers.some(hasUsableAuthorization))
      ) {
        authChecks.push(
          isAuthRejected(server, fetchFn).then((rejected) =>
            rejected ? { identifier, displayName: pluginName } : undefined,
          ),
        );
      }
    }
  }
  const authRequired = (await Promise.all(authChecks)).filter(
    (requirement): requirement is CursorPluginMcpAuthRequirement => requirement !== undefined,
  );
  authRequired.sort((left, right) => left.identifier.localeCompare(right.identifier));
  return { servers, authRequired };
}

function isHttpCursorPluginMcpServer(
  server: EffectAcpSchema.McpServer,
): server is HttpCursorPluginMcpServer {
  return "type" in server && (server.type === "http" || server.type === "sse");
}

async function isAuthRejected(
  server: HttpCursorPluginMcpServer,
  fetchFn: CursorPluginMcpFetch,
): Promise<boolean> {
  const headers: Array<[string, string]> = server.headers.map((header): [string, string] => [
    header.name,
    header.value,
  ]);
  const hasHeader = (name: string) =>
    headers.some(([headerName]) => headerName.toLowerCase() === name);
  if (!hasHeader("accept")) {
    headers.push([
      "Accept",
      server.type === "sse" ? "text/event-stream" : "application/json, text/event-stream",
    ]);
  }
  if (server.type === "http" && !hasHeader("content-type")) {
    headers.push(["Content-Type", "application/json"]);
  }
  const request: RequestInit =
    server.type === "sse"
      ? { method: "GET" }
      : {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "kata-code-auth-probe", version: "0.0.0" },
            },
          }),
        };
  let response: Response | undefined;
  try {
    response = await fetchFn(server.url, {
      ...request,
      redirect: "manual",
      headers,
      signal: AbortSignal.timeout(PLUGIN_AUTH_PROBE_TIMEOUT_MS),
    });
    return response.status === 401 || response.status === 403;
  } catch {
    return false;
  } finally {
    try {
      await response?.body?.cancel();
    } catch {
      // Closing an optional probe response is best effort.
    }
  }
}

function toAcpMcpServer(
  name: string,
  rawConfig: unknown,
  pluginRoot: string,
  accessToken: string | undefined,
  env: NodeJS.ProcessEnv,
): ConvertedPluginMcpServer | undefined {
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
    const resolvedHeaders = httpHeaders(rawConfig.headers, pluginRoot, accessToken, env);
    return {
      server: {
        type: "http",
        name,
        url,
        headers: resolvedHeaders.headers,
      },
      usesStoredAccessToken: resolvedHeaders.usesStoredAccessToken,
    };
  }
  if (url && type === "sse") {
    const resolvedHeaders = httpHeaders(rawConfig.headers, pluginRoot, accessToken, env);
    return {
      server: {
        type: "sse",
        name,
        url,
        headers: resolvedHeaders.headers,
      },
      usesStoredAccessToken: resolvedHeaders.usesStoredAccessToken,
    };
  }
  if (command) {
    const resolvedCommand = command.startsWith(".")
      ? NodePath.resolve(pluginRoot, command)
      : command;
    return {
      server: {
        name,
        command: resolvedCommand,
        args: stringArray(rawConfig.args)
          .map((value) => resolveTemplate(value, pluginRoot, env))
          .filter((value): value is string => value !== undefined),
        env: objectToEntries(rawConfig.env, pluginRoot, env),
      },
      usesStoredAccessToken: false,
    };
  }
  return undefined;
}

function httpHeaders(
  rawHeaders: unknown,
  pluginRoot: string,
  accessToken: string | undefined,
  env: NodeJS.ProcessEnv,
): ResolvedHttpHeaders {
  const configured = objectToEntries(rawHeaders, pluginRoot, env);
  const usableConfigured = configured.filter(
    (header) => header.name.toLowerCase() !== "authorization" || hasUsableAuthorization(header),
  );
  if (accessToken === undefined || usableConfigured.some(hasUsableAuthorization)) {
    return { headers: usableConfigured, usesStoredAccessToken: false };
  }
  return {
    headers: [...usableConfigured, { name: "Authorization", value: `Bearer ${accessToken}` }],
    usesStoredAccessToken: true,
  };
}

function hasUsableAuthorization(header: { name: string; value: string }): boolean {
  return header.name.toLowerCase() === "authorization" && /^\S+\s+\S/.test(header.value.trim());
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
