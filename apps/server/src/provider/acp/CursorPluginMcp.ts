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
import { refreshCursorPluginAccessToken } from "./CursorPluginOAuth.ts";

const PLUGIN_ROOT_VARS = ["CURSOR_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"] as const;
const PLUGIN_MANIFEST_DIRS = [".cursor-plugin", ".claude-plugin", ".codex-plugin"] as const;
const TEMPLATE_PLACEHOLDER = /\$\{([A-Z][A-Z0-9_]*)(?::-([^}]*))?\}/g;
const PLUGIN_AUTH_PROBE_TIMEOUT_MS = 5_000;
/** Bounds the pre-start probes and refreshes spent on one server's stored tokens. */
const MAX_STORED_TOKEN_CANDIDATES = 3;

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
  /**
   * Probes forwarded HTTP servers and resolves to the plugins whose OAuth
   * credential is missing or rejected. Callers run it off the session-start
   * path because each probe can take up to the probe timeout.
   */
  readonly checkAuth: Effect.Effect<ReadonlyArray<CursorPluginMcpAuthRequirement>>;
}

/** A plugin's OAuth access token and the `mcp-auth.json` store it came from. */
interface StoredPluginToken {
  readonly accessToken: string;
  readonly authFile: string;
}

interface PluginAuthProbe {
  readonly requirement: CursorPluginMcpAuthRequirement;
  readonly server: HttpCursorPluginMcpServer;
  /**
   * Stored OAuth tokens for this server, best first. `server` forwards the
   * first; later ones are fallbacks when it is rejected and cannot refresh.
   */
  readonly storedTokens?: ReadonlyArray<StoredPluginToken>;
}

const NO_AUTH_REQUIRED: CursorPluginMcpDiscovery["checkAuth"] = Effect.succeed([]);

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
    // MCP servers launch processes and carry credentials, so only plugins the
    // install record names explicitly are forwarded.
    const pluginRoots = (yield* cursorInstalledPluginRoots(
      userHome,
      env,
      makeCursorPluginScanBudget(),
      cwd,
    )).flatMap(({ root, evidence }) => (evidence === "listed" ? [root] : []));
    if (pluginRoots.length === 0) return { servers: [], checkAuth: NO_AUTH_REQUIRED };
    const discovered = readPluginMcpServers(
      pluginRoots,
      readPluginTokens(NodePath.join(cursorDataDir(env, userHome), "projects"), cwd),
      env,
    );
    const fetchFn = options?.fetch;
    if (fetchFn === undefined || discovered.authProbes.length === 0) {
      return { servers: discovered.servers, checkAuth: NO_AUTH_REQUIRED };
    }
    const checked = yield* Effect.forEach(
      discovered.authProbes,
      (probe) => withFreshStoredToken(probe, fetchFn),
      { concurrency: "unbounded" },
    );
    const refreshedServers = new Map(checked.map(({ probe }) => [probe.server.name, probe.server]));
    return {
      servers: discovered.servers.map((server) => refreshedServers.get(server.name) ?? server),
      checkAuth: Effect.promise(async () => {
        const results = await Promise.all(
          checked.map(async ({ probe, needsAuth }) =>
            (needsAuth ?? (await oauthChallenge(probe.server, fetchFn)) !== undefined)
              ? [probe.requirement]
              : [],
          ),
        );
        return results
          .flat()
          .sort((left, right) => left.identifier.localeCompare(right.identifier));
      }),
    };
  },
);

/**
 * Stored access tokens expire, and nothing refreshes a token forwarded to ACP,
 * so a rejected one is refreshed before the session starts. `needsAuth` is set
 * when this check already settled the server's auth state.
 */
const withFreshStoredToken = Effect.fn("withFreshStoredToken")(function* (
  probe: PluginAuthProbe,
  fetchFn: CursorPluginMcpFetch,
): Effect.fn.Return<{ readonly probe: PluginAuthProbe; readonly needsAuth?: boolean }> {
  for (const storedToken of probe.storedTokens ?? []) {
    const server = withBearer(probe.server, storedToken.accessToken);
    const resourceMetadata = yield* Effect.promise(() => oauthChallenge(server, fetchFn));
    if (resourceMetadata === undefined) return { probe: { ...probe, server }, needsAuth: false };
    const refresh = yield* Effect.promise(() =>
      refreshCursorPluginAccessToken({
        authFile: storedToken.authFile,
        identifier: probe.requirement.identifier,
        resource: server.url,
        resourceMetadata,
        rejectedAccessToken: storedToken.accessToken,
        fetch: fetchFn,
      }),
    );
    if (refresh._tag === "Refreshed") {
      const refreshed = withBearer(probe.server, refresh.accessToken);
      if ((yield* Effect.promise(() => oauthChallenge(refreshed, fetchFn))) === undefined) {
        return { probe: { ...probe, server: refreshed }, needsAuth: false };
      }
      yield* Effect.logWarning("Cursor plugin server rejected a refreshed OAuth token.", {
        identifier: probe.requirement.identifier,
        authFile: storedToken.authFile,
      });
      continue;
    }
    yield* Effect.logWarning("Cursor plugin OAuth refresh failed.", {
      identifier: probe.requirement.identifier,
      authFile: storedToken.authFile,
      reason: refresh.reason,
    });
  }
  return probe.storedTokens === undefined ? { probe } : { probe, needsAuth: true };
});

function withBearer(
  server: HttpCursorPluginMcpServer,
  accessToken: string,
): HttpCursorPluginMcpServer {
  return {
    ...server,
    headers: server.headers.map((header) =>
      header.name.toLowerCase() === "authorization"
        ? { name: header.name, value: `Bearer ${accessToken}` }
        : header,
    ),
  };
}

/**
 * The checkout a linked git worktree was created from, read from the
 * worktree's `.git` file (`gitdir: <checkout>/.git/worktrees/<name>`).
 */
function gitWorktreeSourceCheckout(cwd: string): string | undefined {
  let gitFile: string;
  try {
    gitFile = NodeFS.readFileSync(NodePath.join(cwd, ".git"), "utf8");
  } catch {
    return undefined;
  }
  const gitDir = /^gitdir:\s*(.+)$/m.exec(gitFile)?.[1]?.trim();
  if (gitDir === undefined) return undefined;
  // Git writes forward slashes even on Windows, so match either separator.
  const markers = [...gitDir.matchAll(/[\\/]\.git[\\/]worktrees[\\/]/g)];
  const index = markers.at(-1)?.index ?? -1;
  return index > 0 ? NodePath.normalize(gitDir.slice(0, index)) : undefined;
}

/**
 * Cursor CLI keeps plugin OAuth per folder in `projects/<slug>/mcp-auth.json`,
 * written where the user signed in through `/mcp`. Candidates come from the
 * thread's folder, then the checkout a Kata worktree was created from, then,
 * because plugins are user-scoped, other folders by most recent write.
 */
function readPluginTokens(
  projectsDir: string,
  cwd: string,
): ReadonlyMap<string, ReadonlyArray<StoredPluginToken>> {
  const authFileFor = (folder: string) =>
    NodePath.join(projectsDir, cursorWorkspaceSlug(folder), "mcp-auth.json");
  const sourceCheckout = gitWorktreeSourceCheckout(cwd);
  const preferredAuthFiles = [
    authFileFor(cwd),
    ...(sourceCheckout === undefined ? [] : [authFileFor(sourceCheckout)]),
  ];
  let slugs: string[];
  try {
    slugs = NodeFS.readdirSync(projectsDir);
  } catch {
    slugs = [];
  }
  const otherAuthFiles = slugs
    .map((slug) => NodePath.join(projectsDir, slug, "mcp-auth.json"))
    .filter((authFile) => !preferredAuthFiles.includes(authFile))
    .flatMap((authFile) => {
      try {
        return [{ authFile, mtimeMs: NodeFS.statSync(authFile).mtimeMs }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .map(({ authFile }) => authFile);

  // A file's mtime also moves when another plugin's record changes, so it
  // only ranks candidates; a rejected token falls through to the next one.
  const tokens = new Map<string, StoredPluginToken[]>();
  for (const authFile of [...preferredAuthFiles, ...otherAuthFiles]) {
    const records = readJsonObject(authFile);
    if (!records) continue;
    for (const [identifier, rawRecord] of Object.entries(records)) {
      if (!isRecord(rawRecord) || !isRecord(rawRecord.tokens)) continue;
      const accessToken = stringField(rawRecord.tokens, "access_token");
      if (!accessToken) continue;
      const candidates = tokens.get(identifier) ?? [];
      if (candidates.length < MAX_STORED_TOKEN_CANDIDATES) {
        candidates.push({ accessToken, authFile });
        tokens.set(identifier, candidates);
      }
    }
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

function readPluginMcpServers(
  pluginRoots: ReadonlyArray<string>,
  storedTokens: ReadonlyMap<string, ReadonlyArray<StoredPluginToken>>,
  env: NodeJS.ProcessEnv,
): {
  readonly servers: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly authProbes: ReadonlyArray<PluginAuthProbe>;
} {
  const servers: EffectAcpSchema.McpServer[] = [];
  const authProbes: PluginAuthProbe[] = [];
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
        storedTokens.get(identifier)?.[0]?.accessToken,
        env,
      );
      if (!converted) continue;
      taken.add(identifier);
      servers.push(converted.server);
      const server = converted.server;
      // A launch config that declares its own Authorization expects a
      // credential from the environment, which mcp_auth cannot supply.
      if (
        isHttpCursorPluginMcpServer(server) &&
        (converted.usesStoredAccessToken || !declaresAuthorization(rawConfig))
      ) {
        const candidates = converted.usesStoredAccessToken
          ? storedTokens.get(identifier)
          : undefined;
        authProbes.push({
          requirement: { identifier, displayName: pluginName },
          server,
          ...(candidates === undefined ? {} : { storedTokens: candidates }),
        });
      }
    }
  }
  return { servers, authProbes };
}

function isHttpCursorPluginMcpServer(
  server: EffectAcpSchema.McpServer,
): server is HttpCursorPluginMcpServer {
  return "type" in server && (server.type === "http" || server.type === "sse");
}

/**
 * The `resource_metadata` URI (RFC 9728) when the server rejects the request
 * with an MCP OAuth challenge. Other rejections, such as a missing API key
 * header, are not something `mcp_auth` can fix.
 */
async function oauthChallenge(
  server: HttpCursorPluginMcpServer,
  fetchFn: CursorPluginMcpFetch,
): Promise<string | undefined> {
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
  const bearerToken = url !== undefined && carriesBearerTokens(url) ? accessToken : undefined;
  if (
    url &&
    (type === undefined ||
      type === "http" ||
      type === "streamable-http" ||
      type === "streamablehttp")
  ) {
    const resolvedHeaders = httpHeaders(rawConfig.headers, pluginRoot, bearerToken, env);
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
    const resolvedHeaders = httpHeaders(rawConfig.headers, pluginRoot, bearerToken, env);
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

function declaresAuthorization(rawConfig: unknown): boolean {
  return (
    isRecord(rawConfig) &&
    isRecord(rawConfig.headers) &&
    Object.keys(rawConfig.headers).some((name) => name.toLowerCase() === "authorization")
  );
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
