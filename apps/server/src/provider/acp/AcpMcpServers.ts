import type * as EffectAcpSchema from "effect-acp/schema";

import type { McpProviderSessionConfig } from "../../mcp/McpProviderSession.ts";

export const T3_CODE_ACP_MCP_SERVER_NAME = "t3-code";

/** Thread-scoped Kata Code MCP server. Credentials stay on the ACP wire, not in logs. */
export function t3CodeAcpMcpServer(
  session: Pick<McpProviderSessionConfig, "endpoint" | "authorizationHeader">,
): EffectAcpSchema.McpServer {
  return {
    type: "http",
    name: T3_CODE_ACP_MCP_SERVER_NAME,
    url: session.endpoint,
    headers: [{ name: "Authorization", value: session.authorizationHeader }],
  };
}

/**
 * Session MCP list: extras (t3-code) plus host/plugin servers.
 *
 * Cursor ACP 2026.09.10 merges `session/new` servers into the mcp.json lease
 * instead of replacing it, but that lease never includes marketplace plugins.
 * Passing only t3-code therefore leaves plugins unconnected. Host servers must
 * travel on the same list. Extra names win on collision so t3-code stays
 * thread-scoped.
 */
export function mergeAcpMcpServers(input: {
  readonly extra: ReadonlyArray<EffectAcpSchema.McpServer>;
  readonly host: ReadonlyArray<EffectAcpSchema.McpServer>;
}): ReadonlyArray<EffectAcpSchema.McpServer> {
  const extra = [...input.extra];
  const taken = new Set(extra.map((server) => server.name));
  const host: EffectAcpSchema.McpServer[] = [];
  for (const server of input.host) {
    if (taken.has(server.name)) continue;
    taken.add(server.name);
    host.push(server);
  }
  return [...extra, ...host];
}

export function acpMcpServersForProviderSession(input: {
  readonly mcpSession:
    | Pick<McpProviderSessionConfig, "endpoint" | "authorizationHeader">
    | undefined;
  readonly host?: ReadonlyArray<EffectAcpSchema.McpServer>;
}): ReadonlyArray<EffectAcpSchema.McpServer> {
  return mergeAcpMcpServers({
    extra: input.mcpSession ? [t3CodeAcpMcpServer(input.mcpSession)] : [],
    host: input.host ?? [],
  });
}
