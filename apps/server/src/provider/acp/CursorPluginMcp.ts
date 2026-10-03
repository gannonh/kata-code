// @effect-diagnostics nodeBuiltinImport:off
/**
 * Cursor plugin MCP servers as inline `@cursor/sdk` `mcpServers` entries.
 *
 * The SDK builds a run that has send-level `mcpServers` from those servers
 * alone, without the plugin loader, so Kata forwards every installed plugin
 * server alongside T3's own. Each entry is keyed by the plugin identifier
 * Cursor uses, `plugin-<plugin.json name>-<server key>`. The SDK loads inline
 * servers ahead of its plugin loader and keeps the first client of each name,
 * so a forwarded server replaces the loader's copy instead of adding a second.
 *
 * Cursor keeps a plugin's OAuth login per folder, in
 * `<CURSOR_DATA_DIR or ~/.cursor>/projects/<slug>/mcp-auth.json` under that
 * identifier, and the SDK reads only the store of the agent's git top level.
 * Forwarded HTTP servers carry the login from the thread's folder, else from
 * the Kata project folder, so a worktree thread can use the logins the user
 * completed in the project folder.
 *
 * Installed plugin roots come from `CursorInstalledPlugins`; each root's
 * `mcp.json` holds the launch config.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { McpServerConfig } from "@cursor/sdk";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  cursorDataDir,
  cursorHome,
  cursorInstalledPluginRoots,
  makeCursorPluginScanBudget,
} from "./CursorInstalledPlugins.ts";
import { refreshCursorPluginAccessToken } from "./CursorPluginOAuth.ts";

const PLUGIN_ROOT_VARS = ["CURSOR_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"] as const;
const PLUGIN_MANIFEST_DIRS = [".cursor-plugin", ".claude-plugin", ".codex-plugin"] as const;
const TEMPLATE_PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g;
const PLUGIN_AUTH_PROBE_TIMEOUT_MS = 5_000;

export type CursorPluginMcpFetch = typeof globalThis.fetch;

/** The folder whose Cursor login a forwarded server carries. */
export type CursorPluginLoginFolder = "thread" | "project";

export interface CursorPluginMcpServer {
  readonly config: McpServerConfig;
  readonly loginFolder?: CursorPluginLoginFolder;
}

export interface CursorPluginMcpInput {
  /** The thread's folder, the agent's `cwd`. */
  readonly cwd: string;
  /** The Kata project folder, when the thread runs in one of its worktrees. */
  readonly projectRoot?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly fetch: CursorPluginMcpFetch;
}

interface StoredLogin {
  readonly folder: CursorPluginLoginFolder;
  readonly authFile: string;
  readonly accessToken: string;
}

type HttpServerConfig = Extract<McpServerConfig, { readonly url: string }>;

interface PluginServer {
  readonly identifier: string;
  readonly config: McpServerConfig;
  /** Logins to try for an HTTP server that takes Cursor's OAuth token, best first. */
  readonly logins: ReadonlyArray<StoredLogin>;
}

/** Cursor's project directory slugger (`utils/dist/workspace-paths.js` in `@cursor/sdk`). */
export function cursorWorkspaceSlug(folder: string): string {
  return folder
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Every installed plugin MCP server, keyed by Cursor's plugin identifier. */
export const discoverCursorPluginMcpServers = Effect.fn("discoverCursorPluginMcpServers")(
  function* (
    input: CursorPluginMcpInput,
  ): Effect.fn.Return<
    Record<string, CursorPluginMcpServer>,
    never,
    FileSystem.FileSystem | Path.Path
  > {
    const userHome = cursorHome(input.env);
    // MCP servers launch processes and carry credentials, so only plugins the
    // install record names explicitly are forwarded. A worktree has no Cursor
    // window of its own; the project's window holds that record.
    const pluginRoots = (yield* cursorInstalledPluginRoots(
      userHome,
      input.env,
      makeCursorPluginScanBudget(),
      input.projectRoot ?? input.cwd,
    )).flatMap(({ root, evidence }) => (evidence === "listed" ? [root] : []));
    if (pluginRoots.length === 0) return {};

    const projectsDir = NodePath.join(cursorDataDir(input.env, userHome), "projects");
    const stores = [
      { folder: "thread" as const, slug: cursorWorkspaceSlug(input.cwd) },
      ...(input.projectRoot === undefined
        ? []
        : [{ folder: "project" as const, slug: cursorWorkspaceSlug(input.projectRoot) }]),
    ]
      .filter((store, index, all) => all.findIndex((other) => other.slug === store.slug) === index)
      .map((store) => {
        const authFile = NodePath.join(projectsDir, store.slug, "mcp-auth.json");
        return { folder: store.folder, authFile, tokens: readAccessTokens(authFile) };
      });
    const loginsFor = (identifier: string): ReadonlyArray<StoredLogin> =>
      stores.flatMap(({ folder, authFile, tokens }) => {
        const accessToken = tokens.get(identifier);
        return accessToken === undefined ? [] : [{ folder, authFile, accessToken }];
      });

    const servers = yield* Effect.forEach(
      readPluginServers(pluginRoots, loginsFor, input.env),
      (server) => withUsableLogin(server, input.fetch),
      { concurrency: "unbounded" },
    );
    return Object.fromEntries(servers);
  },
);

/**
 * Nothing refreshes a token forwarded to the SDK, so a rejected one is
 * refreshed from its store before the agent opens, and the next folder's login
 * is tried when that fails. A refresh is written back to its store so Cursor
 * keeps a valid refresh token if the server rotates it. When no login works,
 * the first is forwarded unchanged; the server reports the missing login.
 */
const withUsableLogin = Effect.fn("withUsableCursorPluginLogin")(function* (
  server: PluginServer,
  fetchFn: CursorPluginMcpFetch,
): Effect.fn.Return<readonly [string, CursorPluginMcpServer]> {
  const config = server.config;
  const first = server.logins[0];
  if (first === undefined || !("url" in config)) return [server.identifier, { config }];
  for (const login of server.logins) {
    const resourceMetadata = yield* Effect.promise(() =>
      oauthChallenge(config, login.accessToken, fetchFn),
    );
    if (resourceMetadata === undefined) {
      return [server.identifier, withLogin(config, login.folder, login.accessToken)];
    }
    const refresh = yield* Effect.promise(() =>
      refreshCursorPluginAccessToken({
        authFile: login.authFile,
        identifier: server.identifier,
        resource: config.url,
        resourceMetadata,
        rejectedAccessToken: login.accessToken,
        fetch: fetchFn,
      }),
    );
    if (refresh._tag === "Refreshed") {
      return [server.identifier, withLogin(config, login.folder, refresh.accessToken)];
    }
    yield* Effect.logWarning("Cursor plugin OAuth refresh failed.", {
      identifier: server.identifier,
      authFile: login.authFile,
      reason: refresh.reason,
    });
  }
  return [server.identifier, withLogin(config, first.folder, first.accessToken)];
});

function withLogin(
  config: HttpServerConfig,
  loginFolder: CursorPluginLoginFolder,
  accessToken: string,
): CursorPluginMcpServer {
  return {
    config: { ...config, headers: { ...config.headers, Authorization: `Bearer ${accessToken}` } },
    loginFolder,
  };
}

function readAccessTokens(authFile: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const [identifier, record] of Object.entries(readJsonObject(authFile) ?? {})) {
    const accessToken =
      isRecord(record) && isRecord(record.tokens)
        ? stringField(record.tokens, "access_token")
        : undefined;
    if (accessToken) tokens.set(identifier, accessToken);
  }
  return tokens;
}

function readPluginServers(
  pluginRoots: ReadonlyArray<string>,
  loginsFor: (identifier: string) => ReadonlyArray<StoredLogin>,
  env: NodeJS.ProcessEnv,
): ReadonlyArray<PluginServer> {
  const servers: PluginServer[] = [];
  const taken = new Set<string>();
  for (const pluginRoot of pluginRoots) {
    const mcpServers = readJsonObject(NodePath.join(pluginRoot, "mcp.json"))?.mcpServers;
    if (!isRecord(mcpServers)) continue;
    const pluginName =
      stringField(readPluginManifest(pluginRoot), "name") ?? NodePath.basename(pluginRoot);
    for (const [serverKey, rawConfig] of Object.entries(mcpServers)) {
      const identifier = `plugin-${pluginName}-${serverKey}`;
      if (taken.has(identifier) || !isRecord(rawConfig)) continue;
      const server = toServer(identifier, rawConfig, pluginRoot, loginsFor, env);
      if (server === undefined) continue;
      taken.add(identifier);
      servers.push(server);
    }
  }
  return servers;
}

function toServer(
  identifier: string,
  rawConfig: Record<string, unknown>,
  pluginRoot: string,
  loginsFor: (identifier: string) => ReadonlyArray<StoredLogin>,
  env: NodeJS.ProcessEnv,
): PluginServer | undefined {
  const rawType = stringField(rawConfig, "type")?.toLowerCase();
  const url = resolveTemplate(stringField(rawConfig, "url"), pluginRoot, env);
  const command = resolveTemplate(stringField(rawConfig, "command"), pluginRoot, env);
  const httpType =
    rawType === undefined ||
    rawType === "http" ||
    rawType === "streamable-http" ||
    rawType === "streamablehttp"
      ? "http"
      : rawType === "sse"
        ? "sse"
        : undefined;
  if (url !== undefined && httpType !== undefined) {
    // An unresolved or empty Authorization is dropped; a usable one is the
    // plugin's own credential, which a Cursor OAuth login does not replace.
    const headers = Object.fromEntries(
      entries(rawConfig.headers, pluginRoot, env).filter(
        ([name, value]) => name.toLowerCase() !== "authorization" || isUsableAuthorization(value),
      ),
    );
    const ownCredential = Object.entries(headers).some(
      ([name]) => name.toLowerCase() === "authorization",
    );
    return {
      identifier,
      config: { type: httpType, url, headers },
      logins: ownCredential || !carriesBearerTokens(url) ? [] : loginsFor(identifier),
    };
  }
  if (command !== undefined) {
    return {
      identifier,
      config: {
        command: command.startsWith(".") ? NodePath.resolve(pluginRoot, command) : command,
        args: (Array.isArray(rawConfig.args) ? rawConfig.args : []).flatMap((value) => {
          const resolved =
            typeof value === "string" ? resolveTemplate(value, pluginRoot, env) : undefined;
          return resolved === undefined ? [] : [resolved];
        }),
        env: Object.fromEntries(entries(rawConfig.env, pluginRoot, env)),
      },
      logins: [],
    };
  }
  return undefined;
}

/** Stored OAuth tokens go only to HTTPS or loopback HTTP, never in cleartext over a network. */
function carriesBearerTokens(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "http:" &&
      (host === "localhost" || host === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(host))
    );
  } catch {
    return false;
  }
}

function isUsableAuthorization(value: string): boolean {
  return /^\S+\s+\S/.test(value.trim());
}

/**
 * The `resource_metadata` URI (RFC 9728) when the server rejects the token
 * with an MCP OAuth challenge. Other outcomes, including network failures,
 * leave the token as stored.
 */
async function oauthChallenge(
  server: HttpServerConfig,
  accessToken: string,
  fetchFn: CursorPluginMcpFetch,
): Promise<string | undefined> {
  const headers = new Headers(server.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  if (!headers.has("accept")) {
    headers.set(
      "Accept",
      server.type === "sse" ? "text/event-stream" : "application/json, text/event-stream",
    );
  }
  if (server.type !== "sse" && !headers.has("content-type")) {
    headers.set("Content-Type", "application/json");
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
    if (response.status !== 401 && response.status !== 403) return undefined;
    return /\bresource_metadata="([^"]+)"/i.exec(
      response.headers.get("www-authenticate") ?? "",
    )?.[1];
  } catch {
    return undefined;
  } finally {
    try {
      await response?.body?.cancel();
    } catch {
      // Closing an optional probe response is best effort.
    }
  }
}

function readPluginManifest(pluginRoot: string): Record<string, unknown> | undefined {
  for (const directory of PLUGIN_MANIFEST_DIRS) {
    const manifest = readJsonObject(NodePath.join(pluginRoot, directory, "plugin.json"));
    if (manifest) return manifest;
  }
  return undefined;
}

/** String entries of a config object with placeholders resolved; unresolvable ones are dropped. */
function entries(
  value: unknown,
  pluginRoot: string,
  env: NodeJS.ProcessEnv,
): Array<[string, string]> {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([name, raw]): Array<[string, string]> => {
    const resolved = typeof raw === "string" ? resolveTemplate(raw, pluginRoot, env) : undefined;
    return resolved === undefined ? [] : [[name, resolved]];
  });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
