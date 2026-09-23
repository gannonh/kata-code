// @effect-diagnostics nodeBuiltinImport:off
/**
 * Refreshes a Cursor plugin's stored OAuth access token.
 *
 * Cursor keeps plugin OAuth in `~/.cursor/projects/<slug>/mcp-auth.json`
 * under the plugin's server name and refreshes it only when one of its own
 * clients connects. `agent acp` stores OAuth for session servers under a
 * different, config-hashed key, so a token Kata forwards is never refreshed
 * there. Kata refreshes with the stored refresh token and client registration
 * and writes the result back under the same key, so Cursor's clients keep a
 * valid refresh token if the server rotates it.
 */
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as oauth from "oauth4webapi";

export type CursorPluginOAuthRefresh =
  | { readonly _tag: "Refreshed"; readonly accessToken: string }
  | { readonly _tag: "Failed"; readonly reason: string };

export interface CursorPluginOAuthRefreshInput {
  readonly authFile: string;
  readonly identifier: string;
  /** MCP server URL, the OAuth protected resource. */
  readonly resource: string;
  /** The access token the server rejected. */
  readonly rejectedAccessToken: string;
  readonly fetch: typeof globalThis.fetch;
}

const inFlight = new Map<string, Promise<CursorPluginOAuthRefresh>>();

/** Concurrent sessions for the same plugin share one refresh. */
export function refreshCursorPluginAccessToken(
  input: CursorPluginOAuthRefreshInput,
): Promise<CursorPluginOAuthRefresh> {
  const key = `${input.authFile}\n${input.identifier}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const refresh = performRefresh(input).finally(() => inFlight.delete(key));
  inFlight.set(key, refresh);
  return refresh;
}

async function performRefresh(
  input: CursorPluginOAuthRefreshInput,
): Promise<CursorPluginOAuthRefresh> {
  const record = readAuthRecords(input.authFile)?.[input.identifier];
  const tokens = isRecord(record) && isRecord(record.tokens) ? record.tokens : undefined;
  const clientInfo =
    isRecord(record) && isRecord(record.clientInfo) ? record.clientInfo : undefined;
  const storedAccessToken = stringField(tokens, "access_token");
  // Another Cursor client refreshed after this session read the file.
  if (storedAccessToken && storedAccessToken !== input.rejectedAccessToken) {
    return { _tag: "Refreshed", accessToken: storedAccessToken };
  }
  const refreshToken = stringField(tokens, "refresh_token");
  const clientId = stringField(clientInfo, "client_id");
  if (!tokens || !refreshToken || !clientId) {
    return { _tag: "Failed", reason: "no stored refresh token or client registration" };
  }

  const request = {
    [oauth.customFetch]: <Method extends string>(
      url: string,
      options: oauth.CustomFetchOptions<Method, URLSearchParams | undefined>,
    ) =>
      input.fetch(url, {
        method: options.method,
        headers: options.headers,
        redirect: options.redirect,
        ...(options.body === undefined ? {} : { body: options.body }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
  };
  try {
    const resource = new URL(input.resource);
    const resourceServer = await oauth.processResourceDiscoveryResponse(
      resource,
      await oauth.resourceDiscoveryRequest(resource, request),
    );
    const issuer = resourceServer.authorization_servers?.[0];
    if (!issuer)
      return { _tag: "Failed", reason: "resource metadata names no authorization server" };
    const issuerUrl = new URL(issuer);
    const authorizationServer = await oauth.processDiscoveryResponse(
      issuerUrl,
      await oauth.discoveryRequest(issuerUrl, { ...request, algorithm: "oauth2" }),
    );
    const client: oauth.Client = { client_id: clientId };
    const response = await oauth.processRefreshTokenResponse(
      authorizationServer,
      client,
      await oauth.refreshTokenGrantRequest(
        authorizationServer,
        client,
        oauth.None(),
        refreshToken,
        {
          ...request,
          additionalParameters: { resource: resourceServer.resource },
        },
      ),
    );
    writeTokens(input.authFile, input.identifier, {
      ...tokens,
      access_token: response.access_token,
      // oauth4webapi lowercases token_type; keep Cursor's stored spelling.
      token_type:
        stringField(tokens, "token_type")?.toLowerCase() === response.token_type
          ? tokens.token_type
          : response.token_type,
      ...(response.expires_in === undefined ? {} : { expires_in: response.expires_in }),
      refresh_token: response.refresh_token ?? refreshToken,
      ...(response.scope === undefined ? {} : { scope: response.scope }),
    });
    return { _tag: "Refreshed", accessToken: response.access_token };
  } catch (error) {
    return { _tag: "Failed", reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Re-reads the file so concurrent writes to other keys survive, then swaps it in atomically. */
function writeTokens(authFile: string, identifier: string, tokens: Record<string, unknown>): void {
  const records = readAuthRecords(authFile) ?? {};
  const record = isRecord(records[identifier]) ? records[identifier] : {};
  records[identifier] = { ...record, tokens };
  const temporary = NodePath.join(
    NodePath.dirname(authFile),
    `.${NodePath.basename(authFile)}.${process.pid}.tmp`,
  );
  const mode = NodeFS.statSync(authFile).mode & 0o777;
  NodeFS.writeFileSync(temporary, JSON.stringify(records, null, 2), { mode });
  NodeFS.renameSync(temporary, authFile);
}

function readAuthRecords(filePath: string): Record<string, unknown> | undefined {
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
