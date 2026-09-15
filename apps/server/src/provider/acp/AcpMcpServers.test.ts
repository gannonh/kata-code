import { describe, expect, it } from "vite-plus/test";
import type * as EffectAcpSchema from "effect-acp/schema";

import { EnvironmentId, ProviderInstanceId, ThreadId } from "@kata-sh/code-contracts";

import {
  acpMcpServersForProviderSession,
  mergeAcpMcpServers,
  t3CodeAcpMcpServer,
  T3_CODE_ACP_MCP_SERVER_NAME,
} from "./AcpMcpServers.ts";

const t3Code = t3CodeAcpMcpServer({
  endpoint: "http://127.0.0.1:43123/mcp",
  authorizationHeader: "Bearer test-token",
});

const linear: EffectAcpSchema.McpServer = {
  type: "http",
  name: "plugin-linear-linear",
  url: "https://mcp.linear.app/mcp",
  headers: [],
};

const github: EffectAcpSchema.McpServer = {
  type: "http",
  name: "plugin-github-github",
  url: "https://api.githubcopilot.com/mcp/",
  headers: [],
};

describe("mergeAcpMcpServers", () => {
  it("keeps t3-code and host plugin servers on the same session list", () => {
    const merged = mergeAcpMcpServers({ extra: [t3Code], host: [linear, github] });
    expect(merged.map((server) => server.name)).toEqual([
      T3_CODE_ACP_MCP_SERVER_NAME,
      "plugin-linear-linear",
      "plugin-github-github",
    ]);
    expect(merged).not.toEqual([t3Code]);
    expect(merged.some((server) => server.name === T3_CODE_ACP_MCP_SERVER_NAME)).toBe(true);
  });

  it("fails closed if extras would exclusively replace host plugin servers", () => {
    const extraOnly = [t3Code];
    const merged = mergeAcpMcpServers({ extra: extraOnly, host: [linear] });
    expect(merged.length).toBeGreaterThan(extraOnly.length);
    expect(merged).toEqual([...extraOnly, linear]);
  });

  it("does not let a host server steal the t3-code name", () => {
    const colliding: EffectAcpSchema.McpServer = {
      type: "http",
      name: T3_CODE_ACP_MCP_SERVER_NAME,
      url: "https://example.invalid/mcp",
      headers: [],
    };
    expect(mergeAcpMcpServers({ extra: [t3Code], host: [colliding, linear] })).toEqual([
      t3Code,
      linear,
    ]);
  });
});

describe("acpMcpServersForProviderSession", () => {
  it("includes t3-code from the provider session and host plugins together", () => {
    const mcpSession = {
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
      providerSessionId: "session-1",
      providerInstanceId: ProviderInstanceId.make("cursor"),
      endpoint: "http://127.0.0.1:9/mcp",
      authorizationHeader: "Bearer test-token",
      capabilities: new Set<string>(["preview"]),
    };
    const servers = acpMcpServersForProviderSession({ mcpSession, host: [linear] });
    expect(servers.map((server) => server.name)).toEqual([
      T3_CODE_ACP_MCP_SERVER_NAME,
      "plugin-linear-linear",
    ]);
    expect(servers).not.toEqual([t3CodeAcpMcpServer(mcpSession)]);
  });

  it("still forwards host plugin servers when t3-code is absent", () => {
    expect(acpMcpServersForProviderSession({ mcpSession: undefined, host: [linear] })).toEqual([
      linear,
    ]);
  });
});
